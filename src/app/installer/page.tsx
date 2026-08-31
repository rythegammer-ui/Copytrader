import Link from "next/link";
import type { Metadata } from "next";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { POStatus, Role, ShipTo, statusLabel } from "@/lib/enums";
import { formatShopTime, pluralize } from "@/lib/format";
import { requirePageUser } from "@/lib/page-auth";
import { laborLabel, statusBadgeClass } from "@/components/orders/order-utils";
import { partsInHandSummary } from "@/components/portal/installer-utils";
import { InstallerReceiveButton } from "@/components/portal/installer-receive-button";

export const metadata: Metadata = { title: "Installer portal" };
export const dynamic = "force-dynamic";

type ApptRow = Prisma.AppointmentGetPayload<{
  include: {
    order: { select: { orderNumber: true } };
    items: { include: { purchaseOrder: { select: { status: true } } } };
  };
}>;

function ApptLine({ appt, tzOffsetMinutes }: { appt: ApptRow; tzOffsetMinutes: number }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/installer/appointments/${appt.id}`}
            className="font-medium text-brand-700 hover:underline"
          >
            {formatShopTime(appt.startAt, tzOffsetMinutes)}
          </Link>
          <span className={`badge ${statusBadgeClass(appt.status)}`}>
            {statusLabel(appt.status)}
          </span>
        </div>
        <p className="mt-0.5 text-sm text-slate-600">
          {appt.customerName}
          {appt.vehicleDesc ? ` · ${appt.vehicleDesc}` : ""} · {laborLabel(appt.totalLaborHoursTenths)}
        </p>
        <p className="text-xs text-slate-500">
          Order {appt.order.orderNumber} ·{" "}
          {partsInHandSummary(
            appt.items.map((i) => ({
              itemStatus: i.itemStatus,
              shipTo: i.shipTo,
              poStatus: i.purchaseOrder?.status ?? null,
            })),
          )}
        </p>
      </div>
    </li>
  );
}

export default async function InstallerDashboardPage() {
  const user = await requirePageUser([Role.INSTALLER], "/installer");
  if (!user.installerId) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-10">
        <div className="card p-8 text-center">
          <p className="font-medium text-slate-900">No shop linked to this account</p>
          <p className="mt-1 text-sm text-slate-500">Contact PartsPro support to fix this.</p>
        </div>
      </div>
    );
  }

  const shop = await db.installer.findUnique({ where: { id: user.installerId } });
  if (!shop) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-10">
        <div className="card p-8 text-center text-sm text-slate-600">Shop not found.</div>
      </div>
    );
  }

  // Shop-local "today" window (fixed UTC offset; DST out of scope).
  const now = new Date();
  const localNow = new Date(now.getTime() + shop.tzOffsetMinutes * 60_000);
  const todayStartUtc = new Date(
    Date.UTC(localNow.getUTCFullYear(), localNow.getUTCMonth(), localNow.getUTCDate()) -
      shop.tzOffsetMinutes * 60_000,
  );
  const tomorrowStartUtc = new Date(todayStartUtc.getTime() + 24 * 60 * 60_000);
  const weekEndUtc = new Date(todayStartUtc.getTime() + 7 * 24 * 60 * 60_000);

  const apptInclude = {
    order: { select: { orderNumber: true } },
    items: { include: { purchaseOrder: { select: { status: true } } } },
  } as const;

  const [todayAppts, weekAppts, inboundPos] = await Promise.all([
    db.appointment.findMany({
      where: {
        installerId: shop.id,
        startAt: { gte: todayStartUtc, lt: tomorrowStartUtc },
      },
      orderBy: { startAt: "asc" },
      include: apptInclude,
    }),
    db.appointment.findMany({
      where: {
        installerId: shop.id,
        startAt: { gte: tomorrowStartUtc, lt: weekEndUtc },
      },
      orderBy: { startAt: "asc" },
      include: apptInclude,
    }),
    db.purchaseOrder.findMany({
      where: {
        installerId: shop.id,
        shipTo: ShipTo.INSTALLER,
        status: { in: [POStatus.SHIPPED, POStatus.DELIVERED] },
      },
      orderBy: { shippedAt: "asc" },
      include: {
        supplier: { select: { name: true } },
        order: { select: { orderNumber: true } },
      },
    }),
  ]);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Installer portal</h1>
          <p className="text-sm text-slate-600">{shop.name}</p>
        </div>
        <Link href="/installer/appointments" className="btn-secondary">
          All appointments →
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <section className="card p-5">
            <h2 className="mb-2 text-lg font-semibold text-slate-900">
              Today ({todayAppts.length} {pluralize(todayAppts.length, "job")})
            </h2>
            {todayAppts.length === 0 ? (
              <p className="text-sm text-slate-500">Nothing on the schedule today.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {todayAppts.map((a) => (
                  <ApptLine key={a.id} appt={a} tzOffsetMinutes={shop.tzOffsetMinutes} />
                ))}
              </ul>
            )}
          </section>

          <section className="card p-5">
            <h2 className="mb-2 text-lg font-semibold text-slate-900">
              Rest of this week ({weekAppts.length})
            </h2>
            {weekAppts.length === 0 ? (
              <p className="text-sm text-slate-500">No more appointments this week.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {weekAppts.map((a) => (
                  <ApptLine key={a.id} appt={a} tzOffsetMinutes={shop.tzOffsetMinutes} />
                ))}
              </ul>
            )}
          </section>
        </div>

        <section className="card p-5">
          <h2 className="mb-2 text-lg font-semibold text-slate-900">
            Parts arriving ({inboundPos.length})
          </h2>
          <p className="mb-3 text-xs text-slate-500">
            Mark shipments received to unlock their appointments.
          </p>
          {inboundPos.length === 0 ? (
            <p className="text-sm text-slate-500">No inbound shipments right now.</p>
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
                    <p className="text-sm text-slate-600">
                      {po.supplier.name} · Order {po.order.orderNumber}
                    </p>
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
                  <InstallerReceiveButton poId={po.id} small />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
