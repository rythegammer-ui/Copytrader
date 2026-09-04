import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import {
  AppointmentStatus,
  OrderItemStatus,
  OrderStatus,
  PayProvider,
  POStatus,
  RefundStatus,
  Role,
  ShipTo,
  poTerminalDelivered,
  statusLabel,
} from "@/lib/enums";
import { formatCents } from "@/lib/money";
import { formatDate, formatDateTime, formatShopTime, pluralize } from "@/lib/format";
import { requirePageUser } from "@/lib/page-auth";
import { expireStaleUnpaidOrder } from "@/lib/fulfillment";
import { carrierTrackingUrl } from "@/lib/transitions";
import {
  computeOrderStateKey,
  itemDisplayStatus,
  laborLabel,
  readinessSummary,
  statusBadgeClass,
} from "@/components/orders/order-utils";
import { CancelOrderButton } from "@/components/orders/CancelOrderButton";
import { CancelInstallButton } from "@/components/orders/CancelInstallButton";
import { RescheduleDialog } from "@/components/orders/RescheduleDialog";
import { OrderLiveRefresh, type TimelineEntry } from "@/components/orders/OrderLiveRefresh";
import { ProgressBar, type ProgressStep } from "@/components/orders/ProgressBar";

export const metadata: Metadata = { title: "Order details" };
export const dynamic = "force-dynamic";

function loadOrder(id: string) {
  return db.order.findUnique({
    where: { id },
    include: {
      items: true,
      purchaseOrders: { orderBy: { createdAt: "asc" } },
      appointments: { include: { installer: true }, orderBy: { startAt: "asc" } },
      payments: { orderBy: [{ createdAt: "desc" }, { id: "desc" }] },
      refunds: { orderBy: [{ createdAt: "desc" }, { id: "desc" }] },
    },
  });
}

