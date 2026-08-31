import Link from "next/link";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { OrderStatus, Role, statusLabel, zOrderStatus } from "@/lib/enums";
import { formatCents } from "@/lib/money";
import { formatDate } from "@/lib/format";
import { requirePageUser } from "@/lib/page-auth";
import { statusBadgeClass } from "@/components/orders/order-utils";

export const metadata: Metadata = { title: "Orders — admin" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;

const STATUS_TABS: { value: string; label: string }[] = [
  { value: "", label: "All" },
  ...Object.values(OrderStatus).map((s) => ({ value: s, label: statusLabel(s) })),
];

function tabHref(status: string, q: string): string {
  const sp = new URLSearchParams();
  if (status) sp.set("status", status);
  if (q) sp.set("q", q);
  const qs = sp.toString();
  return `/admin/orders${qs ? `?${qs}` : ""}`;
}

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: { status?: string; q?: string; page?: string };
}) {
  await requirePageUser([Role.ADMIN], "/admin/orders");

  const statusParse = zOrderStatus.safeParse(searchParams.status);
  const status = statusParse.success ? statusParse.data : "";
  const q = (searchParams.q ?? "").trim();
  const rawPage = Number(searchParams.page ?? "1");
  const page = Number.isFinite(rawPage) ? Math.max(1, Math.floor(rawPage)) : 1;

  const where = {
    ...(status ? { status } : {}),
    ...(q
      ? {
          OR: [
            { orderNumber: { contains: q } },
            { user: { email: { contains: q.toLowerCase() } } },
            { user: { name: { contains: q } } },
          ],
        }
      : {}),
  };

  const [total, orders] = await Promise.all([
    db.order.count({ where }),
    db.order.findMany({
      where,
      orderBy: { placedAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        user: { select: { name: true, email: true } },
        items: { select: { qty: true, withInstall: true } },
      },
    }),
  ]);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const pageHref = (p: number) => {
    const sp = new URLSearchParams();
    if (status) sp.set("status", status);
    if (q) sp.set("q", q);
    if (p > 1) sp.set("page", String(p));
    const qs = sp.toString();
    return `/admin/orders${qs ? `?${qs}` : ""}`;
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-900">Orders</h1>
        <form action="/admin/orders" method="GET" className="flex items-center gap-2">
          {status && <input type="hidden" name="status" value={status} />}
          <input
            name="q"
            defaultValue={q}
            placeholder="Order #, customer email or name"
            className="input w-64"
          />
          <button type="submit" className="btn-secondary">
            Search
          </button>
        </form>
      </div>

      {/* status tabs */}
      <div className="mb-4 flex flex-wrap gap-1 overflow-x-auto">
        {STATUS_TABS.map((t) => (
          <Link
            key={t.value || "all"}
            href={tabHref(t.value, q)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition ${
              status === t.value
                ? "bg-slate-900 text-white"
                : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              <th className="px-4 py-3">Order</th>
              <th className="px-4 py-3">Placed</th>
              <th className="px-4 py-3">Customer</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Items</th>
              <th className="px-4 py-3 text-right">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {orders.map((o) => (
              <tr key={o.id} className="transition hover:bg-slate-50">
                <td className="px-4 py-3">
                  <Link
                    href={`/admin/orders/${o.id}`}
                    className="font-medium text-brand-700 hover:underline"
                  >
                    {o.orderNumber}
                  </Link>
                  {o.items.some((i) => i.withInstall) && (
                    <span className="badge ml-2 bg-blue-100 text-blue-800">Install</span>
                  )}
                </td>
                <td className="px-4 py-3 text-slate-600">{formatDate(o.placedAt)}</td>
                <td className="px-4 py-3">
                  <p className="text-slate-900">{o.user.name}</p>
                  <p className="text-xs text-slate-500">{o.user.email}</p>
                </td>
                <td className="px-4 py-3">
                  <span className={`badge ${statusBadgeClass(o.status)}`}>
                    {statusLabel(o.status)}
                  </span>
                </td>
                <td className="px-4 py-3 text-right text-slate-600">
                  {o.items.reduce((s, i) => s + i.qty, 0)}
                </td>
                <td className="px-4 py-3 text-right">
                  <p className="font-semibold text-slate-900">{formatCents(o.totalCents)}</p>
                  {o.refundedTotalCents > 0 && (
                    <p className="text-xs text-purple-700">
                      -{formatCents(o.refundedTotalCents)} refunded
                    </p>
                  )}
                </td>
              </tr>
            ))}
            {orders.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                  No orders match this filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* pagination */}
      <div className="mt-4 flex items-center justify-between text-sm text-slate-600">
        <p>
          {total} {total === 1 ? "order" : "orders"} · page {page} of {pageCount}
        </p>
        <div className="flex gap-2">
          {page > 1 ? (
            <Link href={pageHref(page - 1)} className="btn-secondary">
              ← Previous
            </Link>
          ) : (
            <span className="btn-secondary pointer-events-none opacity-50">← Previous</span>
          )}
          {page < pageCount ? (
            <Link href={pageHref(page + 1)} className="btn-secondary">
              Next →
            </Link>
          ) : (
            <span className="btn-secondary pointer-events-none opacity-50">Next →</span>
          )}
        </div>
      </div>
    </div>
  );
}
