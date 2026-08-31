import Link from "next/link";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { EntityType, POStatus, Role, statusLabel } from "@/lib/enums";
import { formatDateTime, pluralize } from "@/lib/format";
import { requirePageUser } from "@/lib/page-auth";
import { statusBadgeClass } from "@/components/orders/order-utils";
import { SupplierStockToggle } from "@/components/portal/supplier-stock-toggle";

export const metadata: Metadata = { title: "Supplier portal" };
export const dynamic = "force-dynamic";

export default async function SupplierDashboardPage() {
  const user = await requirePageUser([Role.SUPPLIER], "/supplier");
  if (!user.supplierId) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-10">
        <div className="card p-8 text-center">
          <p className="font-medium text-slate-900">No supplier linked to this account</p>
          <p className="mt-1 text-sm text-slate-500">Contact PartsPro support to fix this.</p>
        </div>
      </div>
    );
  }

  const supplierId = user.supplierId;
  const now = new Date();

  const [supplier, newCount, awaitingShipCount, latePos, recentPoRows, parts] = await Promise.all([
    db.supplier.findUnique({ where: { id: supplierId } }),
    db.purchaseOrder.count({
      where: { supplierId, status: POStatus.PENDING_CONFIRMATION },
    }),
    db.purchaseOrder.count({ where: { supplierId, status: POStatus.CONFIRMED } }),
    db.purchaseOrder.findMany({
      where: {
        supplierId,
        status: { in: [POStatus.PENDING_CONFIRMATION, POStatus.CONFIRMED] },
        dueAt: { lt: now },
      },
      orderBy: { dueAt: "asc" },
      select: { id: true, poNumber: true, dueAt: true, status: true },
    }),
    db.purchaseOrder.findMany({
      where: { supplierId },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, poNumber: true },
    }),
    db.part.findMany({
      where: { supplierId },
      orderBy: { name: "asc" },
      take: 30,
      select: { id: true, name: true, sku: true, inStock: true, active: true },
    }),
  ]);

  // Recent activity across this supplier's POs, straight from the audit log.
  const poIds = recentPoRows.map((p) => p.id);
  const poNumberById = new Map(recentPoRows.map((p) => [p.id, p.poNumber]));
  const activity =
    poIds.length > 0
      ? await db.eventLog.findMany({
          where: { entityType: EntityType.PURCHASE_ORDER, entityId: { in: poIds } },
          orderBy: { createdAt: "desc" },
          take: 10,
        })
      : [];

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Supplier portal</h1>
          <p className="text-sm text-slate-600">{supplier?.name ?? "Your company"}</p>
        </div>
        <Link href="/supplier/pos" className="btn-secondary">
          All purchase orders →
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Link href={`/supplier/pos?status=${POStatus.PENDING_CONFIRMATION}`} className="card p-5 hover:border-brand-500">
          <p className="text-sm font-medium text-slate-500">New POs to confirm</p>
          <p className="mt-1 text-3xl font-bold text-slate-900">{newCount}</p>
        </Link>
        <Link href={`/supplier/pos?status=${POStatus.CONFIRMED}`} className="card p-5 hover:border-brand-500">
          <p className="text-sm font-medium text-slate-500">Awaiting shipment</p>
          <p className="mt-1 text-3xl font-bold text-slate-900">{awaitingShipCount}</p>
        </Link>
        <div className="card p-5">
          <p className="text-sm font-medium text-slate-500">Late POs</p>
          <p className="mt-1 flex items-center gap-2 text-3xl font-bold text-slate-900">
            {latePos.length}
            {latePos.length > 0 && <span className="badge bg-red-100 text-red-800">LATE</span>}
          </p>
        </div>
      </div>

      {latePos.length > 0 && (
        <section className="card mt-6 border-red-200 p-5">
          <h2 className="mb-3 text-lg font-semibold text-red-800">
            Past due ({latePos.length} {pluralize(latePos.length, "PO")})
          </h2>
          <ul className="space-y-2 text-sm">
            {latePos.map((po) => (
              <li key={po.id} className="flex flex-wrap items-center gap-3">
                <Link
                  href={`/supplier/pos/${po.id}`}
                  className="font-medium text-brand-700 hover:underline"
                >
                  {po.poNumber}
                </Link>
                <span className={`badge ${statusBadgeClass(po.status)}`}>
                  {statusLabel(po.status)}
                </span>
                <span className="text-red-700">
                  due {po.dueAt ? formatDateTime(po.dueAt) : "—"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="card p-5">
          <h2 className="mb-3 text-lg font-semibold text-slate-900">Recent PO activity</h2>
          {activity.length === 0 ? (
            <p className="text-sm text-slate-500">No activity yet.</p>
          ) : (
            <ul className="space-y-3">
              {activity.map((e) => (
                <li key={e.id} className="text-sm">
                  <Link
                    href={`/supplier/pos/${e.entityId}`}
                    className="font-medium text-brand-700 hover:underline"
                  >
                    {poNumberById.get(e.entityId) ?? "PO"}
                  </Link>{" "}
                  <span className="text-slate-700">{e.message}</span>
                  <span className="block text-xs text-slate-400">{formatDateTime(e.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card p-5">
          <h2 className="mb-3 text-lg font-semibold text-slate-900">Your parts — stock</h2>
          {parts.length === 0 ? (
            <p className="text-sm text-slate-500">No parts in the catalog yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {parts.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900">
                      {p.name}
                      {!p.active && (
                        <span className="badge ml-2 bg-slate-100 text-slate-800">Inactive</span>
                      )}
                    </p>
                    <p className="text-xs text-slate-500">SKU {p.sku}</p>
                  </div>
                  <SupplierStockToggle partId={p.id} inStock={p.inStock} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
