import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { AppointmentStatus, POStatus, Role, ShipTo, statusLabel } from "@/lib/enums";
import { formatShopTime } from "@/lib/format";
import { requirePageUser } from "@/lib/page-auth";
import { laborLabel, statusBadgeClass } from "@/components/orders/order-utils";
import {
  arrivalBadgeClass,
  itemArrivalState,
  partsInHandSummary,
} from "@/components/portal/installer-utils";
import { InstallerAppointmentActions } from "@/components/portal/installer-appointment-actions";
import { InstallerReceiveButton } from "@/components/portal/installer-receive-button";
import { RescheduleDialog } from "@/components/orders/RescheduleDialog";

export const metadata: Metadata = { title: "Appointment" };
export const dynamic = "force-dynamic";

export default async function InstallerAppointmentDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const user = await requirePageUser([Role.INSTALLER], `/installer/appointments/${params.id}`);
  if (!user.installerId) notFound();

  const appt = await db.appointment.findFirst({
    where: { id: params.id, installerId: user.installerId },
    include: {
      installer: true,
      order: { select: { orderNumber: true } },
      items: {
        include: { purchaseOrder: { include: { supplier: { select: { name: true } } } } },
      },
    },
  });
  if (!appt) notFound();

  const now = Date.now();
  const windowPassed = appt.startAt.getTime() + appt.durationMinutes * 60_000 < now;
  const canModify =
    appt.status === AppointmentStatus.PENDING_PARTS || appt.status === AppointmentStatus.READY;
  const canComplete = appt.status === AppointmentStatus.READY;
  const canNoShow = appt.status === AppointmentStatus.READY && windowPassed;

  // Deduplicate the ship-to-shop POs feeding this appointment.
  type InboundPO = NonNullable<(typeof appt.items)[number]["purchaseOrder"]>;
  const inbound = new Map<string, InboundPO>();
  for (const item of appt.items) {
    const po = item.purchaseOrder;
    if (po && po.shipTo === ShipTo.INSTALLER && po.installerId === user.installerId) {
      inbound.set(po.id, po);
    }
  }
  const inboundPos = Array.from(inbound.values());

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold text-slate-900">
            {formatShopTime(appt.startAt, appt.installer.tzOffsetMinutes)}
          </h1>
          <span className={`badge ${statusBadgeClass(appt.status)}`}>
            {statusLabel(appt.status)}
          </span>
        </div>
        <Link
          href="/installer/appointments"
          className="text-sm font-medium text-brand-700 hover:underline"
        >
          ← All appointments
        </Link>
      </div>

      <div className="card mb-6 p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Customer</p>
            <p className="mt-1 font-medium text-slate-900">{appt.customerName}</p>
            <p className="text-sm text-slate-600">{appt.customerPhone ?? "No phone on file"}</p>
            <p className="mt-1 text-sm text-slate-600">Order {appt.order.orderNumber}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Job</p>
            <p className="mt-1 font-medium text-slate-900">
              {appt.vehicleDesc ?? "Vehicle not specified"}
            </p>
            <p className="text-sm text-slate-600">
              {laborLabel(appt.totalLaborHoursTenths)} labor · {appt.durationMinutes} min bay time
            </p>
            <p className="text-sm text-slate-600">
              {partsInHandSummary(
                appt.items.map((i) => ({
                  itemStatus: i.itemStatus,
                  shipTo: i.shipTo,
                  poStatus: i.purchaseOrder?.status ?? null,
                })),
              )}
            </p>
          </div>
        </div>
        {appt.notes && (
          <div className="mt-4 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Notes</p>
            <p className="mt-1 whitespace-pre-wrap">{appt.notes}</p>
          </div>
        )}
      </div>

      <div className="card mb-6 flex flex-wrap items-center gap-3 p-5">
        <InstallerAppointmentActions
          appointmentId={appt.id}
          canComplete={canComplete}
          canNoShow={canNoShow}
        />
        {canModify && (
          <RescheduleDialog
            appointmentId={appt.id}
            installerId={appt.installerId}
            laborTenths={appt.totalLaborHoursTenths}
            shopName={appt.installer.name}
          />
        )}
        {appt.status === AppointmentStatus.READY && !windowPassed && (
          <p className="text-xs text-slate-500">
            No-show can be marked once the appointment window has passed.
          </p>
        )}
      </div>

      <section className="card mb-6 p-5">
        <h2 className="mb-3 text-lg font-semibold text-slate-900">Parts for this job</h2>
        <ul className="divide-y divide-slate-100">
          {appt.items.map((i) => {
            const state = itemArrivalState(i.itemStatus, i.shipTo, i.purchaseOrder?.status);
            return (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-900">
                    {i.nameSnapshot} <span className="text-slate-400">× {i.qty}</span>
                  </p>
                  <p className="text-xs text-slate-500">
                    SKU {i.skuSnapshot}
                    {i.purchaseOrder ? ` · ${i.purchaseOrder.poNumber}` : ""}
                    {i.shipTo === ShipTo.HOME ? " · ships to customer" : " · ships to your shop"}
                  </p>
                </div>
                <span className={`badge ${arrivalBadgeClass(state)}`}>{state}</span>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="card p-5">
        <h2 className="mb-3 text-lg font-semibold text-slate-900">
          Inbound shipments ({inboundPos.length})
        </h2>
        {inboundPos.length === 0 ? (
          <p className="text-sm text-slate-500">
            No ship-to-shop purchase orders for this appointment.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {inboundPos.map((po) => (
              <li key={po.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-slate-900">{po.poNumber}</p>
                    <span className={`badge ${statusBadgeClass(po.status)}`}>
                      {statusLabel(po.status)}
                    </span>
                  </div>
                  <p className="text-sm text-slate-600">{po.supplier.name}</p>
                  {po.carrier && po.trackingNumber && (
                    <p className="text-xs text-slate-500">
                      {po.carrier} · {po.trackingNumber}
                      {po.trackingUrl && (
                        <>
                          {" · "}
                          <a
                            href={po.trackingUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-medium text-brand-700 hover:underline"
                          >
                            Track
                          </a>
                        </>
                      )}
                    </p>
                  )}
                </div>
                {(po.status === POStatus.SHIPPED || po.status === POStatus.DELIVERED) && (
                  <InstallerReceiveButton poId={po.id} small />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
