import type Stripe from "stripe";
import { api, jsonOk } from "@/lib/api";
import { db } from "@/lib/db";
import { EntityType, OrderStatus, PayProvider, RefundStatus, Role } from "@/lib/enums";
import { ApiError } from "@/lib/errors";
import { logEvent, notifyMany } from "@/lib/events";
import { handlePaymentFailed, handlePaymentSucceeded, stripeConfigured } from "@/lib/payments";
import { getStripe } from "@/lib/payments/stripe";

export const dynamic = "force-dynamic";
// Multi-step transactions + payment-provider calls: allow more than the 10s serverless default.
export const maxDuration = 30;

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
          // A refund that had been recorded was already added to the order's
          // refundedTotalCents. If the provider now says it failed, that money
          // never went back to the customer, so it has to come off the total —
          // otherwise the order is booked as refunded, the balance is gone,
          // and nobody can ever refund it again.
          const wasCounted = Boolean(refund.providerRefundId) && refund.status !== RefundStatus.FAILED;
          const reverse = wasCounted && nextStatus === RefundStatus.FAILED;
          await db.$transaction(async (tx) => {
            await tx.refund.update({ where: { id: refund.id }, data: { status: nextStatus } });
            if (reverse) {
              await tx.order.update({
                where: { id: refund.orderId },
                data: { refundedTotalCents: { decrement: refund.amountCents } },
              });
              // The order may have been flipped to REFUNDED on the strength of
              // this refund. Put it back to a live status now the money is not
              // actually returned.
              const after = await tx.order.findUniqueOrThrow({
                where: { id: refund.orderId },
                select: { totalCents: true, refundedTotalCents: true, status: true },
              });
              if (
                after.status === OrderStatus.REFUNDED &&
                after.refundedTotalCents < after.totalCents
              ) {
                await tx.order.update({
                  where: { id: refund.orderId },
                  data: { status: OrderStatus.PAID },
                });
              }
            }
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
                  : reverse
                    ? `Stripe reports the refund ${stripeRefund.status}. $${(refund.amountCents / 100).toFixed(2)} put back on the order balance — the customer did NOT receive this money. Any items marked refunded for it need reviewing.`
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
                body: "Stripe could not complete a refund that was recorded as issued. The amount has been put back on the order balance, but any items marked refunded for it still need reviewing.",
                href: `/admin/orders/${refund.orderId}`,
              });
            }
          });
        }
      }
    } else if (event.type === "charge.dispute.created") {
      // A chargeback. Stripe has already pulled the money back and the shop
      // has a deadline to respond in the dashboard. Nothing here can contest
      // it, but an order silently losing its funds is far worse than a noisy
      // alert, so make it visible immediately.
      const dispute = event.data.object as Stripe.Dispute;
      const intentId =
        typeof dispute.payment_intent === "string"
          ? dispute.payment_intent
          : dispute.payment_intent?.id;
      const payment = intentId
        ? await db.payment.findUnique({
            where: { providerIntentId: intentId },
            include: { order: true },
          })
        : null;
      if (payment) {
        await db.$transaction(async (tx) => {
          await logEvent(tx, {
            orderId: payment.orderId,
            entityType: EntityType.PAYMENT,
            entityId: payment.id,
            action: "disputed",
            internal: true,
            actorRole: "SYSTEM",
            message: `Chargeback opened for $${(dispute.amount / 100).toFixed(2)} (reason: ${dispute.reason}). Respond in the Stripe dashboard before the deadline.`,
          });
          const admins = await tx.user.findMany({
            where: { role: Role.ADMIN },
            select: { id: true },
          });
          await notifyMany(tx, admins.map((u) => u.id), {
            type: "dispute_opened",
            title: `Chargeback on ${payment.order.orderNumber}`,
            body: `A customer disputed $${(dispute.amount / 100).toFixed(2)}. Respond in Stripe before the deadline or the money is lost.`,
            href: `/admin/orders/${payment.orderId}`,
          });
        });
      }
    } else if (event.type === "charge.refunded") {
      // A refund issued straight from the Stripe dashboard rather than through
      // the app. Reconciling it automatically risks double-counting against a
      // refund the app already recorded, so compare and report the gap instead
      // of guessing.
      const charge = event.data.object as Stripe.Charge;
      const intentId =
        typeof charge.payment_intent === "string"
          ? charge.payment_intent
          : charge.payment_intent?.id;
      const payment = intentId
        ? await db.payment.findUnique({
            where: { providerIntentId: intentId },
            include: { order: true, refunds: true },
          })
        : null;
      if (payment) {
        const recorded = payment.refunds
          .filter((r) => r.status !== RefundStatus.FAILED)
          .reduce((sum, r) => sum + r.amountCents, 0);
        if (charge.amount_refunded > recorded) {
          const gap = charge.amount_refunded - recorded;
          await db.$transaction(async (tx) => {
            await logEvent(tx, {
              orderId: payment.orderId,
              entityType: EntityType.PAYMENT,
              entityId: payment.id,
              action: "external_refund",
              internal: true,
              actorRole: "SYSTEM",
              message: `Stripe reports $${(charge.amount_refunded / 100).toFixed(2)} refunded on this charge but only $${(recorded / 100).toFixed(2)} is recorded here — $${(gap / 100).toFixed(2)} was refunded outside the app. The order totals do not include it.`,
            });
            const admins = await tx.user.findMany({
              where: { role: Role.ADMIN },
              select: { id: true },
            });
            await notifyMany(tx, admins.map((u) => u.id), {
              type: "external_refund",
              title: `Refund made outside the app on ${payment.order.orderNumber}`,
              body: `$${(gap / 100).toFixed(2)} was refunded in Stripe but is not in this order's books. Reconcile it.`,
              href: `/admin/orders/${payment.orderId}`,
            });
          });
        }
      }
    }

    return jsonOk({ received: true });
  },
  { skipCsrf: true },
);
