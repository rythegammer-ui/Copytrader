import Link from "next/link";
import { getCart } from "@/lib/cart";
import { db } from "@/lib/db";
import { compatibleWhere, fitmentVerdict, type VehicleContext } from "@/lib/fitment";
import { installUnitCents } from "@/lib/pricing";
import { PartCard, type PartCardData } from "@/components/catalog/PartCard";
import { VehiclePicker, type CurrentVehicle } from "@/components/catalog/VehiclePicker";

export const dynamic = "force-dynamic";

const PLACEHOLDER_SLUGS = new Set([
  "brakes",
  "engine",
  "suspension",
  "electrical",
  "filters",
  "exhaust",
  "cooling",
  "lighting",
  "ignition",
  "accessories",
  "wipers",
]);

function placeholderFor(slug: string): string {
  return `/images/placeholders/${PLACEHOLDER_SLUGS.has(slug) ? slug : "part"}.svg`;
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

export default async function HomePage() {
  const { ctx, current } = await resolveVehicle();

  const [categories, installers, featured] = await Promise.all([
    db.category.findMany({ where: { parentId: null }, orderBy: { name: "asc" } }),
    db.installer.findMany({ where: { active: true }, select: { hourlyRateCents: true } }),
    db.part.findMany({
      where: { AND: [{ active: true }, ...(ctx ? [compatibleWhere(ctx)] : [])] },
      orderBy: { createdAt: "desc" },
      take: 8,
      include: { brand: { select: { name: true } }, fitments: true },
    }),
  ]);

  const cards: PartCardData[] = featured.map((part) => ({
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

  return (
    <div>
      {/* Hero */}
      <section className="bg-gradient-to-b from-brand-950 to-brand-800 text-white">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
          <h1 className="max-w-2xl text-4xl font-extrabold tracking-tight sm:text-5xl">
            Parts that fit. Installed for you.
          </h1>
          <p className="mt-4 max-w-xl text-lg text-brand-100">
            Order car parts matched to your exact vehicle, dropshipped from trusted suppliers, and
            book a professional install — all in one checkout.
          </p>
          <div className="mt-6 flex gap-3">
            <Link
              href="/parts"
              className="inline-flex items-center justify-center rounded-lg bg-white px-5 py-2.5 text-sm font-semibold text-brand-800 shadow-sm transition hover:bg-brand-50"
            >
              Shop parts
            </Link>
            <Link
              href="/parts?install=1"
              className="inline-flex items-center justify-center rounded-lg border border-brand-300 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700"
            >
              Parts + install
            </Link>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-7xl space-y-14 px-4 py-10 sm:px-6">
        {/* Vehicle picker */}
        <section className="card -mt-20 p-6 shadow-lg">
          <h2 className="text-lg font-bold text-slate-900">
            {current ? "Your vehicle" : "Find parts for your vehicle"}
          </h2>
          <p className="mb-4 text-sm text-slate-500">
            {current
              ? "We're filtering the catalog to parts that fit."
              : "Pick your make, model, and year — we'll hide everything that doesn't fit."}
          </p>
          <VehiclePicker current={current} />
        </section>

        {/* Category grid */}
        <section>
          <div className="mb-4 flex items-end justify-between">
            <h2 className="text-2xl font-bold text-slate-900">Shop by category</h2>
            <Link href="/parts" className="text-sm font-medium text-brand-700 hover:underline">
              View all parts →
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {categories.map((cat) => (
              <Link
                key={cat.id}
                href={`/categories/${cat.slug}`}
                className="card group flex flex-col items-center gap-2 p-4 text-center transition hover:shadow-md"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={placeholderFor(cat.slug)}
                  alt={cat.name}
                  className="h-20 w-20 object-contain transition group-hover:scale-105"
                />
                <span className="text-sm font-semibold text-slate-800 group-hover:text-brand-700">
                  {cat.name}
                </span>
              </Link>
            ))}
          </div>
        </section>

        {/* How it works */}
        <section className="card p-8">
          <h2 className="mb-6 text-2xl font-bold text-slate-900">How it works</h2>
          <div className="grid gap-6 sm:grid-cols-3">
            <div>
              <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-brand-100 text-lg font-bold text-brand-700">
                1
              </div>
              <h3 className="font-semibold text-slate-900">Pick parts</h3>
              <p className="mt-1 text-sm text-slate-600">
                Tell us your vehicle and browse only the parts that fit — no guesswork.
              </p>
            </div>
            <div>
              <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-brand-100 text-lg font-bold text-brand-700">
                2
              </div>
              <h3 className="font-semibold text-slate-900">We dropship from suppliers</h3>
              <p className="mt-1 text-sm text-slate-600">
                Orders fan out to our suppliers automatically — to your door, or straight to the
                shop.
              </p>
            </div>
            <div>
              <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-brand-100 text-lg font-bold text-brand-700">
                3
              </div>
              <h3 className="font-semibold text-slate-900">Book install &amp; pay once</h3>
              <p className="mt-1 text-sm text-slate-600">
                Reserve a bay at a local shop and pay parts, shipping, and labor in one checkout.
              </p>
            </div>
          </div>
        </section>

        {/* Featured parts */}
        <section>
          <div className="mb-4 flex items-end justify-between">
            <h2 className="text-2xl font-bold text-slate-900">
              {ctx ? "Popular parts for your vehicle" : "New arrivals"}
            </h2>
            <Link href="/parts" className="text-sm font-medium text-brand-700 hover:underline">
              Browse the catalog →
            </Link>
          </div>
          {cards.length === 0 ? (
            <p className="text-sm text-slate-500">No matching parts yet — check back soon.</p>
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {cards.map((card) => (
                <PartCard key={card.id} part={card} />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
