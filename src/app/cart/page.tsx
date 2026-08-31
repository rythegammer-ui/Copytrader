import Link from "next/link";
import type { Metadata } from "next";
import { getCart } from "@/lib/cart";
import { quoteCart, validateCartForCheckout } from "@/lib/checkout";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/errors";
import { fitmentVerdict, type VehicleContext } from "@/lib/fitment";
import { pluralize } from "@/lib/format";
import { installUnitCents } from "@/lib/pricing";
import { getCurrentUser } from "@/lib/session";
import {
  CartView,
  type CartLineView,
  type CartTotalsView,
} from "@/components/checkout/CartView";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Cart" };

export default async function CartPage() {
  const user = await getCurrentUser();
  const cart = await getCart();

  if (!cart || cart.items.length === 0) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center sm:px-6">
        <p className="text-5xl" aria-hidden>
          🛒
        </p>
        <h1 className="mt-4 text-2xl font-bold text-slate-900">Your cart is empty</h1>
        <p className="mt-2 text-sm text-slate-600">
          Pick your vehicle, find parts that fit, and add professional installation if you want it.
        </p>
        <Link href="/parts" className="btn-primary mt-6">
          Browse parts
        </Link>
      </div>
    );
  }

  // Vehicle context + label for fitment warnings.
  let ctx: VehicleContext | null = null;
  let vehicleLabel: string | null = null;
  if (cart.ctxModelId && cart.ctxYear != null) {
    const model = await db.vehicleModel.findUnique({
      where: { id: cart.ctxModelId },
      include: { make: true },
    });
    if (model) {
      ctx = { modelId: model.id, year: cart.ctxYear, engineId: cart.ctxEngineId };
      vehicleLabel = `${cart.ctxYear} ${model.make.name} ${model.name}`;
    }
  }

  // Installer names/rates (one query) + fitment rows (one query).
  const installerIds = Array.from(
    new Set(cart.items.map((i) => i.installerId).filter((x): x is string => Boolean(x))),
  );
  const installers = await db.installer.findMany({ where: { id: { in: installerIds } } });
  const installerById = new Map(installers.map((s) => [s.id, s]));

  const partIds = Array.from(new Set(cart.items.map((i) => i.partId)));
  const fitments = await db.fitment.findMany({ where: { partId: { in: partIds } } });
  const fitmentsByPart = new Map<string, typeof fitments>();
  for (const f of fitments) {
    const list = fitmentsByPart.get(f.partId) ?? [];
    list.push(f);
    fitmentsByPart.set(f.partId, list);
  }

  const lines: CartLineView[] = cart.items.map((item) => {
    const shop = item.installerId ? installerById.get(item.installerId) : undefined;
    const installTotal =
      item.withInstall && shop ? installUnitCents(item.part, shop.hourlyRateCents) * item.qty : 0;
    return {
      id: item.id,
      slug: item.part.slug,
      name: item.part.name,
      imageUrl: item.part.imageUrl,
      priceCents: item.part.priceCents,
      qty: item.qty,
      lineTotalCents: item.part.priceCents * item.qty,
      withInstall: item.withInstall,
      installEligible: item.part.installEligible,
      installerName: shop?.name ?? null,
      tzOffsetMinutes: shop?.tzOffsetMinutes ?? null,
      apptStartAt: item.apptStartAt ? item.apptStartAt.toISOString() : null,
      shipTo: item.shipTo,
      installTotalCents: installTotal,
      verdict: fitmentVerdict(item.part, fitmentsByPart.get(item.partId) ?? [], ctx),
    };
  });

  // Priced quote (may fail validation — e.g. a slot filled up meanwhile).
  let totals: CartTotalsView | null = null;
  let quoteError: string | null = null;
  try {
    await validateCartForCheckout(cart);
    const quote = await quoteCart(cart);
    const supplierNameById = new Map(
      cart.items.map((i) => [i.part.supplierId, i.part.supplier.name]),
    );
    totals = {
      partsSubtotalCents: quote.partsSubtotalCents,
      installSubtotalCents: quote.installSubtotalCents,
      groups: quote.groups.map((g) => {
        const shop = g.installerId ? installerById.get(g.installerId) : undefined;
        return {
          key: g.key,
          supplierName: supplierNameById.get(g.supplierId) ?? "Supplier",
          shipTo: g.shipTo,
          installerName: shop?.name ?? null,
          shippingCents: g.shippingCents,
        };
      }),
      shippingTotalCents: quote.shippingTotalCents,
      taxCents: quote.taxCents,
      totalCents: quote.totalCents,
    };
  } catch (err) {
    quoteError =
      err instanceof ApiError ? err.message : "Your cart cannot be priced right now";
  }

  // "One shop & time" helper inputs: combined labor + worst-case lead time.
  const eligible = cart.items.filter((i) => i.part.installEligible);
  const installHelper = {
    eligibleCount: eligible.length,
    totalLaborTenths: eligible.reduce((s, i) => s + i.part.laborHoursTenths * i.qty, 0),
    maxLeadDays: eligible.reduce((m, i) => Math.max(m, i.part.supplier.leadTimeDays), 0),
  };

  const itemCount = cart.items.reduce((s, i) => s + i.qty, 0);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <h1 className="mb-6 text-2xl font-bold text-slate-900">
        Your cart{" "}
        <span className="text-base font-normal text-slate-500">
          ({itemCount} {pluralize(itemCount, "item")})
        </span>
      </h1>
      <CartView
        lines={lines}
        vehicleLabel={vehicleLabel}
        totals={totals}
        quoteError={quoteError}
        signedIn={Boolean(user)}
        installHelper={installHelper}
      />
    </div>
  );
}