export default async function OrderDetailPage({ params }: { params: { id: string } }) {
  const user = await requirePageUser([Role.CUSTOMER, Role.ADMIN], `/account/orders/${params.id}`);

  let order = await loadOrder(params.id);
  if (!order) notFound();
  if (user.role !== Role.ADMIN && order.userId !== user.id) notFound();

  if (await expireStaleUnpaidOrder(order)) {
    order = await loadOrder(params.id);
    if (!order) notFound();
  }

  const events = await db.eventLog.findMany({
    where: { orderId: order.id, ...(user.role === Role.ADMIN ? {} : { internal: false }) },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 100,
  });

  // Shop names for install sub-lines (covers unpaid orders with no appointments yet).
  const snapshotShopIds = Array.from(
    new Set(order.items.map((i) => i.installerIdSnapshot).filter((x): x is string => x !== null)),
  );
  const snapshotShops = snapshotShopIds.length
    ? await db.installer.findMany({
        where: { id: { in: snapshotShopIds } },
        select: { id: true, name: true },
      })
    : [];
  const shopNameById = new Map(snapshotShops.map((s) => [s.id, s.name]));
  for (const a of order.appointments) shopNameById.set(a.installerId, a.installer.name);

  const poById = new Map(order.purchaseOrders.map((po) => [po.id, po]));
  const now = Date.now();

  // ---- header flags -------------------------------------------------------
  const awaitingPayment =
    order.status === OrderStatus.PENDING_PAYMENT || order.status === OrderStatus.PAYMENT_FAILED;
  const allPosUnconfirmed =
    order.purchaseOrders.length > 0 &&
    order.purchaseOrders.every((po) => po.status === POStatus.PENDING_CONFIRMATION);
  const canCancelPaid =
    (order.status === OrderStatus.PAID || order.status === OrderStatus.PROCESSING) &&
    allPosUnconfirmed;

  // ---- progress bar -------------------------------------------------------
  const paid = order.paidAt !== null;
  const activePos = order.purchaseOrders.filter(
    (po) => po.status !== POStatus.CANCELLED && po.status !== POStatus.REJECTED,
  );
  const shippedStatuses: string[] = [POStatus.SHIPPED, POStatus.DELIVERED, POStatus.RECEIVED];
  const orderDoneStatuses: string[] = [OrderStatus.FULFILLED, OrderStatus.COMPLETED];
  const anyShipped =
    activePos.some((po) => shippedStatuses.includes(po.status)) ||
    orderDoneStatuses.includes(order.status);
  const allDelivered =
    (activePos.length > 0 && activePos.every((po) => poTerminalDelivered(po.status, po.shipTo))) ||
    orderDoneStatuses.includes(order.status);
  const activeAppts = order.appointments.filter((a) => a.status !== AppointmentStatus.CANCELLED);
  const hasInstallStep =
    activeAppts.length > 0 ||
    (order.appointments.length === 0 &&
      order.items.some((i) => i.withInstall && i.itemStatus === OrderItemStatus.PENDING));
  const allInstalled =
    activeAppts.length > 0 && activeAppts.every((a) => a.status === AppointmentStatus.COMPLETED);
  const steps: ProgressStep[] = [
    { label: "Placed", done: true },
    { label: "Paid", done: paid },
    { label: "Shipped", done: anyShipped },
    { label: "Delivered", done: allDelivered },
    ...(hasInstallStep ? [{ label: "Installed", done: allInstalled }] : []),
    { label: "Complete", done: order.status === OrderStatus.COMPLETED },
  ];
  const showProgress =
    order.status !== OrderStatus.CANCELLED && order.status !== OrderStatus.REFUNDED;

  // ---- live-refresh fingerprint ------------------------------------------
  const timeline: TimelineEntry[] = events.map((e) => ({
    id: e.id,
    message: e.message,
    createdAt: e.createdAt.toISOString(),
    actorRole: e.actorRole,
    action: e.action,
    toStatus: e.toStatus,
  }));
  const stateKey = computeOrderStateKey({
    status: order.status,
    refundedTotalCents: order.refundedTotalCents,
    purchaseOrders: order.purchaseOrders.map((p) => ({ id: p.id, status: p.status })),
    appointments: order.appointments.map((a) => ({
      id: a.id,
      status: a.status,
      startAt: a.startAt.toISOString(),
    })),
    payments: order.payments.map((p) => ({ status: p.status })),
    timelineCount: timeline.length,
  });

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      {/* ---- header ---- */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-slate-500">
            <Link href="/account/orders" className="font-medium text-brand-700 hover:underline">
              My orders
            </Link>{" "}
            / {order.orderNumber}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold text-slate-900">{order.orderNumber}</h1>
            <span className={`badge ${statusBadgeClass(order.status)}`}>
              {statusLabel(order.status)}
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-600">Placed {formatDate(order.placedAt)}</p>
          {order.vehicleDesc && (
            <p className="text-sm text-slate-600">For your {order.vehicleDesc}</p>
          )}
          {order.status === OrderStatus.CANCELLED && order.cancelReason && (
            <p className="mt-1 text-sm text-red-700">Cancelled — {order.cancelReason}</p>
          )}
        </div>
        <div className="flex flex-col items-end gap-2">
          {awaitingPayment && (
            <Link href={`/checkout/pay/${order.id}`} className="btn-primary">
              Pay now
            </Link>
          )}
          {(awaitingPayment || canCancelPaid) && (
            <CancelOrderButton
              orderId={order.id}
              confirmText={
                awaitingPayment
                  ? "Cancel this unpaid order?"
                  : "Cancel this order? You'll receive a full refund."
              }
            />
          )}
          {canCancelPaid && (
            <p className="max-w-[220px] text-right text-xs text-slate-500">
              Free cancellation until a supplier confirms.
            </p>
          )}
        </div>
      </div>

      {/* ---- progress ---- */}
      {showProgress && (
        <div className="card mb-6 px-4 py-5 sm:px-6">
          <ProgressBar steps={steps} />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* ---- shipments ---- */}
          {order.purchaseOrders.length > 0 && (
            <section>
              <h2 className="mb-3 text-lg font-semibold text-slate-900">Shipments</h2>
              <div className="space-y-4">
                {order.purchaseOrders.map((po) => {
                  const poItems = order.items.filter((i) => i.purchaseOrderId === po.id);
                  const trackingUrl =
                    po.trackingUrl ??
                    (po.carrier && po.trackingNumber
                      ? carrierTrackingUrl(po.carrier, po.trackingNumber)
                      : null);
                  const poDates = [
                    { label: "Confirmed", at: po.confirmedAt },
                    { label: "Shipped", at: po.shippedAt },
                    { label: "Delivered", at: po.deliveredAt },
                    { label: "Received at shop", at: po.receivedAt },
                  ].filter((d): d is { label: string; at: Date } => d.at !== null);
                  return (
                    <div key={po.id} className="card p-5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-3">
                          <p className="font-semibold text-slate-900">{po.poNumber}</p>
                          <span className={`badge ${statusBadgeClass(po.status)}`}>
                            {statusLabel(po.status)}
                          </span>
                        </div>
                        <p className="text-sm text-slate-600">
                          Ships to{" "}
                          <span className="font-medium text-slate-900">
                            {po.shipTo === ShipTo.INSTALLER ? po.destName : "Your address"}
                          </span>
                        </p>
                      </div>
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
                              {po.trackingNumber ?? "Track package"} →
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
                        {poItems.length === 0 && (
                          <li className="text-slate-400">No items on this shipment.</li>
                        )}
                      </ul>
                      {poDates.length > 0 && (
                        <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-slate-100 pt-3 text-xs text-slate-500">
                          {poDates.map((d) => (
                            <span key={d.label}>
                              <span className="font-medium text-slate-700">{d.label}</span>{" "}
                              {formatDateTime(d.at)}
                            </span>
                          ))}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* ---- appointments ---- */}
          {order.appointments.length > 0 && (
            <section>
              <h2 className="mb-3 text-lg font-semibold text-slate-900">Installation</h2>
              <div className="space-y-4">
                {order.appointments.map((a) => {
                  const apptItems = order.items.filter((i) => i.appointmentId === a.id);
                  const readiness = readinessSummary(
                    a.status,
                    apptItems.map((i) => ({
                      itemStatus: i.itemStatus,
                      shipTo: i.shipTo,
                      poStatus: i.purchaseOrderId
                        ? poById.get(i.purchaseOrderId)?.status ?? null
                        : null,
                    })),
                  );
                  const liveInstallItems = apptItems.filter(
                    (i) =>
                      i.itemStatus === OrderItemStatus.PENDING && i.withInstall && !i.installRefunded,
                  );
                  const refundCents = liveInstallItems.reduce(
                    (sum, i) => sum + i.installTotalCents,
                    0,
                  );
                  const canModify =
                    a.status === AppointmentStatus.PENDING_PARTS ||
                    a.status === AppointmentStatus.READY;
                  const moreThan24hOut = a.startAt.getTime() - now >= 24 * 60 * 60_000;
                  return (
                    <div key={a.id} className="card p-5">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="flex flex-wrap items-center gap-3">
                            <p className="font-semibold text-slate-900">{a.installer.name}</p>
                            <span className={`badge ${statusBadgeClass(a.status)}`}>
                              {statusLabel(a.status)}
                            </span>
                          </div>
                          <p className="mt-1 text-sm text-slate-600">
                            {a.installer.line1}, {a.installer.city}
                            {a.installer.phone ? ` · ${a.installer.phone}` : ""}
                          </p>
                          <p className="mt-2 text-sm font-medium text-slate-900">
                            {formatShopTime(a.startAt, a.installer.tzOffsetMinutes)}
                          </p>
                          <p className="text-sm text-slate-600">
                            {readiness} · {laborLabel(a.totalLaborHoursTenths)} labor
                          </p>
                        </div>
                        {canModify && (
                          <div className="flex flex-col items-end gap-2">
                            <RescheduleDialog
                              appointmentId={a.id}
                              installerId={a.installerId}
                              laborTenths={a.totalLaborHoursTenths}
                              shopName={a.installer.name}
                            />
                            {liveInstallItems.length > 0 &&
                              (moreThan24hOut ? (
                                <CancelInstallButton appointmentId={a.id} refundCents={refundCents} />
                              ) : (
                                <p className="max-w-[220px] text-right text-xs text-slate-500">
                                  Installs can be cancelled up to 24 hours before the appointment.
                                </p>
                              ))}
                          </div>
                        )}
                      </div>
                      {apptItems.some((i) => i.shipTo === ShipTo.HOME && i.withInstall) && (
                        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                          Some parts for this install ship to your address — please bring them to
                          your appointment.
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* ---- receipt ---- */}
          <section>
            <h2 className="mb-3 text-lg font-semibold text-slate-900">Receipt</h2>
            <div className="card relative overflow-hidden">
              {order.status === OrderStatus.REFUNDED && (
                <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
                  <span className="-rotate-12 rounded-lg border-4 border-purple-300/70 px-8 py-3 text-4xl font-black uppercase tracking-widest text-purple-300/70">
                    Refunded
                  </span>
                </div>
              )}
              <ul className="divide-y divide-slate-100">
                {order.items.map((i) => {
                  const po = i.purchaseOrderId ? poById.get(i.purchaseOrderId) : undefined;
                  const display = itemDisplayStatus(i.itemStatus, po?.status ?? null);
                  const shopName = i.installerIdSnapshot
                    ? shopNameById.get(i.installerIdSnapshot) ?? "your installer"
                    : "your installer";
                  return (
                    <li key={i.id} className="flex gap-4 p-5">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={i.imageUrlSnapshot || "/images/placeholders/part.svg"}
                        alt={i.nameSnapshot}
                        className="h-14 w-14 flex-shrink-0 rounded-lg border border-slate-200 bg-slate-50 object-cover"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <p className="font-medium text-slate-900">{i.nameSnapshot}</p>
                            <p className="text-xs text-slate-500">
                              {i.qty} × {formatCents(i.unitPriceCents)}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="font-semibold text-slate-900">
                              {formatCents(i.lineTotalCents)}
                            </p>
                            <span className={`badge mt-1 ${statusBadgeClass(display)}`}>
                              {statusLabel(display)}
                            </span>
                          </div>
                        </div>
                        {i.withInstall && (
                          <p className="mt-1 text-sm text-slate-600">
                            + Installation at {shopName} — {formatCents(i.installTotalCents)}
                            {i.installRefunded && (
                              <span className="ml-1 text-purple-700">(refunded)</span>
                            )}
                          </p>
                        )}
                        {i.withInstall && i.shipTo === ShipTo.HOME && (
                          <p className="mt-1 text-xs text-amber-700">
                            Ships to your address — bring this part to your appointment.
                          </p>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
              <dl className="space-y-1.5 border-t border-slate-200 px-5 py-4 text-sm">
                <div className="flex justify-between text-slate-600">
                  <dt>Parts subtotal</dt>
                  <dd>{formatCents(order.partsSubtotalCents)}</dd>
                </div>
                {order.installSubtotalCents > 0 && (
                  <div className="flex justify-between text-slate-600">
                    <dt>Installation</dt>
                    <dd>{formatCents(order.installSubtotalCents)}</dd>
                  </div>
                )}
                <div className="flex justify-between text-slate-600">
                  <dt>Shipping</dt>
                  <dd>
                    {order.shippingTotalCents === 0 ? "Free" : formatCents(order.shippingTotalCents)}
                  </dd>
                </div>
                <div className="flex justify-between text-slate-600">
                  <dt>Tax</dt>
                  <dd>{formatCents(order.taxCents)}</dd>
                </div>
                <div className="flex justify-between border-t border-slate-200 pt-2 text-base font-semibold text-slate-900">
                  <dt>Total</dt>
                  <dd>{formatCents(order.totalCents)}</dd>
                </div>
                {order.refunds.length > 0 && (
                  <>
                    {order.refunds.map((r) => (
                      <div key={r.id} className="flex justify-between text-purple-700">
                        <dt className="pr-4">
                          Refund — {r.reason} — {formatDate(r.createdAt)}
                          {r.status !== RefundStatus.SUCCEEDED ? ` (${statusLabel(r.status)})` : ""}
                        </dt>
                        <dd>-{formatCents(r.amountCents)}</dd>
                      </div>
                    ))}
                    <div className="flex justify-between border-t border-slate-200 pt-2 font-semibold text-slate-900">
                      <dt>Net paid</dt>
                      <dd>{formatCents(order.totalCents - order.refundedTotalCents)}</dd>
                    </div>
                  </>
                )}
              </dl>
            </div>
          </section>
        </div>

        {/* ---- sidebar ---- */}
        <div className="space-y-6">
          <section className="card p-5 text-sm">
            <h2 className="mb-2 font-semibold text-slate-900">Shipping address</h2>
            <p className="text-slate-700">{order.shipName}</p>
            <p className="text-slate-600">{order.shipLine1}</p>
            {order.shipLine2 && <p className="text-slate-600">{order.shipLine2}</p>}
            <p className="text-slate-600">
              {order.shipCity}, {order.shipState} {order.shipZip}
            </p>
            <p className="mt-2 text-slate-600">{order.contactEmail}</p>
            {order.contactPhone && <p className="text-slate-600">{order.contactPhone}</p>}
          </section>

          <section className="card p-5 text-sm">
            <h2 className="mb-2 font-semibold text-slate-900">
              {pluralize(order.payments.length, "Payment")}
            </h2>
            {order.payments.length === 0 ? (
              <p className="text-slate-500">No payment attempts yet.</p>
            ) : (
              <ul className="space-y-2">
                {order.payments.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-2">
                    <span className="text-slate-600">
                      {p.provider === PayProvider.STRIPE ? "Card (Stripe)" : "Demo payment"} ·{" "}
                      {formatDate(p.createdAt)}
                    </span>
                    <span className="flex items-center gap-2">
                      <span className={`badge ${statusBadgeClass(p.status)}`}>
                        {statusLabel(p.status)}
                      </span>
                      <span className="font-medium text-slate-900">
                        {formatCents(p.amountCents)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card p-5">
            <h2 className="mb-3 font-semibold text-slate-900">Activity</h2>
            <OrderLiveRefresh orderId={order.id} initialKey={stateKey} initialTimeline={timeline} />
          </section>
        </div>
      </div>
    </div>
  );
}
