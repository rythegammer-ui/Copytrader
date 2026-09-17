import Link from "next/link";
import {
  PHOTO_REQUEST_LINE,
  SHOP_PHONE_DISPLAY,
  SHOP_PHONE_TEL,
} from "@/lib/shop-contact";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getCart } from "@/lib/cart";
import { db } from "@/lib/db";
import { fitmentVerdict, type VehicleContext } from "@/lib/fitment";
import { pluralize } from "@/lib/format";
import { conditionLabel } from "@/lib/enums";
import { formatCents } from "@/lib/money";
import { installUnitCents, TRANSIT_BUFFER_DAYS } from "@/lib/pricing";
import { FitmentTable, type FitmentRow } from "@/components/catalog/FitmentTable";
import { InstallWidget, type WidgetShop } from "@/components/catalog/InstallWidget";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const part = await db.part.findUnique({ where: { slug: params.slug }, select: { name: true } });
  return { title: part?.name ?? "Part" };
}

async function resolveVehicle(): Promise<{ ctx: VehicleContext | null; label: string | null }> {
  const cart = await getCart();
  if (!cart?.ctxModelId || cart.ctxYear == null) return { ctx: null, label: null };
  const model = await db.vehicleModel.findUnique({
    where: { id: cart.ctxModelId },
    include: { make: true },
  });
  if (!model) return { ctx: null, label: null };
  const engine = cart.ctxEngineId
    ? await db.engine.findUnique({ where: { id: cart.ctxEngineId } })
    : null;
  return {
    ctx: { modelId: model.id, year: cart.ctxYear, engineId: engine?.id ?? null },
    label: `${cart.ctxYear} ${model.make.name} ${model.name}${engine ? ` ${engine.name}` : ""}`,
  };
}

