import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getCart } from "@/lib/cart";
import { db } from "@/lib/db";
import { fitmentVerdict, type VehicleContext } from "@/lib/fitment";
import { pluralize } from "@/lib/format";
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
                {part.inStock ? (
                  <span className="badge bg-green-100 text-green-800">In stock</span>
                ) : (
                  <span className="badge bg-red-100 text-red-800">Out of stock</span>
                )}
                {part.universalFit && (
                  <span className="badge bg-brand-100 text-brand-800">Universal fit</span>
                )}
                {part.installEligible && (
                  <span className="badge bg-brand-100 text-brand-800">
                    🔧 Installation available · ~{laborHours}h labor
                  </span>
                )}
              </div>

              <p className="mt-4 text-sm text-slate-600">
                Ships from <span className="font-semibold">{part.supplier.name}</span> — usually{" "}
                {part.supplier.leadTimeDays} {pluralize(part.supplier.leadTimeDays, "day")}.
              </p>
            </div>
          </div>

          <section>
            <h2 className="mb-2 text-lg font-bold text-slate-900">Description</h2>
            <p className="whitespace-pre-line text-sm leading-relaxed text-slate-700">
              {part.description}
            </p>
          </section>

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
            laborHoursTenths={part.laborHoursTenths}
            supplierLeadDays={part.supplier.leadTimeDays}
            shops={widgetShops}
          />
        </div>
      </div>
    </div>
  );
}
