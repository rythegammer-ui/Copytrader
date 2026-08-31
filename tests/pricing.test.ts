import { afterEach, describe, expect, it } from "vitest";
import { ShipTo } from "@/lib/enums";
import {
  ceilDiv,
  destinationKey,
  FREE_SHIP_THRESHOLD_CENTS,
  installUnitCents,
  mulBps,
  priceQuote,
  taxRateBps,
  type QuoteItemInput,
} from "@/lib/pricing";

const RATE = 825; // 8.25%

function baseItem(overrides: Partial<QuoteItemInput> & { partId: string }): QuoteItemInput {
  return {
    qty: 1,
    priceCents: 1000,
    supplierId: "supA",
    supplierCostCents: 600,
    installEligible: true,
    laborHoursTenths: 10,
    installFixedFeeCents: null,
    withInstall: false,
    installerId: null,
    installerHourlyRateCents: null,
    apptStartAt: null,
    shipTo: ShipTo.HOME,
    ...overrides,
  };
}

describe("mulBps / ceilDiv", () => {
  it("computes exact basis-point products", () => {
    expect(mulBps(10000, 825)).toBe(825);
    expect(mulBps(0, 825)).toBe(0);
    expect(mulBps(10000, 0)).toBe(0);
  });

  it("rounds half up at the .5 boundary (Math.round semantics)", () => {
    // 600 * 25 / 10000 = 1.5 -> 2
    expect(mulBps(600, 25)).toBe(2);
    // 3333 * 825 / 10000 = 274.9725 -> 275
    expect(mulBps(3333, 825)).toBe(275);
    // tiny amounts round to zero
    expect(mulBps(1, 825)).toBe(0);
  });

  it("ceilDiv always rounds up", () => {
    expect(ceilDiv(10, 3)).toBe(4);
    expect(ceilDiv(9, 3)).toBe(3);
    expect(ceilDiv(1, 10)).toBe(1);
    expect(ceilDiv(0, 10)).toBe(0);
  });
});

describe("taxRateBps env parsing", () => {
  const original = process.env.TAX_RATE_BPS;
  afterEach(() => {
    if (original === undefined) delete process.env.TAX_RATE_BPS;
    else process.env.TAX_RATE_BPS = original;
  });

  it("reads TAX_RATE_BPS and falls back to 825", () => {
    process.env.TAX_RATE_BPS = "700";
    expect(taxRateBps()).toBe(700);
    delete process.env.TAX_RATE_BPS;
    expect(taxRateBps()).toBe(825);
    process.env.TAX_RATE_BPS = "not-a-number";
    expect(taxRateBps()).toBe(825);
    process.env.TAX_RATE_BPS = "-5";
    expect(taxRateBps()).toBe(825);
  });
});

describe("installUnitCents", () => {
  it("uses the fixed fee override when present", () => {
    expect(installUnitCents({ installFixedFeeCents: 4999, laborHoursTenths: 20 }, 12000)).toBe(4999);
  });

  it("computes labor * rate with ceil rounding on tenths", () => {
    // 1.5h @ $120/hr = ceil(15 * 12000 / 10) = 18000
    expect(installUnitCents({ installFixedFeeCents: null, laborHoursTenths: 15 }, 12000)).toBe(18000);
    // 0.5h @ $95/hr = ceil(5 * 9500 / 10) = 4750
    expect(installUnitCents({ installFixedFeeCents: null, laborHoursTenths: 5 }, 9500)).toBe(4750);
    // non-exact division rounds UP: ceil(7 * 11111 / 10) = ceil(7777.7) = 7778
    expect(installUnitCents({ installFixedFeeCents: null, laborHoursTenths: 7 }, 11111)).toBe(7778);
  });
});

describe("destinationKey", () => {
  it("ignores installerId for HOME shipments", () => {
    expect(destinationKey("s1", ShipTo.HOME, "shop9")).toBe(destinationKey("s1", ShipTo.HOME, null));
  });

  it("separates HOME from INSTALLER destinations for the same supplier", () => {
    const home = destinationKey("s1", ShipTo.HOME, null);
    const shopKey = destinationKey("s1", ShipTo.INSTALLER, "shop9");
    expect(home).not.toBe(shopKey);
    expect(destinationKey("s1", ShipTo.INSTALLER, "shop9")).not.toBe(
      destinationKey("s1", ShipTo.INSTALLER, "shopX"),
    );
  });
});

