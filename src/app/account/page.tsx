import Link from "next/link";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { AppointmentStatus, OrderStatus, Role, statusLabel } from "@/lib/enums";
import { formatCents } from "@/lib/money";
import { formatDate, formatShopTime, pluralize } from "@/lib/format";
import { requirePageUser } from "@/lib/page-auth";
import { AccountSignOutButton } from "@/components/account/account-signout-button";

export const metadata: Metadata = { title: "My account" };
export const dynamic = "force-dynamic";

function orderBadgeClass(status: string): string {
  switch (status) {
    case OrderStatus.PENDING_PAYMENT:
      return "bg-amber-100 text-amber-800";
    case OrderStatus.PAYMENT_FAILED:
      return "bg-red-100 text-red-800";
    case OrderStatus.PAID:
    case OrderStatus.PROCESSING:
      return "bg-blue-100 text-blue-800";
    case OrderStatus.PARTIALLY_FULFILLED:
      return "bg-indigo-100 text-indigo-800";
    case OrderStatus.FULFILLED:
    case OrderStatus.COMPLETED:
      return "bg-green-100 text-green-800";
    case OrderStatus.REFUNDED:
      return "bg-purple-100 text-purple-800";
    case OrderStatus.CANCELLED:
    default:
      return "bg-slate-100 text-slate-800";
  }
}

export default async function AccountPage() {
  const user = await requirePageUser([Role.CUSTOMER, Role.ADMIN], "/account");
  const now = new Date();

  const [orders, nextAppointment, vehicleCount, unreadCount] = await Promise.all([
    db.order.findMany({
      where: { userId: user.id },
      orderBy: { placedAt: "desc" },
      take: 3,
    }),
    db.appointment.findFirst({
      where: {
        order: { userId: user.id },
        startAt: { gte: now },
        status: { in: [AppointmentStatus.PENDING_PARTS, AppointmentStatus.READY] },
      },
      orderBy: { startAt: "asc" },
      include: { installer: true },
    }),
    db.customerVehicle.count({ where: { userId: user.id } }),
    db.notification.count({ where: { userId: user.id, readAt: null } }),
  ]);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Welcome back, {user.name.split(" ")[0]}</h1>
          <p className="text-sm text-slate-600">{user.email}</p>
        </div>
        <AccountSignOutButton />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="card lg:col-span-2">
          <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
            <h2 className="font-semibold text-slate-900">Recent orders</h2>
            <Link href="/account/orders" className="text-sm font-medium text-brand-700 hover:underline">
              View all →
            </Link>
          </div>
          {orders.length === 0 ? (
            <div className="p-6 text-sm text-slate-500">
              No orders yet.{" "}
              <Link href="/parts" className="font-medium text-brand-700 hover:underline">
                Shop parts
              </Link>{" "}
              to get started.
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {orders.map((o) => (
                <li key={o.id}>
                  <Link
                    href={`/account/orders/${o.id}`}
                    className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 hover:bg-slate-50"
                  >
                    <div>
                      <p className="font-medium text-slate-900">{o.orderNumber}</p>
                      <p className="text-sm text-slate-500">Placed {formatDate(o.placedAt)}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`badge ${orderBadgeClass(o.status)}`}>
                        {statusLabel(o.status)}
                      </span>
                      <span className="font-semibold text-slate-900">{formatCents(o.totalCents)}</span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="space-y-6">
          <section className="card p-6">
            <h2 className="mb-2 font-semibold text-slate-900">Next appointment</h2>
            {nextAppointment ? (
              <div className="text-sm">
                <p className="font-medium text-slate-900">{nextAppointment.installer.name}</p>
                <p className="text-slate-600">
                  {formatShopTime(nextAppointment.startAt, nextAppointment.installer.tzOffsetMinutes)}
                </p>
                <span
                  className={`badge mt-2 ${
                    nextAppointment.status === AppointmentStatus.READY
                      ? "bg-green-100 text-green-800"
                      : "bg-amber-100 text-amber-800"
                  }`}
                >
                  {statusLabel(nextAppointment.status)}
                </span>
                <p className="mt-3">
                  <Link
                    href="/account/appointments"
                    className="font-medium text-brand-700 hover:underline"
                  >
                    All appointments →
                  </Link>
                </p>
              </div>
            ) : (
              <p className="text-sm text-slate-500">No upcoming appointments.</p>
            )}
          </section>

          <section className="card p-6 text-sm">
            <h2 className="mb-3 font-semibold text-slate-900">At a glance</h2>
            <ul className="space-y-2">
              <li className="flex items-center justify-between">
                <span className="text-slate-600">Garage</span>
                <Link href="/account/vehicles" className="font-medium text-brand-700 hover:underline">
                  {vehicleCount} {pluralize(vehicleCount, "vehicle")}
                </Link>
              </li>
              <li className="flex items-center justify-between">
                <span className="text-slate-600">Notifications</span>
                <Link
                  href="/account/notifications"
                  className="font-medium text-brand-700 hover:underline"
                >
                  {unreadCount} unread
                </Link>
              </li>
            </ul>
          </section>

          <section className="card p-6 text-sm">
            <h2 className="mb-3 font-semibold text-slate-900">Quick links</h2>
            <ul className="space-y-2 font-medium text-brand-700">
              <li>
                <Link href="/account/orders" className="hover:underline">
                  Orders
                </Link>
              </li>
              <li>
                <Link href="/account/appointments" className="hover:underline">
                  Appointments
                </Link>
              </li>
              <li>
                <Link href="/account/vehicles" className="hover:underline">
                  My garage
                </Link>
              </li>
              <li>
                <Link href="/account/settings" className="hover:underline">
                  Settings
                </Link>
              </li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
