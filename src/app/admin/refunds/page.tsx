import Link from "next/link";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { RefundStatus, Role, statusLabel } from "@/lib/enums";
import { formatCents } from "@/lib/money";
import { formatDateTime } from "@/lib/format";
import { requirePageUser } from "@/lib/page-auth";
import { statusBadgeClass } from "@/components/orders/order-utils";

export const metadata: Metadata = { title: "Refunds — admin" };
export const dynamic = "force-dynamic";

export default async function AdminRefundsPage() {
  await requirePageUser([Role.ADMIN], "/admin/refunds");

  const refunds = await db.refund.findMany({
    orderBy: { createdAt: "desc" },
    take: 500,
    include: {
      order: { select: { id: true, orderNumber: true } },
      createdBy: { select: { name: true } },
    },
  });
  const totalCents = refunds.reduce(
    (s, r) => (r.status === RefundStatus.FAILED ? s : s + r.amountCents),
    0,
  );

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-900">Refunds</h1>
        <p className="text-sm text-slate-600">
          {refunds.length} {refunds.length === 1 ? "refund" : "refunds"} ·{" "}
          {formatCents(totalCents)} issued
        </p>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              <th className="px-4 py-3">When</th>
              <th className="px-4 py-3">Order</th>
              <th className="px-4 py-3">Reason</th>
              <th className="px-4 py-3">By</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {refunds.map((r) => (
              <tr key={r.id} className="transition hover:bg-slate-50">
                <td className="px-4 py-3 text-slate-600">{formatDateTime(r.createdAt)}</td>
                <td className="px-4 py-3">
                  <Link
                    href={`/admin/orders/${r.order.id}`}
                    className="font-medium text-brand-700 hover:underline"
                  >
                    {r.order.orderNumber}
                  </Link>
                </td>
                <td className="max-w-[240px] px-4 py-3 text-slate-700">
                  <span className="line-clamp-2">{r.reason}</span>
                </td>
                <td className="px-4 py-3 text-slate-600">{r.createdBy?.name ?? "System"}</td>
                <td className="px-4 py-3">
                  <span className={`badge ${statusBadgeClass(r.status)}`}>
                    {statusLabel(r.status)}
                  </span>
                </td>
                <td className="px-4 py-3 text-right font-semibold text-slate-900">
                  {formatCents(r.amountCents)}
                </td>
              </tr>
            ))}
            {refunds.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                  No refunds issued yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
