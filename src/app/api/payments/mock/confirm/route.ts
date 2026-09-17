import { z } from "zod";
import { api, jsonOk, parseBody } from "@/lib/api";
import { db } from "@/lib/db";
import { PayProvider } from "@/lib/enums";
import { ApiError } from "@/lib/errors";
import { handlePaymentFailed, handlePaymentSucceeded, stripeConfigured } from "@/lib/payments";
import { getCurrentUser, tokenOpensOrder } from "@/lib/session";

export const dynamic = "force-dynamic";
// Multi-step transactions + payment-provider calls: allow more than the 10s serverless default.
export const maxDuration = 30;

const zConfirm = z.object({
  intentId: z.string().min(1),
  outcome: z.enum(["succeed", "fail"]),
  /** A guest's order access token, when there is no session. */
  accessToken: z.string().min(1).optional(),
});

/**
 * POST /api/payments/mock/confirm — the owning customer, or a guest holding
 * the order's access token.
 * Demo-mode payment confirmation with full parity to the Stripe webhook: the
 * same idempotent handlers flip the order and fan out POs/appointments.
 * Hidden (404) whenever real Stripe is configured.
 */
export const POST = api(async (req) => {
  {
    if (stripeConfigured()) throw new ApiError("NOT_FOUND", "Not found", 404);
    const user = await getCurrentUser();
    const body = await parseBody(req, zConfirm);

    const payment = await db.payment.findUnique({
      where: { providerIntentId: body.intentId },
      include: { order: true },
    });
    if (!payment || payment.provider !== PayProvider.MOCK) {
      throw new ApiError("NOT_FOUND", "Payment not found", 404);
    }
    // Same rule as the real payment page: a session that owns the order, or
    // the token that opens it. Nothing else can confirm a payment.
    const viaToken = tokenOpensOrder(payment.orderId, body.accessToken);
    if (!viaToken && payment.order.userId !== user?.id) {
      throw new ApiError("FORBIDDEN", "Not your order", 403);
    }

    if (body.outcome === "succeed") {
      const result = await handlePaymentSucceeded({
        provider: PayProvider.MOCK,
        intentId: body.intentId,
        eventId: `mock:${body.intentId}:succeeded`,
        eventType: "mock.payment_succeeded",
      });
      if (!result.ok) {
        throw new ApiError("PAYMENT_ERROR", result.error ?? "Payment could not be confirmed", 409);
      }
      return jsonOk({ ...result, next: `/checkout/success/${payment.orderId}` });
    }

    const result = await handlePaymentFailed({
      provider: PayProvider.MOCK,
      intentId: body.intentId,
      eventId: `mock:${body.intentId}:failed`,
      eventType: "mock.payment_failed",
      errorMessage: "Card declined (simulated)",
    });
    return jsonOk(result);
  }
});
