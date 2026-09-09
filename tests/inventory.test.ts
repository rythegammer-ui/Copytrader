import { describe, it, expect } from "vitest";
import { priceQuote, type QuoteItemInput } from "@/lib/pricing";

const SUPPLIERS = { s1: { shippingFlatCents: 1499, shippingPerItemCents: 0 } };

function line(over: Partial<QuoteItemInput> = {}): QuoteItemInput {
  return {
    partId: "p1",
    qty: 1,
    priceCents: 10000,
    supplierId: "s1",
    supplierCostCents: 0,
    installEligible: false,
    laborHoursTenths: 10,
    installFixedFeeCents: null,
    withInstall: false,
    installerId: null,
    installerHourlyRateCents: null,
    apptStartAt: null,
    shipTo: "HOME",
    ...over,
  };
}

describe("local pickup and shipping", () => {
  it("charges shipping on a normal shippable line", () => {
    const q = priceQuote([line()], SUPPLIERS, 825);
    expect(q.shippingTotalCents).toBe(1499);
  });

  it("charges no shipping when the only line is local pickup", () => {
    const q = priceQuote([line({ localPickupOnly: true })], SUPPLIERS, 825);
    expect(q.shippingTotalCents).toBe(0);
    // Tax still applies to the part itself.
    expect(q.taxCents).toBe(825);
  });

  it("bills a mixed group only for the pieces that actually ship", () => {
    const q = priceQuote(
      [line({ partId: "a", localPickupOnly: true, priceCents: 100000 }), line({ partId: "b", priceCents: 5000 })],
      SUPPLIERS,
      825,
    );
    // The $1,000 pickup item must not drag the group over the free-shipping
    // threshold, and must not add a per-item charge.
    expect(q.groups).toHaveLength(1);
    expect(q.groups[0].shippableQty).toBe(1);
    expect(q.shippingTotalCents).toBe(1499);
  });

  it("keeps free shipping keyed to the shippable subtotal", () => {
    const q = priceQuote([line({ priceCents: 20000 })], SUPPLIERS, 825);
    expect(q.shippingTotalCents).toBe(0);
  });
});
