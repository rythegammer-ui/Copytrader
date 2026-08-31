import Link from "next/link";
import type { Metadata } from "next";
import type { Prisma } from "@prisma/client";
import { getCart } from "@/lib/cart";
import { db } from "@/lib/db";
import { compatibleWhere, fitmentVerdict, type VehicleContext } from "@/lib/fitment";
import { installUnitCents } from "@/lib/pricing";
import { PartCard, type PartCardData } from "@/components/catalog/PartCard";
import { VehiclePicker, type CurrentVehicle } from "@/components/catalog/VehiclePicker";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Shop parts" };

const PAGE_SIZE = 24;

type SearchParams = Record<string, string | string[] | undefined>;

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function qs(params: Record<string, string | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v) sp.set(k, v);
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

async function resolveVehicle(): Promise<{
  ctx: VehicleContext | null;
  current: CurrentVehicle | null;
}> {
  const cart = await getCart();
  if (!cart?.ctxModelId || cart.ctxYear == null) return { ctx: null, current: null };
  const model = await db.vehicleModel.findUnique({
    where: { id: cart.ctxModelId },
    include: { make: true },
  });
  if (!model) return { ctx: null, current: null };
  const engine = cart.ctxEngineId
    ? await db.engine.findUnique({ where: { id: cart.ctxEngineId } })
    : null;
  return {
    ctx: { modelId: model.id, year: cart.ctxYear, engineId: engine?.id ?? null },
    current: {
      makeId: model.makeId,
      modelId: model.id,
      year: cart.ctxYear,
      engineId: engine?.id ?? null,
      label: `${cart.ctxYear} ${model.make.name} ${model.name}${engine ? ` ${engine.name}` : ""}`,
    },
  };
}

