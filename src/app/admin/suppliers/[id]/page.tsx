import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { POStatus, Role, statusLabel } from "@/lib/enums";
import { formatCents } from "@/lib/money";
import { formatDate } from "@/lib/format";
import { requirePageUser } from "@/lib/page-auth";
import { statusBadgeClass } from "@/components/orders/order-utils";
import { SupplierForm } from "@/components/admin-crud/SupplierForm";
import { CreateUserForm } from "@/components/admin-crud/UserForms";

export const metadata: Metadata = { title: "Supplier — admin" };
export const dynamic = "force-dynamic";

const OPEN_PO_STATUSES: string[] = [
  POStatus.PENDING_CONFIRMATION,
  POStatus.CONFIRMED,
  POStatus.SHIPPED,
];

export default async function AdminSupplierDetailPage({ params }: { params: { id: string } }) {
  await requirePageUser([Role.ADMIN], `/admin/suppliers/${params.id}`);

  const supplier = await db.supplier.findUnique({ where: { id: params.id } });
  if (!supplier) notFound();

  const [parts, openPos, users] = await Promise.all([
    db.part.findMany({
      where: { supplierId: supplier.id },
      orderBy: { name: "asc" },
      select: { id: true, sku: true, name: true, priceCents: true, inStock: true, active: true },
    }),
    db.purchaseOrder.findMany({
      where: { supplierId: supplier.id, status: { in: OPEN_PO_STATUSES } },
      orderBy: { createdAt: "desc" },
      select: { id: true, poNumber: true, status: true, dueAt: true, orderId: true },
    }),
    db.user.findMany({
      where: { supplierId: supplier.id, role: Role.SUPPLIER },
      orderBy: { email: "asc" },
      select: { id: true, email: true, name: true },
    }),
  ]);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <div className="mb-4">
        <Link href="/admin/suppliers" className="text-sm text-brand-700 hover:underline">
          ← Back to suppliers
        </Link>
        <h1 className="mt-1 text-2xl font-bold text-slate-900">{supplier.name}</h1>
        <p className="text-sm text-slate-500">
          {parts.length} {parts.length === 1 ? "part" : "parts"} · {openPos.length} open{" "}
          {openPos.length === 1 ? "PO" : "POs"}
        </p>
      </div>

      <div className="space-y-6">
        <SupplierForm
          mode="edit"
          supplierId={supplier.id}
          initial={{
            name: supplier.name,
            slug: supplier.slug,
            contactEmail: supplier.contactEmail,
            phone: supplier.phone ?? "",
            city: supplier.city,
            state: supplier.state,
            leadTimeDays: supplier.leadTimeDays,
            shippingFlatCents: supplier.shippingFlatCents,
            shippingPerItemCents: supplier.shippingPerItemCents,
            active: supplier.active,
          }}
        />

        <div className="card p-5">
          <h2 className="mb-3 text-lg font-semibold text-slate-900">Open purchase orders</h2>
          {openPos.length === 0 ? (
            <p className="text-sm text-slate-500">No open POs.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[480px] text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-3 py-2">PO</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Due</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {openPos.map((po) => (
                    <tr key={po.id}>
                      <td className="px-3 py-2">
                        <Link
                          href={`/admin/orders/${po.orderId}`}
                          className="font-medium text-brand-700 hover:underline"
                        >
                          {po.poNumber}
                        </Link>
                      </td>
                      <td className="px-3 py-2">
                        <span className={`badge ${statusBadgeClass(po.status)}`}>
                          {statusLabel(po.status)}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-slate-600">
                        {po.dueAt ? formatDate(po.dueAt) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card p-5">
          <h2 className="mb-3 text-lg font-semibold text-slate-900">Parts from this supplier</h2>
          {parts.length === 0 ? (
            <p className="text-sm text-slate-500">No parts yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-3 py-2">Part</th>
                    <th className="px-3 py-2">SKU</th>
                    <th className="px-3 py-2 text-right">Price</th>
                    <th className="px-3 py-2">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {parts.map((p) => (
                    <tr key={p.id}>
                      <td className="px-3 py-2">
                        <Link
                          href={`/admin/parts/${p.id}`}
                          className="font-medium text-brand-700 hover:underline"
                        >
                          {p.name}
                        </Link>
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-slate-600">{p.sku}</td>
                      <td className="px-3 py-2 text-right text-slate-900">
                        {formatCents(p.priceCents)}
                      </td>
                      <td className="px-3 py-2">
                        {!p.active ? (
                          <span className="badge bg-slate-100 text-slate-800">Inactive</span>
                        ) : p.inStock ? (
                          <span className="badge bg-green-100 text-green-800">In stock</span>
                        ) : (
                          <span className="badge bg-amber-100 text-amber-800">Out of stock</span>
                        )}
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
            <p className="mb-3 text-sm text-slate-500">No portal logins for this supplier yet.</p>
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
            fixedRole={Role.SUPPLIER}
            fixedSupplierId={supplier.id}
            collapsible
            buttonLabel="+ Create portal login"
          />
        </div>
      </div>
    </div>
  );
}
