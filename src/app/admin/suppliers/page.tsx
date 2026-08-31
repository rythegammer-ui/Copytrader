import Link from "next/link";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { Role } from "@/lib/enums";
import { formatCents } from "@/lib/money";
import { requirePageUser } from "@/lib/page-auth";
import { SupplierForm } from "@/components/admin-crud/SupplierForm";

export const metadata: Metadata = { title: "Suppliers — admin" };
export const dynamic = "force-dynamic";

export default async function AdminSuppliersPage() {
  await requirePageUser([Role.ADMIN], "/admin/suppliers");

  const suppliers = await db.supplier.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { parts: true } } },
  });

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-900">Suppliers</h1>
        <SupplierForm mode="create" collapsible />
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              <th className="px-4 py-3">Supplier</th>
              <th className="px-4 py-3">Location</th>
              <th className="px-4 py-3 text-right">Lead time</th>
              <th className="px-4 py-3 text-right">Shipping</th>
              <th className="px-4 py-3 text-right">Parts</th>
              <th className="px-4 py-3">Active</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {suppliers.map((s) => (
              <tr key={s.id} className="transition hover:bg-slate-50">
                <td className="px-4 py-3">
                  <Link
                    href={`/admin/suppliers/${s.id}`}
                    className="font-medium text-brand-700 hover:underline"
                  >
                    {s.name}
                  </Link>
                  <p className="text-xs text-slate-500">{s.contactEmail}</p>
                </td>
                <td className="px-4 py-3 text-slate-600">
                  {s.city}, {s.state}
                </td>
                <td className="px-4 py-3 text-right text-slate-600">
                  {s.leadTimeDays} {s.leadTimeDays === 1 ? "day" : "days"}
                </td>
                <td className="px-4 py-3 text-right text-slate-600">
                  {formatCents(s.shippingFlatCents)}
                  {s.shippingPerItemCents > 0 && (
                    <span className="text-xs text-slate-400">
                      {" "}
                      + {formatCents(s.shippingPerItemCents)}/item
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-right text-slate-600">{s._count.parts}</td>
                <td className="px-4 py-3">
                  {s.active ? (
                    <span className="badge bg-green-100 text-green-800">Active</span>
                  ) : (
                    <span className="badge bg-slate-100 text-slate-800">Inactive</span>
                  )}
                </td>
              </tr>
            ))}
            {suppliers.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                  No suppliers yet — create one above.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
