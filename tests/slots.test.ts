import { describe, expect, it } from "vitest";
import { blocksNeeded, blockStartsForDate, localToUtc, type ShopSchedule } from "@/lib/slots";

/** Central-Time shop: Mon-Fri, 08:00-18:00 local, 2h blocks, fixed UTC-6. */
const ctShop: ShopSchedule = {
  id: "shop_ct",
  bays: 2,
  openMinutes: 480, // 08:00
  closeMinutes: 1080, // 18:00
  slotMinutes: 120,
  daysOpenMask: 62, // Mon-Fri (Sun=1 .. Sat=64)
  tzOffsetMinutes: -360,
};

/** Same hours but open Mon-Sat (mask 126). */
const satShop: ShopSchedule = { ...ctShop, id: "shop_sat", daysOpenMask: 126 };

// 2026-03-01 is a Sunday; 2026-03-02 Monday; 2026-03-07 Saturday.
const YEAR = 2026;
const MARCH = 2; // 0-based month

describe("blocksNeeded", () => {
  it("scales labor tenths (x6 minutes) into ceil'd 2h blocks with a 1-block floor", () => {
    expect(blocksNeeded(10, 120)).toBe(1); // 1.0h = 60min -> 1 block
    expect(blocksNeeded(25, 120)).toBe(2); // 2.5h = 150min -> 2 blocks
    expect(blocksNeeded(45, 120)).toBe(3); // 4.5h = 270min -> 3 blocks
    expect(blocksNeeded(20, 120)).toBe(1); // exactly one block
    expect(blocksNeeded(21, 120)).toBe(2); // one minute over -> next block
    expect(blocksNeeded(1, 120)).toBe(1); // floor of one block
  });
});

describe("localToUtc", () => {
  it("converts shop-local wall time to the UTC instant (10:00 CT -> 16:00 UTC)", () => {
    const at = localToUtc(ctShop, YEAR, MARCH, 2, 600); // 10:00 local
    expect(at.toISOString()).toBe("2026-03-02T16:00:00.000Z");
  });

  it("round-trips: UTC instant shifted by the offset lands back on the local wall time", () => {
    const at = localToUtc(ctShop, YEAR, MARCH, 2, 480); // 08:00 local
    const local = new Date(at.getTime() + ctShop.tzOffsetMinutes * 60_000);
    expect(local.getUTCHours() * 60 + local.getUTCMinutes()).toBe(480);
    expect(local.getUTCDate()).toBe(2);
  });

  it("handles an eastern offset the same way (10:00 ET -> 15:00 UTC)", () => {
    const etShop: ShopSchedule = { ...ctShop, tzOffsetMinutes: -300 };
    expect(localToUtc(etShop, YEAR, MARCH, 2, 600).toISOString()).toBe("2026-03-02T15:00:00.000Z");
  });
});

describe("blockStartsForDate", () => {
  it("returns no blocks on a closed day (Sunday, mask 62)", () => {
    expect(blockStartsForDate(ctShop, YEAR, MARCH, 1)).toEqual([]);
  });

  it("returns no blocks on Saturday for a Mon-Fri shop, but blocks for a Mon-Sat shop", () => {
    expect(blockStartsForDate(ctShop, YEAR, MARCH, 7)).toEqual([]);
    expect(blockStartsForDate(satShop, YEAR, MARCH, 7).length).toBe(5);
    // Sunday stays closed even with mask 126
    expect(blockStartsForDate(satShop, YEAR, MARCH, 8)).toEqual([]);
  });

  it("emits every block start within open/close bounds on an open day", () => {
    const starts = blockStartsForDate(ctShop, YEAR, MARCH, 2); // Monday
    // 08:00, 10:00, 12:00, 14:00, 16:00 local — the 18:00 block would end past close.
    expect(starts).toHaveLength(5);
    expect(starts[0].toISOString()).toBe("2026-03-02T14:00:00.000Z"); // 08:00 CT
    expect(starts[4].toISOString()).toBe("2026-03-02T22:00:00.000Z"); // 16:00 CT
    // strictly ascending, spaced by slotMinutes
    for (let i = 1; i < starts.length; i++) {
      expect(starts[i].getTime() - starts[i - 1].getTime()).toBe(120 * 60_000);
    }
  });

  it("respects a shorter day (last block must END by closeMinutes)", () => {
    const shortShop: ShopSchedule = { ...ctShop, closeMinutes: 1020 }; // 17:00 close
    const starts = blockStartsForDate(shortShop, YEAR, MARCH, 2);
    // 08:00..14:00 starts only — a 16:00 block would end 18:00 > 17:00.
    expect(starts).toHaveLength(4);
  });
});
