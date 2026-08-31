import { api, jsonOk } from "@/lib/api";
import { getCart } from "@/lib/cart";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/errors";
import { fitmentVerdict, type VehicleContext } from "@/lib/fitment";
import { pluralize } from "@/lib/format";
import { installUnitCents, TRANSIT_BUFFER_DAYS } from "@/lib/pricing";

export const dynamic = "force-dynamic";

/**
 * GET /api/parts/[slug] — public part detail.
 * Returns display fields, fitment rows grouped for the table, per-shop install
 * estimates, and the fitment verdict for the current cart vehicle context.
 */
export const GET = api(async (_req, ctx) => {
  const part = await db.part.findUnique({
    where: { slug: ctx.params.slug },
    include: {
      brand: { select: { id: true, name: true, slug: true } },
      category: { select: { id: true, name: true, slug: true } },
      supplier: { select: { id: true, name: true, leadTimeDays: true } },
      fitments: {
        include: {
          model: { include: { make: true } },
          engine: true,
        },
        orderBy: [{ yearFrom: "asc" }],
      },
    },
  });
  if (!part || !part.active) throw new ApiError("NOT_FOUND", "Part not found", 404);

  // Current vehicle context lives on the cart (guest cookie or user cart).
  const cart = await getCart();
  const vehicle: VehicleContext | null =
    cart?.ctxModelId && cart.ctxYear != null
      ? { modelId: cart.ctxModelId, year: cart.ctxYear, engineId: cart.ctxEngineId }
      : null;

  const shops = await db.installer.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
  });
  const arrivalDays = part.supplier.leadTimeDays + TRANSIT_BUFFER_DAYS;
  const installers = part.installEligible
    ? shops.map((s) => ({
        installerId: s.id,
        name: s.name,
        city: s.city,
        state: s.state,
        hourlyRateCents: s.hourlyRateCents,
        estimateCents: installUnitCents(part, s.hourlyRateCents),
        tzOffsetMinutes: s.tzOffsetMinutes,
        leadNote: `Earliest slots ~${arrivalDays} ${pluralize(arrivalDays, "day")} out (parts in transit)`,
      }))
    : [];

  const fitments = part.fitments.map((f) => ({
    id: f.id,
    vehicle: `${f.model.make.name} ${f.model.name}`,
    years: f.yearFrom === f.yearTo ? `${f.yearFrom}` : `${f.yearFrom}–${f.yearTo}`,
    engine: f.engine ? f.engine.name : "All engines",
    notes: f.notes,
  }));

  return jsonOk({
    part: {
      id: part.id,
      sku: part.sku,
      slug: part.slug,
      name: part.name,
      description: part.description,
      imageUrl: part.imageUrl,
      priceCents: part.priceCents,
      weightGrams: part.weightGrams,
      installEligible: part.installEligible,
      laborHoursTenths: part.laborHoursTenths,
      installFixedFeeCents: part.installFixedFeeCents,
      universalFit: part.universalFit,
      inStock: part.inStock,
      brand: part.brand,
      category: part.category,
      supplier: part.supplier,
    },
    fitments,
    installers,
    verdict: fitmentVerdict(part, part.fitments, vehicle),
  });
});
