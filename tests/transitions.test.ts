import { describe, expect, it } from "vitest";
import { POStatus, ShipTo, poTerminalDelivered } from "@/lib/enums";
import { carrierTrackingUrl, SYSTEM_ACTOR, TransitionError } from "@/lib/transitions";

// NOTE: transitionPO/transitionAppointment/rollUpOrderStatus require a Prisma
// transaction client and are exercised through the API layer — DB-backed
// transition tests are intentionally out of scope here (tests never
// instantiate a PrismaClient). This file covers the pure logic that ships in
// the transitions/enums modules.

describe("carrierTrackingUrl", () => {
  it("maps the known carriers", () => {
    expect(carrierTrackingUrl("UPS", "1Z999AA10123456784")).toBe(
      "https://www.ups.com/track?tracknum=1Z999AA10123456784",
    );
    expect(carrierTrackingUrl("FEDEX", "123456789012")).toBe(
      "https://www.fedex.com/fedextrack/?trknbr=123456789012",
    );
    expect(carrierTrackingUrl("USPS", "9400100000000000000000")).toBe(
      "https://tools.usps.com/go/TrackConfirmAction?tLabels=9400100000000000000000",
    );
    expect(carrierTrackingUrl("DHL", "JD014600003RU")).toBe(
      "https://www.dhl.com/us-en/home/tracking.html?tracking-id=JD014600003RU",
    );
  });

  it("normalizes carrier spelling (case + punctuation)", () => {
    expect(carrierTrackingUrl("FedEx", "X1")).toContain("fedextrack");
    expect(carrierTrackingUrl("usps", "X1")).toContain("usps.com");
    expect(carrierTrackingUrl("U.P.S.", "X1")).toContain("ups.com");
  });

  it("URL-encodes the tracking number", () => {
    expect(carrierTrackingUrl("UPS", "1Z 999&x")).toBe(
      `https://www.ups.com/track?tracknum=${encodeURIComponent("1Z 999&x")}`,
    );
  });

  it("returns null for unknown carriers", () => {
    expect(carrierTrackingUrl("PonyExpress", "X1")).toBeNull();
    expect(carrierTrackingUrl("", "X1")).toBeNull();
  });
});

describe("poTerminalDelivered matrix", () => {
  it("INSTALLER-destined POs are terminal ONLY at RECEIVED", () => {
    expect(poTerminalDelivered(POStatus.RECEIVED, ShipTo.INSTALLER)).toBe(true);
    expect(poTerminalDelivered(POStatus.DELIVERED, ShipTo.INSTALLER)).toBe(false);
    expect(poTerminalDelivered(POStatus.SHIPPED, ShipTo.INSTALLER)).toBe(false);
    expect(poTerminalDelivered(POStatus.CONFIRMED, ShipTo.INSTALLER)).toBe(false);
    expect(poTerminalDelivered(POStatus.PENDING_CONFIRMATION, ShipTo.INSTALLER)).toBe(false);
    expect(poTerminalDelivered(POStatus.REJECTED, ShipTo.INSTALLER)).toBe(false);
    expect(poTerminalDelivered(POStatus.CANCELLED, ShipTo.INSTALLER)).toBe(false);
  });

  it("HOME-destined POs are terminal at DELIVERED or RECEIVED", () => {
    expect(poTerminalDelivered(POStatus.DELIVERED, ShipTo.HOME)).toBe(true);
    expect(poTerminalDelivered(POStatus.RECEIVED, ShipTo.HOME)).toBe(true);
    expect(poTerminalDelivered(POStatus.SHIPPED, ShipTo.HOME)).toBe(false);
    expect(poTerminalDelivered(POStatus.CONFIRMED, ShipTo.HOME)).toBe(false);
    expect(poTerminalDelivered(POStatus.PENDING_CONFIRMATION, ShipTo.HOME)).toBe(false);
    expect(poTerminalDelivered(POStatus.REJECTED, ShipTo.HOME)).toBe(false);
    expect(poTerminalDelivered(POStatus.CANCELLED, ShipTo.HOME)).toBe(false);
  });
});

describe("TransitionError / SYSTEM_ACTOR", () => {
  it("defaults illegal transitions to HTTP 409", () => {
    const err = new TransitionError("Illegal transition X -> Y");
    expect(err.status).toBe(409);
    expect(err.message).toMatch(/Illegal transition/);
  });

  it("carries explicit statuses (403 for wrong-actor)", () => {
    expect(new TransitionError("nope", 403).status).toBe(403);
  });

  it("SYSTEM_ACTOR is a userless SYSTEM role", () => {
    expect(SYSTEM_ACTOR.role).toBe("SYSTEM");
    expect(SYSTEM_ACTOR.userId).toBeNull();
  });
});
