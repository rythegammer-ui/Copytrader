import Link from "next/link";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { Role } from "@/lib/enums";
import { formatCents } from "@/lib/money";
import { requirePageUser } from "@/lib/page-auth";

export const metadata: Metadata = { title: "Parts — admin" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;

export default async function AdminPartsPage({
  searchParams,
}: {
  searchParams: { q?: string; categoryId?: string; supplierId?: string; page?: string };
}) {
  await requirePageUser([Role.ADMIN], "/admin/parts");

  const q = (searchParams.q ?? "").trim();
  const categoryId = (searchParams.categoryId ?? "").trim();
  const supplierId = (searchParams.supplierId ?? "").trim();
  const rawPage = Number(searchParams.page ?? "1");
  const page = Number.isFinite(rawPage) ? Math.max(1, Math.floor(rawPage)) : 1;

  const where = {
    ...(categoryId ? { categoryId } : {}),
    ...(supplierId ? { supplierId } : {}),
    ...(q
      ? { OR: [{ name: { contains: q } }, { sku: { contains: q } }, { slug: { contains: q } }] }
      : {}),
  };

  const [total, parts, categories, suppliers] = await Promise.all([
    db.part.count({ where }),
    db.part.findMany({
      where,
      orderBy: { name: "asc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        brand: { select: { name: true } },
        supplier: { select: { name: true } },
      },
    }),
    db.category.findMany({ orderBy: { name: "asc" } }),
    db.supplier.findMany({ orderBy: { name: "asc" } }),
  ]);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const pageHref = (p: number) => {
    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    if (categoryId) sp.set("categoryId", categoryId);
    if (supplierId) sp.set("supplierId", supplierId);
    if (p > 1) sp.set("page", String(p));
    const qs = sp.toString();
    return `/admin/parts${qs ? `?${qs}` : ""}`;
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-900">Parts</h1>
        <Link href="/admin/parts/new" className="btn-primary">
          + New part
        </Link>
      </div>

      <form action="/admin/parts" method="GET" className="mb-4 flex flex-wrap items-center gap-2">
        <input name="q" defaultValue={q} placeholder="Name, SKU or slug" className="input w-56" />
        <select name="categoryId" defaultValue={categoryId} className="input w-48">
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select name="supplierId" defaultValue={supplierId} className="input w-48">
          <option value="">All suppliers</option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <button type="submit" className="btn-secondary">
          Filter
        </button>
      </form>

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[820px] text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              <th className="px-4 py-3">Part</th>
              <th className="px-4 py-3">SKU</th>
              <th className="px-4 py-3">Brand</th>
              <th className="px-4 py-3">Supplier</th>
              <th className="px-4 py-3 text-right">Price</th>
              <th className="px-4 py-3">Stock</th>
              <th className="px-4 py-3">Active</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {parts.map((p) => (
              <tr key={p.id} className="transition hover:bg-slate-50">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <img
                      src={p.imageUrl}
                      alt=""
                      className="h-10 w-10 flex-shrink-0 rounded-lg border border-slate-200 bg-white object-cover"
                    />
                    <Link
                      href={`/admin/parts/${p.id}`}
                      className="font-medium text-brand-700 hover:underline"
                    >
                      {p.name}
                    </Link>
                  </div>
                </td>
                <td className="px-4 py-3 font-mono text-xs text-slate-600">{p.sku}</td>
                <td className="px-4 py-3 text-slate-600">{p.brand.name}</td>
                <td className="px-4 py-3 text-slate-600">{p.supplier.name}</td>
                <td className="px-4 py-3 text-right font-semibold text-slate-900">
                  {formatCents(p.priceCents)}
                </td>
                <td className="px-4 py-3">
                  {p.inStock ? (
                    <span className="badge bg-green-100 text-green-800">In stock</span>
                  ) : (
                    <span className="badge bg-amber-100 text-amber-800">Out of stock</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {p.active ? (
                    <span className="badge bg-green-100 text-green-800">Active</span>
                  ) : (
                    <span className="badge bg-slate-100 text-slate-800">Inactive</span>
                  )}
                </td>
              </tr>
            ))}
            {parts.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                  No parts match this filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center justify-between text-sm text-slate-600">
        <p>
          {total} {total === 1 ? "part" : "parts"} · page {page} of {pageCount}
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
