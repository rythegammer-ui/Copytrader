import Link from "next/link";
import type { Metadata } from "next";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { Role, statusLabel } from "@/lib/enums";
import { formatShopTime, pluralize } from "@/lib/format";
import { requirePageUser } from "@/lib/page-auth";
import { laborLabel, statusBadgeClass } from "@/components/orders/order-utils";
import { partsInHandSummary } from "@/components/portal/installer-utils";

export const metadata: Metadata = { title: "Shop appointments" };
export const dynamic = "force-dynamic";

type ApptRow = Prisma.AppointmentGetPayload<{
  include: {
    order: { select: { orderNumber: true } };
    items: { include: { purchaseOrder: { select: { status: true } } } };
  };
}>;

function ApptCard({ appt, tzOffsetMinutes }: { appt: ApptRow; tzOffsetMinutes: number }) {
  const time = formatShopTime(appt.startAt, tzOffsetMinutes).split(" · ")[1] ?? "";
  return (
    <Link
      href={`/installer/appointments/${appt.id}`}
      className="card block p-4 transition hover:border-brand-500"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-semibold text-slate-900">{time}</p>
          <span className={`badge ${statusBadgeClass(appt.status)}`}>
            {statusLabel(appt.status)}
          </span>
        </div>
        <span className="text-xs text-slate-500">{laborLabel(appt.totalLaborHoursTenths)}</span>
      </div>
      <p className="mt-1 text-sm text-slate-700">
        {appt.customerName}
        {appt.vehicleDesc ? ` · ${appt.vehicleDesc}` : ""}
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
    </Link>
  );
}

export default async function InstallerAppointmentsPage() {
  const user = await requirePageUser([Role.INSTALLER], "/installer/appointments");
  if (!user.installerId) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-10">
        <div className="card p-8 text-center text-sm text-slate-600">
          No shop linked to this account.
        </div>
      </div>
    );
  }

  const [shop, appts] = await Promise.all([
    db.installer.findUnique({ where: { id: user.installerId } }),
    db.appointment.findMany({
      where: { installerId: user.installerId },
      orderBy: { startAt: "asc" },
      include: {
        order: { select: { orderNumber: true } },
        items: { include: { purchaseOrder: { select: { status: true } } } },
      },
    }),
  ]);
  const tz = shop?.tzOffsetMinutes ?? 0;

  const nowMs = Date.now();
  const upcoming = appts.filter((a) => a.startAt.getTime() >= nowMs);
  const past = appts.filter((a) => a.startAt.getTime() < nowMs).reverse();

  // Group upcoming by shop-local day label ("Tue, Sep 2").
  const days: { day: string; appts: ApptRow[] }[] = [];
  for (const appt of upcoming) {
    const day = formatShopTime(appt.startAt, tz).split(" · ")[0];
    const bucket = days.find((d) => d.day === day);
    if (bucket) bucket.appts.push(appt);
    else days.push({ day, appts: [appt] });
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">Appointments</h1>
        <Link href="/installer" className="text-sm font-medium text-brand-700 hover:underline">
          ← Dashboard
        </Link>
      </div>

      {appts.length === 0 ? (
        <div className="card p-10 text-center text-sm text-slate-500">
          No appointments booked at your shop yet.
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
              <div className="space-y-6">
                {days.map((d) => (
                  <div key={d.day}>
                    <p className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
                      {d.day}
                    </p>
                    <div className="space-y-3">
                      {d.appts.map((a) => (
                        <ApptCard key={a.id} appt={a} tzOffsetMinutes={tz} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {past.length > 0 && (
            <section>
              <h2 className="mb-3 text-lg font-semibold text-slate-900">
                Past ({past.length} {pluralize(past.length, "appointment")})
              </h2>
              <div className="space-y-3">
                {past.map((a) => (
                  <div key={a.id}>
                    <p className="mb-1 text-xs font-medium text-slate-400">
                      {formatShopTime(a.startAt, tz)}
                    </p>
                    <ApptCard appt={a} tzOffsetMinutes={tz} />
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
