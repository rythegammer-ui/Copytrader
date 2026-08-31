import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { OrderStatus, PaymentStatus, PayProvider, Role, statusLabel } from "@/lib/enums";
import { formatCents } from "@/lib/money";
import { requirePageUser } from "@/lib/page-auth";
import { MockPaymentForm } from "@/components/checkout/MockPaymentForm";
import { RetryPaymentButton } from "@/components/checkout/RetryPaymentButton";
import { StripePaymentForm } from "@/components/checkout/StripePaymentForm";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Pay" };

export default async function PayPage({ params }: { params: { orderId: string } }) {
  const user = await requirePageUser([Role.CUSTOMER], `/checkout/pay/${params.orderId}`);

  const order = await db.order.findUnique({
    where: { id: params.orderId },
    include: { payments: { orderBy: { createdAt: "desc" } } },
  });
  if (!order || order.userId !== user.id) notFound();

  const awaitingPayment =
    order.status === OrderStatus.PENDING_PAYMENT || order.status === OrderStatus.PAYMENT_FAILED;

  if (!awaitingPayment) {
    if (order.status === OrderStatus.CANCELLED) {
      return (
        <div className="mx-auto max-w-2xl px-4 py-16 text-center sm:px-6">
          <h1 className="text-2xl font-bold text-slate-900">Order {order.orderNumber}</h1>
          <p className="mt-3 text-sm text-slate-600">
            This order was cancelled and can no longer be paid.
          </p>
          <Link href="/parts" className="btn-primary mt-6">
            Browse parts
          </Link>
        </div>
      );
    }
    // Already paid (or beyond) — never show a payment form again.
    redirect(`/checkout/success/${order.id}`);
  }

  const activePayment =
    order.status === OrderStatus.PENDING_PAYMENT
      ? order.payments.find((p) => p.status === PaymentStatus.REQUIRES_PAYMENT) ?? null
      : null;
  const lastFailed = order.payments.find((p) => p.status === PaymentStatus.FAILED) ?? null;

  return (
    <div className="mx-auto max-w-lg px-4 py-10 sm:px-6">
      <div className="mb-6 text-center">
        <h1 className="text-2xl font-bold text-slate-900">Pay for order {order.orderNumber}</h1>
        <p className="mt-1 text-sm text-slate-600">
          {statusLabel(order.status)} · total{" "}
          <span className="font-semibold text-slate-900">{formatCents(order.totalCents)}</span>
        </p>
      </div>

      {activePayment ? (
        activePayment.provider === PayProvider.MOCK ? (
          <MockPaymentForm
            intentId={activePayment.providerIntentId}
            amountCents={activePayment.amountCents}
            orderId={order.id}
          />
        ) : (
          <StripePaymentForm
            clientSecret={activePayment.clientSecret ?? ""}
            orderId={order.id}
            amountCents={activePayment.amountCents}
          />
        )
      ) : (
        <div className="card p-6 text-center">
          <p className="text-4xl" aria-hidden>
            💳
          </p>
          <h2 className="mt-3 text-lg font-bold text-slate-900">
            {order.status === OrderStatus.PAYMENT_FAILED
              ? "Your last payment attempt failed"
              : "No payment attempt is open"}
          </h2>
          {lastFailed?.lastError && (
            <p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {lastFailed.lastError}
            </p>
          )}
          <p className="mt-2 text-sm text-slate-600">
            No worries — nothing was charged. Start a fresh attempt below.
          </p>
          <div className="mt-4 flex justify-center">
            <RetryPaymentButton orderId={order.id} />
          </div>
        </div>
      )}

      <p className="mt-6 text-center text-sm text-slate-500">
        <Link href="/cart" className="font-medium text-brand-700 hover:underline">
          Back to cart
        </Link>
      </p>
    </div>
  );
}
