import Link from "next/link";
import type { Metadata } from "next";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { AppointmentStatus, OrderItemStatus, Role, ShipTo, statusLabel } from "@/lib/enums";
import { formatShopTime, pluralize } from "@/lib/format";
import { requirePageUser } from "@/lib/page-auth";
import {
  laborLabel,
  readinessSummary,
  statusBadgeClass,
} from "@/components/orders/order-utils";
import { CancelInstallButton } from "@/components/orders/CancelInstallButton";
import { RescheduleDialog } from "@/components/orders/RescheduleDialog";

export const metadata: Metadata = { title: "My appointments" };
export const dynamic = "force-dynamic";

type ApptWithRelations = Prisma.AppointmentGetPayload<{
  include: {
    installer: true;
    order: { select: { id: true; orderNumber: true } };
    items: { include: { purchaseOrder: { select: { status: true } } } };
  };
}>;

function AppointmentCard({ appt, now }: { appt: ApptWithRelations; now: number }) {
  const readiness = readinessSummary(
    appt.status,
    appt.items.map((i) => ({
      itemStatus: i.itemStatus,
      shipTo: i.shipTo,
      poStatus: i.purchaseOrder?.status ?? null,
    })),
  );
  const liveInstallItems = appt.items.filter(
    (i) => i.itemStatus === OrderItemStatus.PENDING && i.withInstall && !i.installRefunded,
  );
  const refundCents = liveInstallItems.reduce((sum, i) => sum + i.installTotalCents, 0);
  const canModify =
    appt.status === AppointmentStatus.PENDING_PARTS || appt.status === AppointmentStatus.READY;
  const moreThan24hOut = appt.startAt.getTime() - now >= 24 * 60 * 60_000;

  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <p className="font-semibold text-slate-900">{appt.installer.name}</p>
            <span className={`badge ${statusBadgeClass(appt.status)}`}>
              {statusLabel(appt.status)}
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-600">
            {appt.installer.line1}, {appt.installer.city}, {appt.installer.state} {appt.installer.zip}
            {appt.installer.phone ? ` · ${appt.installer.phone}` : ""}
          </p>
          <p className="mt-2 text-sm font-medium text-slate-900">
            {formatShopTime(appt.startAt, appt.installer.tzOffsetMinutes)}
          </p>
          <p className="text-sm text-slate-600">
            {readiness} · {laborLabel(appt.totalLaborHoursTenths)} labor
          </p>
          {appt.vehicleDesc && <p className="text-sm text-slate-600">Vehicle: {appt.vehicleDesc}</p>}
          <ul className="mt-3 space-y-1 border-t border-slate-100 pt-3 text-sm text-slate-700">
            {appt.items.map((i) => (
              <li key={i.id}>
                {i.nameSnapshot} <span className="text-slate-400">× {i.qty}</span>
                {i.shipTo === ShipTo.HOME && (
                  <span className="ml-2 text-xs text-amber-700">
                    ships to you — bring it along
                  </span>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm">
            <Link
              href={`/account/orders/${appt.order.id}`}
              className="font-medium text-brand-700 hover:underline"
            >
              View order {appt.order.orderNumber} →
            </Link>
          </p>
        </div>
        {canModify && (
          <div className="flex flex-col items-end gap-2">
            <RescheduleDialog
              appointmentId={appt.id}
              installerId={appt.installerId}
              laborTenths={appt.totalLaborHoursTenths}
              shopName={appt.installer.name}
            />
            {liveInstallItems.length > 0 &&
              (moreThan24hOut ? (
                <CancelInstallButton appointmentId={appt.id} refundCents={refundCents} />
              ) : (
                <p className="max-w-[220px] text-right text-xs text-slate-500">
                  Installs can be cancelled up to 24 hours before the appointment.
                </p>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default async function AppointmentsPage() {
  const user = await requirePageUser([Role.CUSTOMER, Role.ADMIN], "/account/appointments");

  const appts = await db.appointment.findMany({
    where: { order: { userId: user.id } },
    orderBy: { startAt: "asc" },
    include: {
      installer: true,
      order: { select: { id: true, orderNumber: true } },
      items: { include: { purchaseOrder: { select: { status: true } } } },
    },
  });

  const now = Date.now();
  const upcoming = appts.filter((a) => a.startAt.getTime() >= now);
  const past = appts.filter((a) => a.startAt.getTime() < now).reverse();

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">My appointments</h1>
        <Link href="/account" className="text-sm font-medium text-brand-700 hover:underline">
          ← Account
        </Link>
      </div>

      {appts.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="text-lg font-medium text-slate-900">No appointments</p>
          <p className="mt-1 text-sm text-slate-500">
            Add professional installation to a part when you shop and your appointment will show up
            here.
          </p>
          <Link href="/parts" className="btn-primary mt-5">
            Shop parts
          </Link>
        </div>
      ) : (
        <div className="space-y-8">
          <section>
            <h2 className="mb-3 text-lg font-semibold text-slate-900">
              Upcoming ({upcoming.length})
            </h2>
            {upcoming.length === 0 ? (
              <p className="text-sm text-slate-500">No upcoming appointments.</p>
            ) : (
              <div className="space-y-4">
                {upcoming.map((a) => (
                  <AppointmentCard key={a.id} appt={a} now={now} />
                ))}
              </div>
            )}
          </section>

          {past.length > 0 && (
            <section>
              <h2 className="mb-3 text-lg font-semibold text-slate-900">
                Past ({past.length} {pluralize(past.length, "appointment")})
              </h2>
              <div className="space-y-4">
                {past.map((a) => (
                  <AppointmentCard key={a.id} appt={a} now={now} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
