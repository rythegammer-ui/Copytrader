import Link from "next/link";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { Role } from "@/lib/enums";
import { formatCents } from "@/lib/money";
import { requirePageUser } from "@/lib/page-auth";
import { daysMaskLabel, minutesToHHMM } from "@/components/admin-crud/crud-shared";
import { InstallerForm } from "@/components/admin-crud/InstallerForm";

export const metadata: Metadata = { title: "Installers — admin" };
export const dynamic = "force-dynamic";

export default async function AdminInstallersPage() {
  await requirePageUser([Role.ADMIN], "/admin/installers");

  const installers = await db.installer.findMany({ orderBy: { name: "asc" } });

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-900">Installer shops</h1>
        <InstallerForm mode="create" collapsible />
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              <th className="px-4 py-3">Shop</th>
              <th className="px-4 py-3">City</th>
              <th className="px-4 py-3 text-right">Rate</th>
              <th className="px-4 py-3 text-right">Bays</th>
              <th className="px-4 py-3">Hours</th>
              <th className="px-4 py-3">Active</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {installers.map((i) => (
              <tr key={i.id} className="transition hover:bg-slate-50">
                <td className="px-4 py-3">
                  <Link
                    href={`/admin/installers/${i.id}`}
                    className="font-medium text-brand-700 hover:underline"
                  >
                    {i.name}
                  </Link>
                </td>
                <td className="px-4 py-3 text-slate-600">
                  {i.city}, {i.state}
                </td>
                <td className="px-4 py-3 text-right text-slate-900">
                  {formatCents(i.hourlyRateCents)}/hr
                </td>
                <td className="px-4 py-3 text-right text-slate-600">{i.bays}</td>
                <td className="px-4 py-3 text-slate-600">
                  <p>
                    {minutesToHHMM(i.openMinutes)}–{minutesToHHMM(i.closeMinutes)}
                  </p>
                  <p className="text-xs text-slate-400">{daysMaskLabel(i.daysOpenMask)}</p>
                </td>
                <td className="px-4 py-3">
                  {i.active ? (
                    <span className="badge bg-green-100 text-green-800">Active</span>
                  ) : (
                    <span className="badge bg-slate-100 text-slate-800">Inactive</span>
                  )}
                </td>
              </tr>
            ))}
            {installers.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                  No installer shops yet — create one above.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
