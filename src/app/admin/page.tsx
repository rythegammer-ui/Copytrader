import Link from "next/link";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { AppointmentStatus, Role, statusLabel } from "@/lib/enums";
import { formatCents } from "@/lib/money";
import { formatShopTime } from "@/lib/format";
import { requirePageUser } from "@/lib/page-auth";
import { computeAttention, computeKpis } from "@/components/admin/admin-data";
import { AttentionList } from "@/components/admin/AttentionList";
import { RevenueChart } from "@/components/admin/RevenueChart";
import { statusBadgeClass } from "@/components/orders/order-utils";

export const metadata: Metadata = { title: "Admin dashboard" };
export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60_000;

export default async function AdminDashboardPage() {
  await requirePageUser([Role.ADMIN], "/admin");

  const now = new Date();
  const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const todayEnd = new Date(todayStart.getTime() + DAY_MS);

  const [kpis, attention, todaysAppointments] = await Promise.all([
    computeKpis(30),
    computeAttention(),
    db.appointment.findMany({
      where: {
        startAt: { gte: todayStart, lt: todayEnd },
        status: { in: [AppointmentStatus.PENDING_PARTS, AppointmentStatus.READY] },
      },
      include: {
        installer: { select: { name: true, tzOffsetMinutes: true } },
        order: { select: { id: true, orderNumber: true } },
      },
      orderBy: { startAt: "asc" },
    }),
  ]);

  const redCount = attention.filter((e) => e.severity === "red").length;
  const stats: { label: string; value: string; sub?: string }[] = [
    { label: "Revenue (30d)", value: formatCents(kpis.revenueCents), sub: "net of refunds" },
    { label: "Orders (30d)", value: String(kpis.ordersCount) },
    { label: "Avg order value", value: formatCents(kpis.aovCents) },
    { label: "Margin (30d)", value: formatCents(kpis.marginCents), sub: "live items only" },
    {
      label: "Install attach rate",
      value: `${Math.round(kpis.installAttachRate * 100)}%`,
    },
    { label: "Refunded (30d)", value: formatCents(kpis.refundsCents) },
    { label: "Open POs", value: String(kpis.openPOs) },
    { label: "Appointments (7d)", value: String(kpis.upcomingAppointments) },
  ];

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
        <div className="flex flex-wrap gap-2">
          <Link href="/admin/orders" className="btn-secondary">
            Orders
          </Link>
          <Link href="/admin/attention" className="btn-secondary">
            Attention
            {attention.length > 0 && (
              <span
                className={`badge ${redCount > 0 ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800"}`}
              >
                {attention.length}
              </span>
            )}
          </Link>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="card p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{s.label}</p>
            <p className="mt-1 text-xl font-bold text-slate-900">{s.value}</p>
            {s.sub && <p className="text-xs text-slate-400">{s.sub}</p>}
          </div>
        ))}
      </div>

      {/* Revenue chart */}
      <div className="card mt-6 p-5">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">
          Revenue by day (last {kpis.days} days)
        </h2>
        <RevenueChart byDay={kpis.byDay} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {/* Attention preview */}
        <section className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-900">Needs attention</h2>
            <Link
              href="/admin/attention"
              className="text-sm font-medium text-brand-700 hover:underline"
            >
              View all ({attention.length}) →
            </Link>
          </div>
          <AttentionList entries={attention.slice(0, 5)} />
        </section>

        {/* Today's appointments */}
        <section className="card overflow-hidden">
          <div className="border-b border-slate-100 px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-900">Today&apos;s appointments</h2>
          </div>
          {todaysAppointments.length === 0 ? (
            <p className="p-4 text-sm text-slate-500">No appointments scheduled today.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {todaysAppointments.map((a) => (
                <li key={a.id}>
                  <Link
                    href={`/admin/orders/${a.order.id}`}
                    className="flex items-center justify-between gap-3 px-4 py-3 transition hover:bg-slate-50"
                  >
                    <div>
                      <p className="text-sm font-medium text-slate-900">
                        {formatShopTime(a.startAt, a.installer.tzOffsetMinutes)} ·{" "}
                        {a.installer.name}
                      </p>
                      <p className="text-xs text-slate-500">
                        {a.customerName} · order {a.order.orderNumber}
                      </p>
                    </div>
                    <span className={`badge ${statusBadgeClass(a.status)}`}>
                      {statusLabel(a.status)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
