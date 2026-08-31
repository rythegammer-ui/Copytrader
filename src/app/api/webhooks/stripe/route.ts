import type Stripe from "stripe";
import { api, jsonOk } from "@/lib/api";
import { db } from "@/lib/db";
import { EntityType, PayProvider, RefundStatus, Role } from "@/lib/enums";
import { ApiError } from "@/lib/errors";
import { logEvent, notifyMany } from "@/lib/events";
import { handlePaymentFailed, handlePaymentSucceeded, stripeConfigured } from "@/lib/payments";
import { getStripe } from "@/lib/payments/stripe";

export const dynamic = "force-dynamic";

// Refund lifecycle events vary by Stripe API version; match all spellings.
function isRefundStatusEvent(type: string): boolean {
  return type === "refund.updated" || type === "refund.failed" || type === "charge.refund.updated";
}

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
    } else if (isRefundStatusEvent(event.type)) {
      // Stripe refunds start PENDING — reconcile the final outcome onto the
      // Refund row and page admins when one fails (books need manual review).
      const stripeRefund = event.data.object as Stripe.Refund;
      const refund = await db.refund.findFirst({
        where: { providerRefundId: stripeRefund.id },
        include: { order: true },
      });
      if (refund) {
        const nextStatus =
          stripeRefund.status === "succeeded"
            ? RefundStatus.SUCCEEDED
            : stripeRefund.status === "failed" || stripeRefund.status === "canceled"
              ? RefundStatus.FAILED
              : RefundStatus.PENDING;
        if (nextStatus !== refund.status) {
          await db.$transaction(async (tx) => {
            await tx.refund.update({ where: { id: refund.id }, data: { status: nextStatus } });
            await logEvent(tx, {
              orderId: refund.orderId,
              entityType: EntityType.REFUND,
              entityId: refund.id,
              action: "provider_status",
              internal: nextStatus !== RefundStatus.SUCCEEDED,
              actorRole: "SYSTEM",
              message:
                nextStatus === RefundStatus.SUCCEEDED
                  ? `Refund of $${(refund.amountCents / 100).toFixed(2)} settled`
                  : `Stripe reports the refund ${stripeRefund.status} — review required`,
            });
            if (nextStatus === RefundStatus.FAILED) {
              const admins = await tx.user.findMany({
                where: { role: Role.ADMIN },
                select: { id: true },
              });
              await notifyMany(tx, admins.map((u) => u.id), {
                type: "refund_failed",
                title: `Refund failed on ${refund.order.orderNumber}`,
                body: "Stripe could not complete a refund that was recorded as issued. Reconcile manually.",
                href: `/admin/orders/${refund.orderId}`,
              });
            }
          });
        }
      }
    }

    return jsonOk({ received: true });
  },
  { skipCsrf: true },
);
