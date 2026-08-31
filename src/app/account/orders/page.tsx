import Link from "next/link";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { OrderStatus, Role, statusLabel } from "@/lib/enums";
import { formatCents } from "@/lib/money";
import { formatDate, pluralize } from "@/lib/format";
import { requirePageUser } from "@/lib/page-auth";
import { expireStaleUnpaidOrder } from "@/lib/fulfillment";
import { statusBadgeClass } from "@/components/orders/order-utils";

export const metadata: Metadata = { title: "My orders" };
export const dynamic = "force-dynamic";

const STALE_MS = 24 * 60 * 60_000;

function loadOrders(userId: string) {
  return db.order.findMany({
    where: { userId },
    orderBy: { placedAt: "desc" },
    include: { items: { select: { imageUrlSnapshot: true, nameSnapshot: true, qty: true } } },
  });
}

export default async function OrdersPage() {
  const user = await requirePageUser([Role.CUSTOMER, Role.ADMIN], "/account/orders");

  let orders = await loadOrders(user.id);
  const staleCandidates = orders.filter(
    (o) =>
      (o.status === OrderStatus.PENDING_PAYMENT || o.status === OrderStatus.PAYMENT_FAILED) &&
      Date.now() - o.placedAt.getTime() > STALE_MS,
  );
  let anyExpired = false;
  for (const o of staleCandidates) {
    if (await expireStaleUnpaidOrder(o)) anyExpired = true;
  }
  if (anyExpired) orders = await loadOrders(user.id);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">My orders</h1>
        <Link href="/account" className="text-sm font-medium text-brand-700 hover:underline">
          ← Account
        </Link>
      </div>

      {orders.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="text-lg font-medium text-slate-900">No orders yet</p>
          <p className="mt-1 text-sm text-slate-500">
            Find parts that fit your vehicle and we&apos;ll handle shipping and installation.
          </p>
          <Link href="/parts" className="btn-primary mt-5">
            Shop parts
          </Link>
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3 font-medium">Order</th>
                <th className="px-5 py-3 font-medium">Placed</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">Total</th>
                <th className="px-5 py-3 font-medium">Items</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {orders.map((o) => {
                const itemCount = o.items.reduce((sum, i) => sum + i.qty, 0);
                return (
                  <tr key={o.id} className="hover:bg-slate-50">
                    <td className="px-5 py-4 font-medium text-slate-900">
                      <Link href={`/account/orders/${o.id}`} className="hover:underline">
                        {o.orderNumber}
                      </Link>
                    </td>
                    <td className="px-5 py-4 text-slate-600">{formatDate(o.placedAt)}</td>
                    <td className="px-5 py-4">
                      <span className={`badge ${statusBadgeClass(o.status)}`}>
                        {statusLabel(o.status)}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      {o.refundedTotalCents > 0 ? (
                        <div>
                          <span
                            className={`font-semibold text-slate-900 ${
                              o.refundedTotalCents >= o.totalCents
                                ? "text-slate-400 line-through"
                                : ""
                            }`}
                          >
                            {formatCents(o.totalCents)}
                          </span>
                          <p className="text-xs text-purple-700">
                            -{formatCents(o.refundedTotalCents)} refunded
                          </p>
                        </div>
                      ) : (
                        <span className="font-semibold text-slate-900">
                          {formatCents(o.totalCents)}
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2">
                        <div className="flex -space-x-2">
                          {o.items.slice(0, 3).map((i, idx) => (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              key={idx}
                              src={i.imageUrlSnapshot || "/images/placeholders/part.svg"}
                              alt={i.nameSnapshot}
                              className="h-9 w-9 rounded-full border-2 border-white bg-slate-100 object-cover"
                            />
                          ))}
                        </div>
                        <span className="text-xs text-slate-500">
                          {itemCount} {pluralize(itemCount, "item")}
                        </span>
                      </div>
                    </td>
                    <td className="px-5 py-4 text-right">
                      <Link
                        href={`/account/orders/${o.id}`}
                        className="text-sm font-medium text-brand-700 hover:underline"
                      >
                        View →
                      </Link>
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