export default async function PartsPage({ searchParams }: { searchParams: SearchParams }) {
  const q = first(searchParams.q)?.trim() || undefined;
  const categorySlug = first(searchParams.category) || undefined;
  const brandId = first(searchParams.brand) || undefined;
  const installOnly = first(searchParams.install) === "1";
  const inStockOnly = first(searchParams.instock) === "1";
  const sort = first(searchParams.sort) || undefined;
  const page = Math.max(1, parseInt(first(searchParams.page) ?? "1", 10) || 1);

  const { ctx, current } = await resolveVehicle();

  const and: Prisma.PartWhereInput[] = [{ active: true }];
  if (q) {
    and.push({
      OR: [{ name: { contains: q } }, { sku: { contains: q } }, { brand: { name: { contains: q } } }],
    });
  }
  if (categorySlug) {
    and.push({ category: { OR: [{ slug: categorySlug }, { parent: { slug: categorySlug } }] } });
  }
  if (brandId) and.push({ brandId });
  if (installOnly) and.push({ installEligible: true });
  if (inStockOnly) and.push({ inStock: true });
  if (ctx) and.push(compatibleWhere(ctx));
  const where: Prisma.PartWhereInput = { AND: and };

  const orderBy: Prisma.PartOrderByWithRelationInput[] =
    sort === "price_asc"
      ? [{ priceCents: "asc" }, { name: "asc" }]
      : sort === "price_desc"
        ? [{ priceCents: "desc" }, { name: "asc" }]
        : [{ name: "asc" }];

  const [total, parts, categories, brands, installers] = await Promise.all([
    db.part.count({ where }),
    db.part.findMany({
      where,
      orderBy,
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { brand: { select: { name: true } }, fitments: true },
    }),
    db.category.findMany({ orderBy: { name: "asc" } }),
    db.brand.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.installer.findMany({ where: { active: true }, select: { hourlyRateCents: true } }),
  ]);

  const cards: PartCardData[] = parts.map((part) => ({
    id: part.id,
    slug: part.slug,
    name: part.name,
    priceCents: part.priceCents,
    imageUrl: part.imageUrl,
    brandName: part.brand.name,
    installEligible: part.installEligible,
    inStock: part.inStock,
    installFromCents:
      part.installEligible && installers.length > 0
        ? Math.min(...installers.map((s) => installUnitCents(part, s.hourlyRateCents)))
        : null,
    verdict: fitmentVerdict(part, part.fitments, ctx),
  }));

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const keepFilters = {
    q,
    brand: brandId,
    install: installOnly ? "1" : undefined,
    instock: inStockOnly ? "1" : undefined,
    sort,
  };
  const parentCats = categories.filter((c) => c.parentId === null);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      {/* Fitment banner */}
      <div className="card mb-6 p-4">
        {current ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm font-semibold text-slate-900">
              Showing parts for {current.label}
            </p>
            <VehiclePicker current={current} compact />
          </div>
        ) : (
          <div>
            <p className="mb-2 text-sm font-semibold text-slate-900">
              Select your vehicle to only see parts that fit
            </p>
            <VehiclePicker current={null} compact />
          </div>
        )}
      </div>

      <div className="flex flex-col gap-8 lg:flex-row">
        {/* Sidebar */}
        <aside className="w-full shrink-0 lg:w-64">
          <div className="card p-4">
            <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-500">
              Categories
            </h2>
            <ul className="space-y-1 text-sm">
              <li>
                <Link
                  href={`/parts${qs(keepFilters)}`}
                  className={
                    !categorySlug ? "font-semibold text-brand-700" : "text-slate-700 hover:text-brand-700"
                  }
                >
                  All categories
                </Link>
              </li>
              {parentCats.map((cat) => (
                <li key={cat.id}>
                  <Link
                    href={`/parts${qs({ ...keepFilters, category: cat.slug })}`}
                    className={
                      categorySlug === cat.slug
                        ? "font-semibold text-brand-700"
                        : "text-slate-700 hover:text-brand-700"
                    }
                  >
                    {cat.name}
                  </Link>
                  {categories.some((c) => c.parentId === cat.id) && (
                    <ul className="ml-3 mt-1 space-y-1">
                      {categories
                        .filter((c) => c.parentId === cat.id)
                        .map((child) => (
                          <li key={child.id}>
                            <Link
                              href={`/parts${qs({ ...keepFilters, category: child.slug })}`}
                              className={
                                categorySlug === child.slug
                                  ? "font-semibold text-brand-700"
                                  : "text-slate-600 hover:text-brand-700"
                              }
                            >
                              {child.name}
                            </Link>
                          </li>
                        ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>

            <form method="GET" action="/parts" className="mt-5 space-y-3 border-t border-slate-200 pt-4">
              {categorySlug && <input type="hidden" name="category" value={categorySlug} />}
              {sort && <input type="hidden" name="sort" value={sort} />}
              <div>
                <label className="label" htmlFor="flt-q">
                  Search
                </label>
                <input
                  id="flt-q"
                  name="q"
                  defaultValue={q ?? ""}
                  placeholder="Name, SKU, or brand"
                  className="input"
                />
              </div>
              <div>
                <label className="label" htmlFor="flt-brand">
                  Brand
                </label>
                <select id="flt-brand" name="brand" defaultValue={brandId ?? ""} className="input">
                  <option value="">All brands</option>
                  {brands.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  name="install"
                  value="1"
                  defaultChecked={installOnly}
                  className="h-4 w-4 rounded border-slate-300 text-brand-600"
                />
                Installation available
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  name="instock"
                  value="1"
                  defaultChecked={inStockOnly}
                  className="h-4 w-4 rounded border-slate-300 text-brand-600"
                />
                In stock only
              </label>
              <button type="submit" className="btn-secondary w-full">
                Apply filters
              </button>
            </form>
          </div>
        </aside>

        {/* Results */}
        <section className="flex-1">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-slate-600">
              {total} {total === 1 ? "part" : "parts"}
              {q ? ` matching “${q}”` : ""}
            </p>
            <form method="GET" action="/parts" className="flex items-center gap-2 text-sm">
              {q && <input type="hidden" name="q" value={q} />}
              {categorySlug && <input type="hidden" name="category" value={categorySlug} />}
              {brandId && <input type="hidden" name="brand" value={brandId} />}
              {installOnly && <input type="hidden" name="install" value="1" />}
              {inStockOnly && <input type="hidden" name="instock" value="1" />}
              <label htmlFor="flt-sort" className="text-slate-500">
                Sort
              </label>
              <select id="flt-sort" name="sort" defaultValue={sort ?? ""} className="input w-auto">
                <option value="">Name (A–Z)</option>
                <option value="price_asc">Price: low to high</option>
                <option value="price_desc">Price: high to low</option>
              </select>
              <button type="submit" className="btn-secondary">
                Go
              </button>
            </form>
          </div>

          {cards.length === 0 ? (
            <div className="card p-10 text-center">
              <p className="font-semibold text-slate-900">No parts match these filters.</p>
              <p className="mt-1 text-sm text-slate-500">
                {ctx
                  ? "Try clearing your vehicle or removing some filters."
                  : "Try removing some filters."}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {cards.map((card) => (
                <PartCard key={card.id} part={card} />
              ))}
            </div>
          )}

          {totalPages > 1 && (
            <nav className="mt-8 flex items-center justify-center gap-3 text-sm">
              {page > 1 ? (
                <Link
                  className="btn-secondary"
                  href={`/parts${qs({ ...keepFilters, category: categorySlug, page: `${page - 1}` })}`}
                >
                  ← Previous
                </Link>
              ) : (
                <span className="btn-secondary opacity-50">← Previous</span>
              )}
              <span className="text-slate-600">
                Page {page} of {totalPages}
              </span>
              {page < totalPages ? (
                <Link
                  className="btn-secondary"
                  href={`/parts${qs({ ...keepFilters, category: categorySlug, page: `${page + 1}` })}`}
                >
                  Next →
                </Link>
              ) : (
                <span className="btn-secondary opacity-50">Next →</span>
              )}
            </nav>
          )}
        </section>
      </div>
    </div>
  );
}