describe("priceQuote — worked example against SPEC formulas", () => {
  // Supplier A: flat 999 + 50/item; Supplier B: flat 799 + 0/item.
  const suppliers = {
    supA: { shippingFlatCents: 999, shippingPerItemCents: 50 },
    supB: { shippingFlatCents: 799, shippingPerItemCents: 0 },
  };

  const appt = new Date("2026-09-15T15:00:00Z");
  const items: QuoteItemInput[] = [
    // Line 1: qty 2 @ $40, installed at shop i1 ($120/hr, 1.5h each), ship to shop.
    baseItem({
      partId: "p1",
      qty: 2,
      priceCents: 4000,
      supplierId: "supA",
      supplierCostCents: 2500,
      laborHoursTenths: 15,
      withInstall: true,
      installerId: "i1",
      installerHourlyRateCents: 12000,
      apptStartAt: appt,
      shipTo: ShipTo.INSTALLER,
    }),
    // Line 2: same supplier, ships HOME — must form a SECOND group.
    baseItem({ partId: "p2", qty: 1, priceCents: 9000, supplierId: "supA", supplierCostCents: 5000 }),
    // Line 3: supplier B, $160 part — crosses the free-shipping threshold.
    baseItem({ partId: "p3", qty: 1, priceCents: 16000, supplierId: "supB", supplierCostCents: 9000 }),
  ];

  const quote = priceQuote(items, suppliers, RATE);

  it("prices each line (lineTotal = unit * qty; installUnit = ceil(labor*rate/10))", () => {
    const l1 = quote.lines[0];
    expect(l1.lineTotalCents).toBe(8000);
    expect(l1.installUnitCents).toBe(18000); // 1.5h @ 12000
    expect(l1.installTotalCents).toBe(36000); // * qty 2
    expect(l1.groupKey).toBe(destinationKey("supA", ShipTo.INSTALLER, "i1"));
    expect(quote.lines[1].installTotalCents).toBe(0);
  });

  it("groups shipping by (supplier, shipTo, installer) — same supplier home+shop = 2 groups", () => {
    expect(quote.groups).toHaveLength(3);
    const byKey = new Map(quote.groups.map((g) => [g.key, g]));
    const gShop = byKey.get(destinationKey("supA", ShipTo.INSTALLER, "i1"));
    const gHomeA = byKey.get(destinationKey("supA", ShipTo.HOME, null));
    const gHomeB = byKey.get(destinationKey("supB", ShipTo.HOME, null));
    // 8000 parts < 15000 threshold: 999 + 50*2
    expect(gShop?.shippingCents).toBe(1099);
    // 9000 < 15000: 999 + 50*1
    expect(gHomeA?.shippingCents).toBe(1049);
    // 16000 >= FREE_SHIP_THRESHOLD_CENTS: free
    expect(FREE_SHIP_THRESHOLD_CENTS).toBe(15000);
    expect(gHomeB?.shippingCents).toBe(0);
  });

  it("computes subtotals, ONE-rounding tax on parts+shipping (labor untaxed), and total", () => {
    expect(quote.partsSubtotalCents).toBe(33000); // 8000 + 9000 + 16000
    expect(quote.installSubtotalCents).toBe(36000);
    expect(quote.shippingTotalCents).toBe(2148); // 1099 + 1049 + 0

    // Tax is ONE rounding on the whole taxable base — never per line/group,
    // and the install subtotal contributes nothing.
    const taxableBase = quote.partsSubtotalCents + quote.shippingTotalCents;
    expect(quote.taxCents).toBe(mulBps(taxableBase, RATE));
    expect(quote.taxCents).toBe(2900); // round(35148 * 0.0825) = round(2899.71)

    expect(quote.totalCents).toBe(33000 + 36000 + 2148 + 2900);
    expect(quote.totalCents).toBe(74048);
  });

  it("drops install pricing for install-ineligible parts even when requested", () => {
    const q = priceQuote(
      [
        baseItem({
          partId: "p9",
          installEligible: false,
          withInstall: true,
          installerId: "i1",
          installerHourlyRateCents: 12000,
        }),
      ],
      suppliers,
      RATE,
    );
    expect(q.lines[0].withInstall).toBe(false);
    expect(q.installSubtotalCents).toBe(0);
  });

  it("throws when an install line is missing the installer rate", () => {
    expect(() =>
      priceQuote(
        [baseItem({ partId: "p1", withInstall: true, installerId: "i1", installerHourlyRateCents: null })],
        suppliers,
        RATE,
      ),
    ).toThrow(/Missing installer rate/);
  });
});
