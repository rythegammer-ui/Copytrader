import { describe, it, expect } from "vitest";
import { availableQty, isShort, shortMessage, type KitPiece, type StockFacts } from "@/lib/inventory";

function piece(over: Partial<KitPiece> & { stockQty?: number; trackStock?: boolean } = {}): KitPiece {
  const { stockQty = 1, trackStock = true, ...rest } = over;
  return {
    componentId: rest.componentId ?? "c1",
    qty: rest.qty ?? 1,
    component: rest.component ?? { trackStock, stockQty, name: "Hood" },
  };
}

const KIT: StockFacts = { trackStock: false, stockQty: 0, isKit: true };
const UNIT: StockFacts = { trackStock: true, stockQty: 3, isKit: false };
const DROPSHIP: StockFacts = { trackStock: false, stockQty: 0, isKit: false };

describe("plain part availability", () => {
  it("reports the on-hand count for a finite part", () => {
    expect(availableQty(UNIT)).toBe(3);
  });

  it("reports no limit for a dropshipped part", () => {
    expect(availableQty(DROPSHIP)).toBeNull();
  });

  it("never limits a dropshipped part however much is asked for", () => {
    expect(isShort(availableQty(DROPSHIP), 10)).toBe(false);
  });
});

describe("kit availability is bounded by its scarcest component", () => {
  it("takes the tightest component bound", () => {
    // Four fenders, one hood: the shop can build exactly one front clip.
    const pieces = [
      piece({ componentId: "hood", stockQty: 1 }),
      piece({ componentId: "fenders", stockQty: 4 }),
    ];
    expect(availableQty(KIT, pieces)).toBe(1);
  });

  it("goes to zero as soon as any single component is gone", () => {
    const pieces = [
      piece({ componentId: "hood", stockQty: 0 }),
      piece({ componentId: "fenders", stockQty: 4 }),
    ];
    expect(availableQty(KIT, pieces)).toBe(0);
  });

  it("divides by the quantity each kit consumes", () => {
    // A kit that eats two coils, with five coils on the shelf, builds two.
    const pieces = [piece({ componentId: "coils", qty: 2, stockQty: 5 })];
    expect(availableQty(KIT, pieces)).toBe(2);
  });

  it("ignores components that are themselves unlimited", () => {
    const pieces = [
      piece({ componentId: "hood", stockQty: 2 }),
      piece({ componentId: "clips", trackStock: false, stockQty: 0 }),
    ];
    expect(availableQty(KIT, pieces)).toBe(2);
  });

  it("is unlimited when every component is unlimited", () => {
    const pieces = [piece({ componentId: "clips", trackStock: false, stockQty: 0 })];
    expect(availableQty(KIT, pieces)).toBeNull();
  });

  it("falls back to its own count when it has no components", () => {
    expect(availableQty({ trackStock: true, stockQty: 2, isKit: true }, [])).toBe(2);
  });

  it("takes the lower of its own count and its components", () => {
    const pieces = [piece({ componentId: "hood", stockQty: 5 })];
    expect(availableQty({ trackStock: true, stockQty: 2, isKit: true }, pieces)).toBe(2);
  });
});

describe("the oversell guard the bundles needed", () => {
  it("blocks a second kit once the first consumed the only hood", () => {
    const soldOut = [piece({ componentId: "hood", stockQty: 0 })];
    const available = availableQty(KIT, soldOut);
    expect(isShort(available, 1)).toBe(true);
    expect(shortMessage("528i Front Clip", available)).toBe("528i Front Clip just sold out");
  });

  it("blocks asking for more kits than components allow", () => {
    const pieces = [piece({ componentId: "hood", stockQty: 1 })];
    const available = availableQty(KIT, pieces);
    expect(isShort(available, 2)).toBe(true);
    expect(shortMessage("528i Front Clip", available)).toBe("Only 1 of 528i Front Clip left");
  });

  it("allows exactly what is on hand", () => {
    const pieces = [piece({ componentId: "hood", stockQty: 2 })];
    expect(isShort(availableQty(KIT, pieces), 2)).toBe(false);
  });
});
