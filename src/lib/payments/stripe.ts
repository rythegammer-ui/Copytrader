import Stripe from "stripe";
import { PayProvider, RefundStatus } from "@/lib/enums";
import type { PaymentProviderApi } from "@/lib/payments/provider";

let stripeClient: Stripe | null = null;

export function getStripe(): Stripe {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error("STRIPE_SECRET_KEY not configured");
  }
  if (!stripeClient) {
    stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });
  }
  return stripeClient;
}

export const stripeProvider: PaymentProviderApi = {
  name: PayProvider.STRIPE,

  async createIntent(amountCents, currency, metadata) {
    const intent = await getStripe().paymentIntents.create({
      amount: amountCents,
      currency,
      metadata,
      automatic_payment_methods: { enabled: true },
    });
    if (!intent.client_secret) throw new Error("Stripe returned no client secret");
    return { intentId: intent.id, clientSecret: intent.client_secret };
  },

  async cancelIntent(intentId) {
    try {
      await getStripe().paymentIntents.cancel(intentId);
    } catch {
      // Best-effort: already-cancelled or already-succeeded intents throw.
    }
  },

  async retrieveIntent(intentId) {
    const intent = await getStripe().paymentIntents.retrieve(intentId);
    return { amountCents: intent.amount, currency: intent.currency, status: intent.status };
  },

  async createRefund(intentId, amountCents) {
    const refund = await getStripe().refunds.create({
      payment_intent: intentId,
      amount: amountCents,
    });
    return {
      refundId: refund.id,
      status: refund.status === "succeeded" ? RefundStatus.SUCCEEDED : RefundStatus.PENDING,
    };
  },
};
