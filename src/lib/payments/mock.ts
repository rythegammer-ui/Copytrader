import crypto from "crypto";
import { PayProvider, RefundStatus } from "@/lib/enums";
import { db } from "@/lib/db";
import type { PaymentProviderApi } from "@/lib/payments/provider";

/**
 * Mock provider: fully functional demo payments with no external service.
 * Intents are identified by mock_pi_* ids; the authoritative amount lives on
 * the Payment row (created together with the intent), which retrieveIntent
 * reads back — same verification path as Stripe.
 */
export const mockProvider: PaymentProviderApi = {
  name: PayProvider.MOCK,

  async createIntent(amountCents, currency) {
    const id = `mock_pi_${crypto.randomUUID().replace(/-/g, "")}`;
    return { intentId: id, clientSecret: `mock_cs_${crypto.randomUUID().replace(/-/g, "")}` };
  },

  async cancelIntent() {
    // Nothing to cancel server-side for the mock.
  },

  async retrieveIntent(intentId) {
    const payment = await db.payment.findUnique({ where: { providerIntentId: intentId } });
    if (!payment) return null;
    return { amountCents: payment.amountCents, currency: payment.currency, status: payment.status };
  },

  async createRefund() {
    return {
      refundId: `mock_re_${crypto.randomUUID().replace(/-/g, "")}`,
      status: RefundStatus.SUCCEEDED,
    };
  },
};
