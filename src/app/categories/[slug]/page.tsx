import Link from "next/link";
import { notFound } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { getCart } from "@/lib/cart";
import { db } from "@/lib/db";
import { compatibleWhere, fitmentVerdict, type VehicleContext } from "@/lib/fitment";
import { installUnitCents } from "@/lib/pricing";
import { PartCard, type PartCardData } from "@/components/catalog/PartCard";
import { VehiclePicker, type CurrentVehicle } from "@/components/catalog/VehiclePicker";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 24;

type SearchParams = Record<string, string | string[] | undefined>;

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
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

export default async function CategoryPage({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams: SearchParams;
}) {
  const category = await db.category.findUnique({
    where: { slug: params.slug },
    include: { children: { orderBy: { name: "asc" } }, parent: true },
  });
  if (!category) notFound();

  const sort = first(searchParams.sort) || undefined;
  const page = Math.max(1, parseInt(first(searchParams.page) ?? "1", 10) || 1);

  const { ctx, current } = await resolveVehicle();

  const and: Prisma.PartWhereInput[] = [
    { active: true },
    { category: { OR: [{ slug: category.slug }, { parent: { slug: category.slug } }] } },
  ];
  if (ctx) and.push(compatibleWhere(ctx));
  const where: Prisma.PartWhereInput = { AND: and };

  const orderBy: Prisma.PartOrderByWithRelationInput[] =
    sort === "price_asc"
      ? [{ priceCents: "asc" }, { name: "asc" }]
      : sort === "price_desc"
        ? [{ priceCents: "desc" }, { name: "asc" }]
        : [{ name: "asc" }];

  const [total, parts, installers] = await Promise.all([
    db.part.count({ where }),
    db.part.findMany({
      where,
      orderBy,
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { brand: { select: { name: true } }, fitments: true },
    }),
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

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <nav className="mb-4 text-sm text-slate-500">
        <Link href="/parts" className="hover:text-brand-700">
          All parts
        </Link>
        {category.parent && (
          <>
            {" / "}
            <Link href={`/categories/${category.parent.slug}`} className="hover:text-brand-700">
              {category.parent.name}
            </Link>
          </>
        )}
        {" / "}
        <span className="font-medium text-slate-900">{category.name}</span>
      </nav>

      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">{category.name}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {total} {total === 1 ? "part" : "parts"}
            {current ? ` for ${current.label}` : ""}
          </p>
        </div>
        <form method="GET" action={`/categories/${category.slug}`} className="flex items-center gap-2 text-sm">
          <label htmlFor="cat-sort" className="text-slate-500">
            Sort
          </label>
          <select id="cat-sort" name="sort" defaultValue={sort ?? ""} className="input w-auto">
            <option value="">Name (A–Z)</option>
            <option value="price_asc">Price: low to high</option>
            <option value="price_desc">Price: high to low</option>
          </select>
          <button type="submit" className="btn-secondary">
            Go
          </button>
        </form>
      </div>

      {category.children.length > 0 && (
        <div className="mb-6 flex flex-wrap gap-2">
          {category.children.map((child) => (
            <Link
              key={child.id}
              href={`/categories/${child.slug}`}
              className="badge bg-slate-100 text-slate-800 hover:bg-brand-100 hover:text-brand-800"
            >
              {child.name}
            </Link>
          ))}
        </div>
      )}

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

      {cards.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="font-semibold text-slate-900">No parts in this category yet.</p>
          <p className="mt-1 text-sm text-slate-500">
            {ctx ? "Try clearing your vehicle filter." : "Check back soon."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
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
              href={`/categories/${category.slug}?${new URLSearchParams({
                ...(sort ? { sort } : {}),
                page: `${page - 1}`,
              }).toString()}`}
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
              href={`/categories/${category.slug}?${new URLSearchParams({
                ...(sort ? { sort } : {}),
                page: `${page + 1}`,
              }).toString()}`}
            >
              Next →
            </Link>
          ) : (
            <span className="btn-secondary opacity-50">Next →</span>
          )}
        </nav>
      )}
    </div>
  );
}
