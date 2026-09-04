import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import {
  OrderItemStatus,
  OrderStatus,
  PaymentStatus,
  POStatus,
  RefundStatus,
  Role,
  ShipTo,
  statusLabel,
} from "@/lib/enums";
import { formatCents } from "@/lib/money";
import { formatDate, formatDateTime, formatShopTime } from "@/lib/format";
import { requirePageUser } from "@/lib/page-auth";
import { carrierTrackingUrl } from "@/lib/transitions";
import { itemDisplayStatus, laborLabel, statusBadgeClass } from "@/components/orders/order-utils";
import { OverrideButtons } from "@/components/admin/OverrideButtons";
import { AdminCancelButton, RetryRefundButton } from "@/components/admin/OrderActions";
import { RefundComposer, type ComposerItem } from "@/components/admin/RefundComposer";

export const metadata: Metadata = { title: "Order — admin" };
export const dynamic = "force-dynamic";

const CANCELLABLE_ORDER_STATUSES: string[] = [
  OrderStatus.PENDING_PAYMENT,
  OrderStatus.PAYMENT_FAILED,
  OrderStatus.PAID,
  OrderStatus.PROCESSING,
  OrderStatus.PARTIALLY_FULFILLED,
];

export default async function AdminOrderDetailPage({ params }: { params: { id: string } }) {
  await requirePageUser([Role.ADMIN], `/admin/orders/${params.id}`);

  const order = await db.order.findUnique({
    where: { id: params.id },
    include: {
      user: { select: { id: true, name: true, email: true, phone: true } },
      items: true,
      purchaseOrders: { include: { supplier: { select: { name: true } } }, orderBy: { createdAt: "asc" } },
      appointments: { include: { installer: true }, orderBy: { startAt: "asc" } },
      payments: { orderBy: [{ createdAt: "desc" }, { id: "desc" }] },
      refunds: {
        include: { createdBy: { select: { name: true } } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      },
    },
  });
  if (!order) notFound();

  const events = await db.eventLog.findMany({
    where: { orderId: order.id },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 200,
  });

  const poById = new Map(order.purchaseOrders.map((po) => [po.id, po]));
  const remainingCents = order.totalCents - order.refundedTotalCents;
  const hasSucceededPayment = order.payments.some((p) => p.status === PaymentStatus.SUCCEEDED);

  const canCancel = CANCELLABLE_ORDER_STATUSES.includes(order.status);
  const cancelledUnrefunded =
    order.status === OrderStatus.CANCELLED && order.paidAt !== null && remainingCents > 0;
  const showComposer = order.paidAt !== null && hasSucceededPayment && remainingCents > 0;

  // Margin: live (PENDING) items only — mirrors the KPI definition.
  const liveMarginCents = order.items
    .filter((i) => i.itemStatus === OrderItemStatus.PENDING)
    .reduce((s, i) => s + i.lineTotalCents - i.supplierCostCentsSnapshot * i.qty, 0);

  const composerItems: ComposerItem[] = order.items.map((i) => ({
    id: i.id,
    name: i.nameSnapshot,
    sku: i.skuSnapshot,
    qty: i.qty,
    lineTotalCents: i.lineTotalCents,
    installTotalCents: i.installTotalCents,
    withInstall: i.withInstall,
    installRefunded: i.installRefunded,
    itemStatus: i.itemStatus,
    poNumber: i.purchaseOrderId ? poById.get(i.purchaseOrderId)?.poNumber ?? null : null,
  }));

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      {/* ---- header ---- */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-slate-500">
            <Link href="/admin/orders" className="font-medium text-brand-700 hover:underline">
              Orders
            </Link>{" "}
            / {order.orderNumber}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold text-slate-900">{order.orderNumber}</h1>
            <span className={`badge ${statusBadgeClass(order.status)}`}>
              {statusLabel(order.status)}
            </span>
            {cancelledUnrefunded && (
              <span className="badge bg-red-100 text-red-800">
                Unrefunded: {formatCents(remainingCents)}
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-slate-600">
            Placed {formatDate(order.placedAt)}
            {order.paidAt ? ` · paid ${formatDateTime(order.paidAt)}` : " · not paid"}
          </p>
          {order.vehicleDesc && <p className="text-sm text-slate-600">Vehicle: {order.vehicleDesc}</p>}
          {order.status === OrderStatus.CANCELLED && order.cancelReason && (
            <p className="mt-1 text-sm text-red-700">Cancelled — {order.cancelReason}</p>
          )}
        </div>
        <div className="flex flex-col items-end gap-2">
          {cancelledUnrefunded && (
            <RetryRefundButton orderId={order.id} remainingCents={remainingCents} />
          )}
          {canCancel && <AdminCancelButton orderId={order.id} />}
          {canCancel && (
            <p className="max-w-[240px] text-right text-xs text-slate-500">
              Admin cancel is allowed pre-fulfillment; any paid balance is auto-refunded.
            </p>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* ---- items + margin ---- */}
          <section className="card overflow-x-auto">
            <div className="border-b border-slate-100 px-5 py-3">
              <h2 className="font-semibold text-slate-900">Items</h2>
            </div>
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-5 py-2">Item</th>
                  <th className="px-3 py-2 text-right">Line</th>
                  <th className="px-3 py-2 text-right">Install</th>
                  <th className="px-3 py-2 text-right">Cost</th>
                  <th className="px-3 py-2 text-right">Margin</th>
                  <th className="px-5 py-2 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {order.items.map((i) => {
                  const po = i.purchaseOrderId ? poById.get(i.purchaseOrderId) : undefined;
                  const display = itemDisplayStatus(i.itemStatus, po?.status ?? null);
                  const costCents = i.supplierCostCentsSnapshot * i.qty;
                  const marginCents = i.lineTotalCents - costCents;
                  return (
                    <tr key={i.id}>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={i.imageUrlSnapshot || "/images/placeholders/part.svg"}
                            alt={i.nameSnapshot}
                            className="h-10 w-10 flex-shrink-0 rounded-lg border border-slate-200 bg-slate-50 object-cover"
                          />
                          <div className="min-w-0">
                            <p className="font-medium text-slate-900">{i.nameSnapshot}</p>
                            <p className="text-xs text-slate-500">
                              {i.skuSnapshot} · {i.qty} × {formatCents(i.unitPriceCents)}
                              {po ? ` · ${po.poNumber}` : ""}
                              {i.shipTo === ShipTo.INSTALLER ? " · ship to shop" : ""}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-right font-medium text-slate-900">
                        {formatCents(i.lineTotalCents)}
                      </td>
                      <td className="px-3 py-3 text-right text-slate-600">
                        {i.withInstall ? (
                          <>
                            {formatCents(i.installTotalCents)}
                            {i.installRefunded && (
                              <span className="block text-xs text-purple-700">refunded</span>
                            )}
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-3 py-3 text-right text-slate-600">
                        {formatCents(costCents)}
                      </td>
                      <td
                        className={`px-3 py-3 text-right font-medium ${marginCents < 0 ? "text-red-700" : "text-green-700"}`}
                      >
                        {formatCents(marginCents)}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <span className={`badge ${statusBadgeClass(display)}`}>
                          {statusLabel(display)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-slate-200 text-sm font-semibold text-slate-900">
                  <td className="px-5 py-3">Totals</td>
                  <td className="px-3 py-3 text-right">{formatCents(order.partsSubtotalCents)}</td>
                  <td className="px-3 py-3 text-right">
                    {formatCents(order.installSubtotalCents)}
                  </td>
                  <td className="px-3 py-3" />
                  <td
                    className={`px-3 py-3 text-right ${liveMarginCents < 0 ? "text-red-700" : "text-green-700"}`}
                  >
                    {formatCents(liveMarginCents)}
                  </td>
                  <td className="px-5 py-3" />
                </tr>
              </tfoot>
            </table>
            <dl className="space-y-1 border-t border-slate-200 px-5 py-4 text-sm">
              <div className="flex justify-between text-slate-600">
                <dt>Shipping</dt>
                <dd>{formatCents(order.shippingTotalCents)}</dd>
              </div>
              <div className="flex justify-between text-slate-600">
                <dt>Tax ({(order.taxRateBps / 100).toFixed(2)}%)</dt>
                <dd>{formatCents(order.taxCents)}</dd>
              </div>
              <div className="flex justify-between font-semibold text-slate-900">
                <dt>Total</dt>
                <dd>{formatCents(order.totalCents)}</dd>
              </div>
              {order.refundedTotalCents > 0 && (
                <div className="flex justify-between text-purple-700">
                  <dt>Refunded</dt>
                  <dd>-{formatCents(order.refundedTotalCents)}</dd>
                </div>
              )}
            </dl>
          </section>

          {/* ---- purchase orders ---- */}
          <section>
            <h2 className="mb-3 text-lg font-semibold text-slate-900">Purchase orders</h2>
            {order.purchaseOrders.length === 0 ? (
              <p className="card p-5 text-sm text-slate-500">
                No purchase orders on this order
                {order.paidAt ? " — consistency alarm, check the attention queue." : "."}
              </p>
            ) : (
              <div className="space-y-4">
                {order.purchaseOrders.map((po) => {
                  const poItems = order.items.filter((i) => i.purchaseOrderId === po.id);
                  const trackingUrl =
                    po.trackingUrl ??
                    (po.carrier && po.trackingNumber
                      ? carrierTrackingUrl(po.carrier, po.trackingNumber)
                      : null);
                  const late =
                    po.dueAt !== null &&
                    po.dueAt.getTime() < Date.now() &&
                    (po.status === POStatus.PENDING_CONFIRMATION ||
                      po.status === POStatus.CONFIRMED);
                  return (
                    <div key={po.id} className="card p-5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-3">
                          <p className="font-semibold text-slate-900">{po.poNumber}</p>
                          <span className={`badge ${statusBadgeClass(po.status)}`}>
                            {statusLabel(po.status)}
                          </span>
                          {late && <span className="badge bg-red-100 text-red-800">Late</span>}
                        </div>
                        <p className="text-sm text-slate-600">
                          {po.supplier.name} → {po.shipTo === ShipTo.INSTALLER ? po.destName : "customer"}
                        </p>
                      </div>
                      <p className="mt-1 text-xs text-slate-500">
                        Cost {formatCents(po.supplierCostTotalCents)} · shipping charged{" "}
                        {formatCents(po.shippingFeeCents)}
                        {po.dueAt ? ` · due ${formatDate(po.dueAt)}` : ""}
                      </p>
                      {po.rejectReason && (
                        <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
                          Rejected: {po.rejectReason}
                        </p>
                      )}
                      {(po.carrier || trackingUrl) && (
                        <p className="mt-2 text-sm text-slate-600">
                          {po.carrier && <span>{po.carrier} </span>}
                          {trackingUrl ? (
                            <a
                              href={trackingUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-medium text-brand-700 hover:underline"
                            >
                              {po.trackingNumber ?? "Track"} →
                            </a>
                          ) : (
                            po.trackingNumber && <span>{po.trackingNumber}</span>
                          )}
                        </p>
                      )}
                      <ul className="mt-3 space-y-1 border-t border-slate-100 pt-3 text-sm text-slate-700">
                        {poItems.map((i) => (
                          <li key={i.id} className="flex items-center justify-between gap-3">
                            <span>
                              {i.nameSnapshot} <span className="text-slate-400">× {i.qty}</span>
                            </span>
                            {i.itemStatus !== OrderItemStatus.PENDING && (
                              <span className={`badge ${statusBadgeClass(i.itemStatus)}`}>
                                {statusLabel(i.itemStatus)}
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                      {po.status !== POStatus.CANCELLED && (
                        <OverrideButtons poId={po.id} status={po.status} />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* ---- appointments ---- */}
          {order.appointments.length > 0 && (
            <section>
              <h2 className="mb-3 text-lg font-semibold text-slate-900">Appointments</h2>
              <div className="space-y-4">
                {order.appointments.map((a) => (
                  <div key={a.id} className="card p-5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-3">
                        <p className="font-semibold text-slate-900">{a.installer.name}</p>
                        <span className={`badge ${statusBadgeClass(a.status)}`}>
                          {statusLabel(a.status)}
                        </span>
                      </div>
                      <p className="text-sm font-medium text-slate-900">
                        {formatShopTime(a.startAt, a.installer.tzOffsetMinutes)}
                      </p>
                    </div>
                    <p className="mt-1 text-sm text-slate-600">
                      {a.customerName}
                      {a.customerPhone ? ` · ${a.customerPhone}` : ""} ·{" "}
                      {laborLabel(a.totalLaborHoursTenths)} labor · {a.durationMinutes} min
                    </p>
                    {a.vehicleDesc && <p className="text-sm text-slate-600">{a.vehicleDesc}</p>}
                    {a.notes && <p className="mt-2 text-sm italic text-slate-500">{a.notes}</p>}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ---- timeline (incl. internal) ---- */}
          <section className="card">
            <div className="border-b border-slate-100 px-5 py-3">
              <h2 className="font-semibold text-slate-900">Full timeline</h2>
            </div>
            {events.length === 0 ? (
              <p className="p-5 text-sm text-slate-500">No events logged.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {events.map((e) => (
                  <li key={e.id} className="px-5 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm text-slate-900">{e.message}</p>
                      {e.internal && (
                        <span className="badge bg-slate-100 text-slate-500">internal</span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-slate-400">
                      {formatDateTime(e.createdAt)} · {e.actorRole ?? "SYSTEM"} · {e.action}
                      {e.fromStatus && e.toStatus ? ` · ${e.fromStatus} → ${e.toStatus}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* ---- sidebar ---- */}
        <div className="space-y-6">
          {/* customer contact */}
          <section className="card p-5 text-sm">
            <h2 className="mb-2 font-semibold text-slate-900">Customer</h2>
            <p className="font-medium text-slate-900">{order.user.name}</p>
            <p className="text-slate-600">{order.user.email}</p>
            {order.user.phone && <p className="text-slate-600">{order.user.phone}</p>}
            <div className="mt-3 border-t border-slate-100 pt-3">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Order contact
              </p>
              <p className="text-slate-600">{order.contactEmail}</p>
              {order.contactPhone && <p className="text-slate-600">{order.contactPhone}</p>}
            </div>
            <div className="mt-3 border-t border-slate-100 pt-3">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Ship to
              </p>
              <p className="text-slate-700">{order.shipName}</p>
              <p className="text-slate-600">{order.shipLine1}</p>
              {order.shipLine2 && <p className="text-slate-600">{order.shipLine2}</p>}
              <p className="text-slate-600">
                {order.shipCity}, {order.shipState} {order.shipZip}
              </p>
            </div>
          </section>

          {/* payments */}
          <section className="card p-5 text-sm">
            <h2 className="mb-2 font-semibold text-slate-900">Payments</h2>
            {order.payments.length === 0 ? (
              <p className="text-slate-500">No payment attempts.</p>
            ) : (
              <ul className="space-y-3">
                {order.payments.map((p) => (
                  <li key={p.id} className="rounded-lg bg-slate-50 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-slate-900">{p.provider}</span>
                      <span className="flex items-center gap-2">
                        <span className={`badge ${statusBadgeClass(p.status)}`}>
                          {statusLabel(p.status)}
                        </span>
                        <span className="font-medium text-slate-900">
                          {formatCents(p.amountCents)}
                        </span>
                      </span>
                    </div>
                    <p className="mt-1 break-all text-xs text-slate-500">{p.providerIntentId}</p>
                    <p className="text-xs text-slate-400">{formatDateTime(p.createdAt)}</p>
                    {p.lastError && (
                      <p className="mt-1 text-xs text-red-700">Error: {p.lastError}</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* refunds so far */}
          {order.refunds.length > 0 && (
            <section className="card p-5 text-sm">
              <h2 className="mb-2 font-semibold text-slate-900">Refunds</h2>
              <ul className="space-y-2">
                {order.refunds.map((r) => (
                  <li key={r.id} className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-slate-700">{r.reason}</p>
                      <p className="text-xs text-slate-400">
                        {formatDateTime(r.createdAt)} · {r.createdBy?.name ?? "System"}
                        {r.status !== RefundStatus.SUCCEEDED ? ` · ${statusLabel(r.status)}` : ""}
                      </p>
                    </div>
                    <span
                      className={`font-medium ${r.status === RefundStatus.FAILED ? "text-red-700 line-through" : "text-purple-700"}`}
                    >
                      -{formatCents(r.amountCents)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* refund composer */}
          {showComposer && (
            <section className="card p-5">
              <h2 className="mb-1 font-semibold text-slate-900">Refund composer</h2>
              <p className="mb-3 text-xs text-slate-500">
                Whole-line refunds only. Remaining refundable: {formatCents(remainingCents)}.
              </p>
              <RefundComposer
                orderId={order.id}
                remainingCents={remainingCents}
                items={composerItems}
              />
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
