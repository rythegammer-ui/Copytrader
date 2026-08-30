/**
 * Payment provider abstraction. STRIPE is used when STRIPE_SECRET_KEY is set;
 * otherwise the built-in MOCK provider gives full demo parity. Both feed the
 * SAME success/failure handlers so money paths never diverge.
 */

export interface CreatedIntent {
  intentId: string;
  clientSecret: string;
}

export interface RetrievedIntent {
  amountCents: number;
  currency: string;
  status: string;
}

export interface ProviderRefund {
  refundId: string;
  status: string; // RefundStatus
}

export interface PaymentProviderApi {
  name: string; // PayProvider
  createIntent(amountCents: number, currency: string, metadata: Record<string, string>): Promise<CreatedIntent>;
  cancelIntent(intentId: string): Promise<void>;
  retrieveIntent(intentId: string): Promise<RetrievedIntent | null>;
  createRefund(intentId: string, amountCents: number): Promise<ProviderRefund>;
}
