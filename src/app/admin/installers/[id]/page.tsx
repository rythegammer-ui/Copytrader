import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { AppointmentStatus, Role, statusLabel } from "@/lib/enums";
import { formatShopTime } from "@/lib/format";
import { requirePageUser } from "@/lib/page-auth";
import { laborLabel, statusBadgeClass } from "@/components/orders/order-utils";
import { InstallerForm } from "@/components/admin-crud/InstallerForm";
import { CreateUserForm } from "@/components/admin-crud/UserForms";

export const metadata: Metadata = { title: "Installer — admin" };
export const dynamic = "force-dynamic";

export default async function AdminInstallerDetailPage({ params }: { params: { id: string } }) {
  await requirePageUser([Role.ADMIN], `/admin/installers/${params.id}`);

  const installer = await db.installer.findUnique({ where: { id: params.id } });
  if (!installer) notFound();

  const [appointments, users] = await Promise.all([
    db.appointment.findMany({
      where: {
        installerId: installer.id,
        startAt: { gte: new Date() },
        status: { in: [AppointmentStatus.PENDING_PARTS, AppointmentStatus.READY] },
      },
      orderBy: { startAt: "asc" },
      take: 12,
      include: { order: { select: { id: true, orderNumber: true } } },
    }),
    db.user.findMany({
      where: { installerId: installer.id, role: Role.INSTALLER },
      orderBy: { email: "asc" },
      select: { id: true, email: true, name: true },
    }),
  ]);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <div className="mb-4">
        <Link href="/admin/installers" className="text-sm text-brand-700 hover:underline">
          ← Back to installers
        </Link>
        <h1 className="mt-1 text-2xl font-bold text-slate-900">{installer.name}</h1>
        <p className="text-sm text-slate-500">
          {installer.line1}, {installer.city}, {installer.state} {installer.zip}
        </p>
      </div>

      <div className="space-y-6">
        <InstallerForm
          mode="edit"
          installerId={installer.id}
          initial={{
            name: installer.name,
            slug: installer.slug,
            hourlyRateCents: installer.hourlyRateCents,
            line1: installer.line1,
            city: installer.city,
            state: installer.state,
            zip: installer.zip,
            phone: installer.phone ?? "",
            bays: installer.bays,
            openMinutes: installer.openMinutes,
            closeMinutes: installer.closeMinutes,
            slotMinutes: installer.slotMinutes,
            daysOpenMask: installer.daysOpenMask,
            tzOffsetMinutes: installer.tzOffsetMinutes,
            active: installer.active,
          }}
        />

        <div className="card p-5">
          <h2 className="mb-3 text-lg font-semibold text-slate-900">Upcoming schedule</h2>
          {appointments.length === 0 ? (
            <p className="text-sm text-slate-500">No upcoming appointments.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-3 py-2">When (shop time)</th>
                    <th className="px-3 py-2">Order</th>
                    <th className="px-3 py-2">Customer</th>
                    <th className="px-3 py-2 text-right">Labor</th>
                    <th className="px-3 py-2">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {appointments.map((a) => (
                    <tr key={a.id}>
                      <td className="px-3 py-2 text-slate-900">
                        {formatShopTime(a.startAt, installer.tzOffsetMinutes)}
                      </td>
                      <td className="px-3 py-2">
                        <Link
                          href={`/admin/orders/${a.order.id}`}
                          className="font-medium text-brand-700 hover:underline"
                        >
                          {a.order.orderNumber}
                        </Link>
                      </td>
                      <td className="px-3 py-2 text-slate-600">{a.customerName}</td>
                      <td className="px-3 py-2 text-right text-slate-600">
                        {laborLabel(a.totalLaborHoursTenths)}
                      </td>
                      <td className="px-3 py-2">
                        <span className={`badge ${statusBadgeClass(a.status)}`}>
                          {statusLabel(a.status)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card p-5">
          <h2 className="mb-3 text-lg font-semibold text-slate-900">Portal logins</h2>
          {users.length === 0 ? (
            <p className="mb-3 text-sm text-slate-500">No portal logins for this shop yet.</p>
          ) : (
            <ul className="mb-4 space-y-1 text-sm">
              {users.map((u) => (
                <li key={u.id} className="text-slate-700">
                  <span className="font-medium text-slate-900">{u.name}</span> · {u.email}
                </li>
              ))}
            </ul>
          )}
          <CreateUserForm
            suppliers={[]}
            installers={[]}
            fixedRole={Role.INSTALLER}
            fixedInstallerId={installer.id}
            collapsible
            buttonLabel="+ Create portal login"
          />
        </div>
      </div>
    </div>
  );
}
