import { describe, it, expect } from "vitest";
import { intentSaysPaid, intentInFlight } from "@/lib/payments";

describe("reading a payment intent's status", () => {
  it("treats a succeeded intent as paid, in either spelling", () => {
    // Stripe returns lowercase; the mock provider returns our PaymentStatus.
    expect(intentSaysPaid("succeeded")).toBe(true);
    expect(intentSaysPaid("SUCCEEDED")).toBe(true);
  });

  it("does not treat an uncaptured authorization as paid", () => {
    // requires_capture is an authorization that expires in days if not taken.
    // Treating it as paid would fan purchase orders out to suppliers against
    // money the shop does not have.
    expect(intentSaysPaid("requires_capture")).toBe(false);
  });

  it("does not treat an in-progress bank debit as paid", () => {
    expect(intentSaysPaid("processing")).toBe(false);
  });

  it("does not treat an unstarted or failed intent as paid", () => {
    for (const s of ["requires_payment_method", "requires_confirmation", "canceled", "REQUIRES_PAYMENT", "FAILED"]) {
      expect(intentSaysPaid(s)).toBe(false);
    }
  });

  it("counts anything still resolving as in flight, so it is never cancelled", () => {
    for (const s of ["processing", "requires_action", "requires_capture"]) {
      expect(intentInFlight(s)).toBe(true);
    }
  });

  it("does not call a dead intent in flight", () => {
    for (const s of ["canceled", "requires_payment_method", "succeeded"]) {
      expect(intentInFlight(s)).toBe(false);
    }
  });
});

describe("the mock provider mirrors Stripe's refund idempotency", () => {
  it("returns the same refund for the same key, and a different one otherwise", async () => {
    const { mockProvider } = await import("@/lib/payments/mock");
    const a = await mockProvider.createRefund("mock_pi_x", 1000, "slot-1");
    const b = await mockProvider.createRefund("mock_pi_x", 1000, "slot-1");
    const c = await mockProvider.createRefund("mock_pi_x", 1000, "slot-2");
    expect(a.refundId).toBe(b.refundId);
    expect(a.refundId).not.toBe(c.refundId);
  });
});