export default async function PartDetailPage({ params }: { params: { slug: string } }) {
  const part = await db.part.findUnique({
    where: { slug: params.slug },
    include: {
      brand: true,
      category: true,
      supplier: true,
      fitments: {
        include: { model: { include: { make: true } }, engine: true },
        orderBy: [{ yearFrom: "asc" }],
      },
      // A kit is priced and sold as one item, but the buyer deserves to see
      // exactly which pieces they are getting.
      components: {
        include: { component: { select: { name: true, slug: true, active: true } } },
      },
    },
  });
  if (!part || !part.active) notFound();

  const { ctx, label } = await resolveVehicle();
  const verdict = fitmentVerdict(part, part.fitments, ctx);

  const shops = await db.installer.findMany({ where: { active: true }, orderBy: { name: "asc" } });
  const arrivalDays = part.supplier.leadTimeDays + TRANSIT_BUFFER_DAYS;
  const widgetShops: WidgetShop[] = part.installEligible
    ? shops.map((s) => ({
        installerId: s.id,
        name: s.name,
        city: s.city,
        state: s.state,
        hourlyRateCents: s.hourlyRateCents,
        estimateCents: installUnitCents(part, s.hourlyRateCents),
        tzOffsetMinutes: s.tzOffsetMinutes,
        leadNote: `earliest slots ~${arrivalDays} ${pluralize(arrivalDays, "day")} out`,
      }))
    : [];

  const fitmentRows: FitmentRow[] = part.fitments.map((f) => ({
    id: f.id,
    vehicle: `${f.model.make.name} ${f.model.name}`,
    years: f.yearFrom === f.yearTo ? `${f.yearFrom}` : `${f.yearFrom}–${f.yearTo}`,
    engine: f.engine ? f.engine.name : "All engines",
    notes: f.notes,
  }));

  const laborHours = (part.laborHoursTenths / 10).toFixed(1);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <nav className="mb-4 text-sm text-slate-500">
        <Link href="/parts" className="hover:text-brand-700">
          All parts
        </Link>
        {" / "}
        <Link href={`/categories/${part.category.slug}`} className="hover:text-brand-700">
          {part.category.name}
        </Link>
        {" / "}
        <span className="font-medium text-slate-900">{part.name}</span>
      </nav>

      {/* Fitment verdict banner for the current vehicle */}
      {verdict === "NO_FIT" && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">
          ✕ This part doesn&apos;t fit your {label}. Check the fitment table below before buying.
        </div>
      )}
      {verdict === "FITS" && (
        <div className="mb-6 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm font-medium text-green-800">
          ✓ Fits your {label}.
        </div>
      )}
      {verdict === "UNIVERSAL" && (
        <div className="mb-6 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm font-medium text-green-800">
          ✓ Universal fit — works with your {label} and every other vehicle.
        </div>
      )}
      {verdict === "VERIFY_ENGINE" && (
        <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
          ⚠ Fits your {label}, but only for specific engines — verify your engine below.
        </div>
      )}

      <div className="grid gap-8 lg:grid-cols-[1fr_380px]">
        <div className="space-y-8">
          <div className="grid gap-6 sm:grid-cols-2">
            <div className="card overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={part.imageUrl} alt={part.name} className="aspect-square w-full object-cover" />
            </div>
            <div>
              <p className="text-sm font-medium uppercase tracking-wide text-slate-500">
                {part.brand.name}
              </p>
              <h1 className="mt-1 text-2xl font-bold text-slate-900">{part.name}</h1>
              <p className="mt-1 text-xs text-slate-500">SKU {part.sku}</p>

              <p className="mt-4 text-3xl font-extrabold text-slate-900">
                {formatCents(part.priceCents)}
              </p>

              <div className="mt-3 flex flex-wrap gap-2">
                <span
                  className={`badge ${
                    part.condition === "USED"
                      ? "bg-amber-100 text-amber-800"
                      : "bg-slate-100 text-slate-700"
                  }`}
                >
                  {conditionLabel(part.condition)}
                </span>
                {part.inStock ? (
                  <span className="badge bg-green-100 text-green-800">
                    {part.trackStock
                      ? part.stockQty === 1
                        ? "1 available"
                        : `${part.stockQty} available`
                      : "In stock"}
                  </span>
                ) : (
                  <span className="badge bg-red-100 text-red-800">
                    {part.trackStock ? "Sold" : "Out of stock"}
                  </span>
                )}
                {part.localPickupOnly && (
                  <span className="badge bg-slate-900 text-white">📍 Local pickup only</span>
                )}
                {part.acceptsOffers && (
                  <span className="badge bg-brand-100 text-brand-800">Open to offers</span>
                )}
                {part.universalFit && (
                  <span className="badge bg-brand-100 text-brand-800">Universal fit</span>
                )}
                {part.installEligible && shops.length > 0 && (
                  <span className="badge bg-brand-100 text-brand-800">
                    🔧 Installation available · ~{laborHours}h labor
                  </span>
                )}
              </div>

              <p className="mt-4 text-sm text-slate-600">
                {part.localPickupOnly ? (
                  <>
                    Collect at <span className="font-semibold">{part.supplier.name}</span> in{" "}
                    {part.supplier.city}, {part.supplier.state} — too big to ship, so there is no
                    shipping charge.
                  </>
                ) : (
                  <>
                    Ships from <span className="font-semibold">{part.supplier.name}</span> — usually{" "}
                    {part.supplier.leadTimeDays} {pluralize(part.supplier.leadTimeDays, "day")}.
                  </>
                )}
              </p>
            </div>
          </div>

          <section>
            <h2 className="mb-2 text-lg font-bold text-slate-900">Description</h2>
            <p className="whitespace-pre-line text-sm leading-relaxed text-slate-700">
              {part.description}
            </p>
          </section>

          {/* Used parts sell on photographs. The catalog carries placeholder
              images, so make the ask impossible to miss. */}
          <section className="rounded-lg border border-brand-200 bg-brand-50 px-4 py-3">
            <p className="text-sm text-slate-800">
              📷 {PHOTO_REQUEST_LINE}{" "}
              <a
                href={`tel:${SHOP_PHONE_TEL}`}
                className="font-semibold text-brand-800 underline underline-offset-2"
              >
                {SHOP_PHONE_DISPLAY}
              </a>
            </p>
          </section>

          {part.isKit && part.components.length > 0 ? (
            <section>
              <h2 className="mb-2 text-lg font-bold text-slate-900">
                What&rsquo;s in this package ({part.components.length} pieces)
              </h2>
              <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
                {part.components.map((c) => (
                  <li key={c.id} className="px-4 py-2 text-sm text-slate-700">
                    {c.component.active ? (
                      <Link
                        href={`/parts/${c.component.slug}`}
                        className="text-slate-900 underline-offset-2 hover:underline"
                      >
                        {c.component.name}
                      </Link>
                    ) : (
                      c.component.name
                    )}
                    {c.qty > 1 ? <span className="text-slate-500"> &times;{c.qty}</span> : null}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-slate-500">
                Priced as one package. These pieces are also sold separately, so the package sells
                only while every piece is still on the shelf.
              </p>
            </section>
          ) : null}

          <section>
            <h2 className="mb-2 text-lg font-bold text-slate-900">Fitment</h2>
            <FitmentTable rows={fitmentRows} universalFit={part.universalFit} />
          </section>
        </div>

        <div>
          <InstallWidget
            partId={part.id}
            priceCents={part.priceCents}
            installEligible={part.installEligible}
            inStock={part.inStock}
            availableQty={part.trackStock ? part.stockQty : null}
            laborHoursTenths={part.laborHoursTenths}
            supplierLeadDays={part.supplier.leadTimeDays}
            shops={widgetShops}
          />
        </div>
      </div>
    </div>
  );
}
