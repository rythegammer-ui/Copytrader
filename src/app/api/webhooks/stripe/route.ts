import type Stripe from "stripe";
import { api, jsonOk } from "@/lib/api";
import { PayProvider } from "@/lib/enums";
import { ApiError } from "@/lib/errors";
import { handlePaymentFailed, handlePaymentSucceeded, stripeConfigured } from "@/lib/payments";
import { getStripe } from "@/lib/payments/stripe";

export const dynamic = "force-dynamic";

/**
 * POST /api/webhooks/stripe — public, authenticated by the Stripe signature
 * (CSRF same-origin check skipped: webhooks are legitimately cross-origin).
 * Handled + unhandled event types both return {received:true}; only signature
 * failures (400) and missing configuration (501) error out so Stripe retries
 * appropriately.
 */
export const POST = api(
  async (req) => {
    if (!stripeConfigured()) {
      throw new ApiError("NOT_CONFIGURED", "Stripe is not configured", 501);
    }

    const payload = await req.text();
    const signature = req.headers.get("stripe-signature");
    if (!signature) {
      throw new ApiError("BAD_SIGNATURE", "Missing stripe-signature header", 400);
    }

    let event: Stripe.Event;
    try {
      event = getStripe().webhooks.constructEvent(
        payload,
        signature,
        process.env.STRIPE_WEBHOOK_SECRET!,
      );
    } catch {
      throw new ApiError("BAD_SIGNATURE", "Webhook signature verification failed", 400);
    }

    if (event.type === "payment_intent.succeeded") {
      const pi = event.data.object as Stripe.PaymentIntent;
      await handlePaymentSucceeded({
        provider: PayProvider.STRIPE,
        intentId: pi.id,
        eventId: event.id,
        eventType: event.type,
        providerAmountCents: pi.amount,
        providerCurrency: pi.currency,
      });
    } else if (event.type === "payment_intent.payment_failed") {
      const pi = event.data.object as Stripe.PaymentIntent;
      await handlePaymentFailed({
        provider: PayProvider.STRIPE,
        intentId: pi.id,
        eventId: event.id,
        eventType: event.type,
        errorMessage: pi.last_payment_error?.message ?? undefined,
      });
    }

    return jsonOk({ received: true });
  },
  { skipCsrf: true },
);
