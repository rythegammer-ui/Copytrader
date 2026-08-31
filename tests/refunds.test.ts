import { describe, expect, it } from "vitest";
import { OrderItemStatus, ShipTo } from "@/lib/enums";
import { mulBps } from "@/lib/pricing";
import {
  computeRefund,
  type RefundItemSnapshot,
  type RefundOrderSnapshot,
  type RefundPOSnapshot,
} from "@/lib/refunds";

const RATE = 825;

interface ItemSpec {
  id: string;
  lineTotalCents: number;
  poId: string | null;
  installTotalCents?: number;
  withInstall?: boolean;
  installRefunded?: boolean;
  itemStatus?: string;
}

/** Build a consistent snapshot the way checkout would have priced it. */
function buildSnapshot(itemSpecs: ItemSpec[], pos: RefundPOSnapshot[], refundedTotalCents = 0): RefundOrderSnapshot {
  const items: RefundItemSnapshot[] = itemSpecs.map((s) => ({
    id: s.id,
    lineTotalCents: s.lineTotalCents,
    installTotalCents: s.installTotalCents ?? 0,
    withInstall: s.withInstall ?? false,
    installRefunded: s.installRefunded ?? false,
    itemStatus: s.itemStatus ?? OrderItemStatus.PENDING,
    purchaseOrderId: s.poId,
    shipTo: ShipTo.HOME,
  }));
  const parts = items.reduce((s, i) => s + i.lineTotalCents, 0);
  const install = items.reduce((s, i) => s + i.installTotalCents, 0);
  const shipping = pos.reduce((s, p) => s + p.shippingFeeCents, 0);
  const tax = mulBps(parts + shipping, RATE);
  return {
    totalCents: parts + install + shipping + tax,
    taxRateBps: RATE,
    refundedTotalCents,
    items,
    purchaseOrders: pos,
  };
}

describe("computeRefund — single item with tax diff", () => {
  it("refunds line + its PO shipping + recompute-and-diff tax", () => {
    const snap = buildSnapshot(
      [
        { id: "i1", lineTotalCents: 3333, poId: "poA" },
        { id: "i2", lineTotalCents: 6667, poId: "poB" },
      ],
      [
        { id: "poA", shippingFeeCents: 500 },
        { id: "poB", shippingFeeCents: 700 },
      ],
    );
    // taxable base before = 3333+6667+500+700 = 11200; tax = 924
    expect(snap.totalCents).toBe(10000 + 1200 + 924);

    const r = computeRefund(snap, { itemIds: ["i1"] });
    expect(r.partsCents).toBe(3333);
    expect(r.installCents).toBe(0);
    expect(r.shippingCents).toBe(500); // i1 was the last live item on poA
    expect(r.deadPoIds).toEqual(["poA"]);
    // taxBack = tax(11200) - tax(6667+700) = 924 - 608 = 316
    expect(r.taxCents).toBe(mulBps(11200, RATE) - mulBps(7367, RATE));
    expect(r.taxCents).toBe(316);
    expect(r.amountCents).toBe(3333 + 500 + 316);
    expect(r.isFinal).toBe(false);
  });
});

describe("computeRefund — PO shipping only refunds with the last live item", () => {
  const pos = [{ id: "poA", shippingFeeCents: 900 }];

  it("keeps shipping while a sibling item on the PO is still live", () => {
    const snap = buildSnapshot(
      [
        { id: "i1", lineTotalCents: 5000, poId: "poA" },
        { id: "i2", lineTotalCents: 4000, poId: "poA" },
      ],
      pos,
    );
    const r = computeRefund(snap, { itemIds: ["i1"] });
    expect(r.shippingCents).toBe(0);
    expect(r.deadPoIds).toEqual([]);
  });

  it("releases shipping when the refund kills the PO's last live item", () => {
    const snap = buildSnapshot(
      [
        { id: "i1", lineTotalCents: 5000, poId: "poA", itemStatus: OrderItemStatus.REFUNDED },
        { id: "i2", lineTotalCents: 4000, poId: "poA" },
      ],
      pos,
    );
    const r = computeRefund(snap, { itemIds: ["i2"] });
    expect(r.shippingCents).toBe(900);
    expect(r.deadPoIds).toEqual(["poA"]);
  });
});

describe("computeRefund — install-only refund", () => {
  it("refunds labor only, with zero tax (labor untaxed)", () => {
    const snap = buildSnapshot(
      [
        { id: "i1", lineTotalCents: 8000, poId: "poA", withInstall: true, installTotalCents: 16500 },
      ],
      [{ id: "poA", shippingFeeCents: 1049 }],
    );
    const r = computeRefund(snap, { itemIds: [], installOnlyItemIds: ["i1"] });
    expect(r.partsCents).toBe(0);
    expect(r.installCents).toBe(16500);
    expect(r.shippingCents).toBe(0);
    expect(r.taxCents).toBe(0);
    expect(r.amountCents).toBe(16500);
    expect(r.isFinal).toBe(false);
  });

  it("rejects install-only refunds when there is nothing refundable", () => {
    const snap = buildSnapshot(
      [{ id: "i1", lineTotalCents: 8000, poId: "poA", withInstall: false }],
      [{ id: "poA", shippingFeeCents: 0 }],
    );
    expect(() => computeRefund(snap, { itemIds: [], installOnlyItemIds: ["i1"] })).toThrow(
      /no refundable install/,
    );
  });
});

