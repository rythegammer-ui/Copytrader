import { api, jsonOk } from "@/lib/api";
import { getCart } from "@/lib/cart";
import { quoteCart, validateCartForCheckout } from "@/lib/checkout";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/errors";
import { fitmentVerdict, type VehicleContext } from "@/lib/fitment";
import { installUnitCents } from "@/lib/pricing";

export const dynamic = "force-dynamic";

/**
 * GET /api/cart — public (guest cookie carts included).
 * Returns the current cart (items enriched with installer names, install
 * estimates, and fitment verdicts against the cart's vehicle context) plus a
 * priced quote. When the cart cannot be priced/validated (e.g. a slot filled
 * up, a part went out of stock) the quote is null and quoteError explains why.
 */
export const GET = api(async () => {
  const cart = await getCart();
  if (!cart) return jsonOk({ cart: null, quote: null, quoteError: null });

  // Vehicle fitment context + label.
  let vehicle: { modelId: string; year: number; engineId: string | null; label: string } | null =
    null;
  let ctx: VehicleContext | null = null;
  if (cart.ctxModelId && cart.ctxYear != null) {
    const model = await db.vehicleModel.findUnique({
      where: { id: cart.ctxModelId },
      include: { make: true },
    });
    const engine = cart.ctxEngineId
      ? await db.engine.findUnique({ where: { id: cart.ctxEngineId } })
      : null;
    if (model) {
      ctx = { modelId: model.id, year: cart.ctxYear, engineId: engine?.id ?? null };
      vehicle = {
        modelId: model.id,
        year: cart.ctxYear,
        engineId: engine?.id ?? null,
        label: `${cart.ctxYear} ${model.make.name} ${model.name}${engine ? ` ${engine.name}` : ""}`,
      };
    }
  }

  // Resolve installer names + rates in one query.
  const installerIds = Array.from(
    new Set(cart.items.map((i) => i.installerId).filter((x): x is string => Boolean(x))),
  );
  const installers = await db.installer.findMany({ where: { id: { in: installerIds } } });
  const installerById = new Map(installers.map((s) => [s.id, s]));

  // Fitment rows for all parts in one query.
  const partIds = Array.from(new Set(cart.items.map((i) => i.partId)));
  const fitments = await db.fitment.findMany({ where: { partId: { in: partIds } } });
  const fitmentsByPart = new Map<string, typeof fitments>();
  for (const f of fitments) {
    const list = fitmentsByPart.get(f.partId) ?? [];
    list.push(f);
    fitmentsByPart.set(f.partId, list);
  }

  const items = cart.items.map((item) => {
    const shop = item.installerId ? installerById.get(item.installerId) : undefined;
    const estimate =
      item.withInstall && shop ? installUnitCents(item.part, shop.hourlyRateCents) * item.qty : null;
    return {
      id: item.id,
      partId: item.partId,
      slug: item.part.slug,
      name: item.part.name,
      imageUrl: item.part.imageUrl,
      priceCents: item.part.priceCents,
      qty: item.qty,
      withInstall: item.withInstall,
      installerId: item.installerId,
      installerName: shop?.name ?? null,
      installerTzOffsetMinutes: shop?.tzOffsetMinutes ?? null,
      apptStartAt: item.apptStartAt ? item.apptStartAt.toISOString() : null,
      shipTo: item.shipTo,
      installEstimateCents: estimate,
      verdict: fitmentVerdict(item.part, fitmentsByPart.get(item.partId) ?? [], ctx),
    };
  });

  let quote: Awaited<ReturnType<typeof quoteCart>> | null = null;
  let quoteError: string | null = null;
  if (cart.items.length > 0) {
    try {
      await validateCartForCheckout(cart);
      quote = await quoteCart(cart);
    } catch (err) {
      quote = null;
      quoteError = err instanceof ApiError ? err.message : "Your cart cannot be priced right now";
    }
  }

  return jsonOk({ cart: { id: cart.id, vehicle, items }, quote, quoteError });
});
