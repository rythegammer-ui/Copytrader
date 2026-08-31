import Link from "next/link";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { POStatus, Role, ShipTo, statusLabel, zPOStatus } from "@/lib/enums";
import { formatCents } from "@/lib/money";
import { formatDate } from "@/lib/format";
import { requirePageUser } from "@/lib/page-auth";
import { statusBadgeClass } from "@/components/orders/order-utils";

export const metadata: Metadata = { title: "Purchase orders" };
export const dynamic = "force-dynamic";

const TABS: { key: string | null; label: string }[] = [
  { key: null, label: "All" },
  { key: POStatus.PENDING_CONFIRMATION, label: statusLabel(POStatus.PENDING_CONFIRMATION) },
  { key: POStatus.CONFIRMED, label: statusLabel(POStatus.CONFIRMED) },
  { key: POStatus.SHIPPED, label: statusLabel(POStatus.SHIPPED) },
  { key: POStatus.DELIVERED, label: statusLabel(POStatus.DELIVERED) },
  { key: POStatus.RECEIVED, label: statusLabel(POStatus.RECEIVED) },
  { key: POStatus.REJECTED, label: statusLabel(POStatus.REJECTED) },
  { key: POStatus.CANCELLED, label: statusLabel(POStatus.CANCELLED) },
];

export default async function SupplierPosPage({
  searchParams,
}: {
  searchParams: { status?: string };
}) {
  const user = await requirePageUser([Role.SUPPLIER], "/supplier/pos");
  if (!user.supplierId) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-10">
        <div className="card p-8 text-center text-sm text-slate-600">
          No supplier linked to this account.
        </div>
      </div>
    );
  }

  const parsed = zPOStatus.safeParse(searchParams.status);
  const activeStatus = parsed.success ? parsed.data : null;

  const pos = await db.purchaseOrder.findMany({
    where: { supplierId: user.supplierId, ...(activeStatus ? { status: activeStatus } : {}) },
    orderBy: { createdAt: "desc" },
    include: {
      order: { select: { orderNumber: true } },
      items: { select: { qty: true } },
    },
  });

  const now = Date.now();

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">Purchase orders</h1>
        <Link href="/supplier" className="text-sm font-medium text-brand-700 hover:underline">
          ← Dashboard
        </Link>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {TABS.map((tab) => {
          const active = tab.key === activeStatus;
          return (
            <Link
              key={tab.label}
              href={tab.key ? `/supplier/pos?status=${tab.key}` : "/supplier/pos"}
              className={`rounded-full border px-3 py-1 text-sm font-medium transition ${
                active
                  ? "border-brand-600 bg-brand-600 text-white"
                  : "border-slate-300 bg-white text-slate-700 hover:border-brand-500"
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>

      {pos.length === 0 ? (
        <div className="card p-10 text-center text-sm text-slate-500">
          No purchase orders {activeStatus ? `with status “${statusLabel(activeStatus)}”` : "yet"}.
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">PO #</th>
                <th className="px-4 py-3">Order</th>
                <th className="px-4 py-3">Destination</th>
                <th className="px-4 py-3">Units</th>
                <th className="px-4 py-3">Your total</th>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3">Due</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {pos.map((po) => {
                const late =
                  po.dueAt !== null &&
                  po.dueAt.getTime() < now &&
                  (po.status === POStatus.PENDING_CONFIRMATION ||
                    po.status === POStatus.CONFIRMED);
                return (
                  <tr key={po.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <Link
                        href={`/supplier/pos/${po.id}`}
                        className="font-medium text-brand-700 hover:underline"
                      >
                        {po.poNumber}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{po.order.orderNumber}</td>
                    <td className="px-4 py-3 text-slate-600">
                      {po.destName} — {po.destCity}, {po.destState}
                      {po.shipTo === ShipTo.INSTALLER && (
                        <span className="badge ml-2 bg-blue-100 text-blue-800">Ship to shop</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {po.items.reduce((sum, i) => sum + i.qty, 0)}
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-900">
                      {formatCents(po.supplierCostTotalCents)}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{formatDate(po.createdAt)}</td>
                    <td className={`px-4 py-3 ${late ? "font-medium text-red-700" : "text-slate-600"}`}>
                      {po.dueAt ? formatDate(po.dueAt) : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`badge ${statusBadgeClass(po.status)}`}>
                        {statusLabel(po.status)}
                      </span>
                      {late && <span className="badge ml-1 bg-red-100 text-red-800">LATE</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
