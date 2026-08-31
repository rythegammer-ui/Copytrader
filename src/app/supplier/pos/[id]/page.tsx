import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { EntityType, OrderItemStatus, POStatus, Role, ShipTo, statusLabel } from "@/lib/enums";
import { formatCents } from "@/lib/money";
import { formatDate, formatDateTime, pluralize } from "@/lib/format";
import { requirePageUser } from "@/lib/page-auth";
import { statusBadgeClass } from "@/components/orders/order-utils";
import { SupplierPoActions } from "@/components/portal/supplier-po-actions";
import { SupplierPrintButton } from "@/components/portal/supplier-print-button";

export const metadata: Metadata = { title: "Purchase order" };
export const dynamic = "force-dynamic";

export default async function SupplierPoDetailPage({ params }: { params: { id: string } }) {
  const user = await requirePageUser([Role.SUPPLIER], `/supplier/pos/${params.id}`);
  if (!user.supplierId) notFound();

  const po = await db.purchaseOrder.findFirst({
    where: { id: params.id, supplierId: user.supplierId },
    include: {
      order: { select: { orderNumber: true } },
      supplier: { select: { name: true } },
      items: {
        select: {
          id: true,
          skuSnapshot: true,
          nameSnapshot: true,
          qty: true,
          supplierCostCentsSnapshot: true,
          itemStatus: true,
        },
      },
    },
  });
  if (!po) notFound();

  const events = await db.eventLog.findMany({
    where: { entityType: EntityType.PURCHASE_ORDER, entityId: po.id },
    orderBy: { createdAt: "desc" },
  });

  const now = Date.now();
  const late =
    po.dueAt !== null &&
    po.dueAt.getTime() < now &&
    (po.status === POStatus.PENDING_CONFIRMATION || po.status === POStatus.CONFIRMED);
  const totalUnits = po.items.reduce((sum, i) => sum + i.qty, 0);

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
      {/* Print mode: hide the app chrome and everything but the packing slip. */}
      <style>{`
        @media print {
          header, footer, .no-print { display: none !important; }
          body { background: #fff !important; }
          #packing-slip { border: none !important; box-shadow: none !important; }
        }
      `}</style>

      <div className="no-print mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold text-slate-900">{po.poNumber}</h1>
          <span className={`badge ${statusBadgeClass(po.status)}`}>{statusLabel(po.status)}</span>
          {late && <span className="badge bg-red-100 text-red-800">LATE</span>}
        </div>
        <Link href="/supplier/pos" className="text-sm font-medium text-brand-700 hover:underline">
          ← All POs
        </Link>
      </div>

      <div className="no-print card mb-6 flex flex-wrap items-center justify-between gap-3 p-5">
        <SupplierPoActions poId={po.id} status={po.status} />
        <SupplierPrintButton />
      </div>

      {po.status === POStatus.REJECTED && po.rejectReason && (
        <div className="no-print card mb-6 border-red-200 bg-red-50 p-5 text-sm text-red-800">
          <p className="font-semibold">Rejected</p>
          <p className="mt-1">{po.rejectReason}</p>
        </div>
      )}

      {po.carrier && po.trackingNumber && (
        <div className="no-print card mb-6 p-5 text-sm">
          <p className="font-semibold text-slate-900">Shipment</p>
          <p className="mt-1 text-slate-700">
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
                  Track package →
                </a>
              </>
            )}
          </p>
        </div>
      )}

      {/* ======== PACKING SLIP (printable) ======== */}
      <section id="packing-slip" className="card p-6">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-4">
          <div>
            <p className="text-lg font-bold text-slate-900">PartsPro packing slip</p>
            <p className="text-sm text-slate-600">
              {po.poNumber} · Order {po.order.orderNumber}
            </p>
            <p className="text-sm text-slate-600">Supplier: {po.supplier.name}</p>
          </div>
          <div className="text-right text-sm text-slate-600">
            <p>Created {formatDate(po.createdAt)}</p>
            <p>Ship by {po.dueAt ? formatDate(po.dueAt) : "—"}</p>
          </div>
        </div>

        <div className="mt-4 rounded-lg border-2 border-slate-800 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Ship to{po.shipTo === ShipTo.INSTALLER ? " (installer shop)" : ""}
          </p>
          <p className="mt-1 text-lg font-bold text-slate-900">{po.destName}</p>
          <p className="text-base text-slate-800">{po.destLine1}</p>
          {po.destLine2 && <p className="text-base text-slate-800">{po.destLine2}</p>}
          <p className="text-base text-slate-800">
            {po.destCity}, {po.destState} {po.destZip}
          </p>
        </div>

        <table className="mt-5 w-full text-left text-sm">
          <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="py-2 pr-4">SKU</th>
              <th className="py-2 pr-4">Item</th>
              <th className="py-2 text-right">Qty</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {po.items.map((i) => (
              <tr
                key={i.id}
                className={i.itemStatus !== OrderItemStatus.PENDING ? "text-slate-400" : ""}
              >
                <td className="py-2 pr-4 font-mono text-xs">{i.skuSnapshot}</td>
                <td className="py-2 pr-4">
                  {i.nameSnapshot}
                  {i.itemStatus !== OrderItemStatus.PENDING && (
                    <span className="badge ml-2 bg-slate-100 text-slate-800">
                      {statusLabel(i.itemStatus)} — do not ship
                    </span>
                  )}
                </td>
                <td className="py-2 text-right font-medium">{i.qty}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-slate-200 font-semibold text-slate-900">
              <td className="py-2 pr-4" colSpan={2}>
                Total units
              </td>
              <td className="py-2 text-right">{totalUnits}</td>
            </tr>
          </tfoot>
        </table>
      </section>

      {/* Costs — supplier settlement view, kept off the printed slip. */}
      <section className="no-print card mt-6 p-5">
        <h2 className="mb-3 text-lg font-semibold text-slate-900">Costs</h2>
        <dl className="space-y-1 text-sm">
          {po.items.map((i) => (
            <div key={i.id} className="flex justify-between text-slate-700">
              <dt>
                {i.nameSnapshot} × {i.qty}
              </dt>
              <dd>{formatCents(i.supplierCostCentsSnapshot * i.qty)}</dd>
            </div>
          ))}
          <div className="flex justify-between border-t border-slate-200 pt-2 font-semibold text-slate-900">
            <dt>Total owed to you</dt>
            <dd>{formatCents(po.supplierCostTotalCents)}</dd>
          </div>
        </dl>
      </section>

      <section className="no-print card mt-6 p-5">
        <h2 className="mb-3 text-lg font-semibold text-slate-900">
          History ({events.length} {pluralize(events.length, "event")})
        </h2>
        {events.length === 0 ? (
          <p className="text-sm text-slate-500">No events recorded.</p>
        ) : (
          <ul className="space-y-3">
            {events.map((e) => (
              <li key={e.id} className="text-sm">
                <p className="text-slate-700">{e.message}</p>
                <p className="text-xs text-slate-400">
                  {formatDateTime(e.createdAt)}
                  {e.fromStatus && e.toStatus
                    ? ` · ${statusLabel(e.fromStatus)} → ${statusLabel(e.toStatus)}`
                    : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