describe("computeRefund — telescoping invariant", () => {
  it("refunding item-by-item sums EXACTLY to totalCents despite rounding drift", () => {
    // Odd prices at 8.25% force fractional per-line tax; the diff method must
    // telescope so the sum of refunds equals the single original tax rounding.
    const specs: ItemSpec[] = [
      { id: "i1", lineTotalCents: 3333, poId: "poA" },
      { id: "i2", lineTotalCents: 7777, poId: "poB", withInstall: true, installTotalCents: 5000 },
      { id: "i3", lineTotalCents: 9999, poId: "poC" },
    ];
    const pos: RefundPOSnapshot[] = [
      { id: "poA", shippingFeeCents: 250 },
      { id: "poB", shippingFeeCents: 0 },
      { id: "poC", shippingFeeCents: 450 },
    ];
    const original = buildSnapshot(specs, pos);
    const totalCents = original.totalCents;
    // Original order tax (ONE rounding): parts 21109 + shipping 700 @ 8.25% = 1799
    expect(totalCents).toBe(21109 + 5000 + 700 + 1799);

    // Mutable working copy that we "apply" each refund to, like the fulfillment
    // layer updating itemStatus + refundedTotalCents in-tx.
    const working = buildSnapshot(specs, pos);
    const amounts: number[] = [];
    for (const id of ["i1", "i2", "i3"]) {
      const r = computeRefund(working, { itemIds: [id] });
      amounts.push(r.amountCents);
      const item = working.items.find((i) => i.id === id);
      if (!item) throw new Error("missing item");
      item.itemStatus = OrderItemStatus.REFUNDED;
      working.refundedTotalCents += r.amountCents;
    }

    expect(amounts).toHaveLength(3);
    expect(amounts.reduce((a, b) => a + b, 0)).toBe(totalCents);
    expect(working.refundedTotalCents).toBe(totalCents);
  });
});

describe("computeRefund — final-refund clamp", () => {
  it("forces the exact remaining balance on the final refund", () => {
    // A prior partial refund of 10 cents was recorded; the naive computation for
    // the last item exceeds the remaining balance and must be clamped to it.
    const snap = buildSnapshot(
      [{ id: "i1", lineTotalCents: 101, poId: "poA" }],
      [{ id: "poA", shippingFeeCents: 0 }],
      10,
    );
    // total = 101 + tax round(101*0.0825)=8 -> 109; remaining = 99
    expect(snap.totalCents).toBe(109);
    const r = computeRefund(snap, { itemIds: ["i1"] });
    expect(r.isFinal).toBe(true);
    expect(r.amountCents).toBe(99);
  });

  it("throws for an already-refunded item", () => {
    const snap = buildSnapshot(
      [{ id: "i1", lineTotalCents: 5000, poId: "poA", itemStatus: OrderItemStatus.REFUNDED }],
      [{ id: "poA", shippingFeeCents: 0 }],
    );
    expect(() => computeRefund(snap, { itemIds: ["i1"] })).toThrow(/already REFUNDED/);
  });

  it("throws for an unknown item id", () => {
    const snap = buildSnapshot(
      [{ id: "i1", lineTotalCents: 5000, poId: "poA" }],
      [{ id: "poA", shippingFeeCents: 0 }],
    );
    expect(() => computeRefund(snap, { itemIds: ["nope"] })).toThrow(/Unknown order item/);
  });

  it("computes 0 on a fully-emptied order (clamp lower bound)", () => {
    const specs: ItemSpec[] = [
      { id: "i1", lineTotalCents: 5000, poId: "poA", itemStatus: OrderItemStatus.REFUNDED },
      { id: "i2", lineTotalCents: 3000, poId: "poA", itemStatus: OrderItemStatus.REFUNDED },
    ];
    const snap = buildSnapshot(specs, [{ id: "poA", shippingFeeCents: 400 }]);
    snap.refundedTotalCents = snap.totalCents; // everything already returned
    const r = computeRefund(snap, { itemIds: [] });
    expect(r.partsCents).toBe(0);
    expect(r.installCents).toBe(0);
    expect(r.shippingCents).toBe(0);
    expect(r.taxCents).toBe(0);
    expect(r.amountCents).toBe(0);
    expect(r.isFinal).toBe(true);
  });
});
