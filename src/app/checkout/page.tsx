import Link from "next/link";
import type { Metadata } from "next";
import { getCart } from "@/lib/cart";
import { quoteCart, validateCartForCheckout } from "@/lib/checkout";
import { db } from "@/lib/db";
import { Role, ShipTo } from "@/lib/enums";
import { ApiError } from "@/lib/errors";
import { formatShopTime } from "@/lib/format";
import { requirePageUser } from "@/lib/page-auth";
import {
  CheckoutForm,
  type AppointmentGroupView,
  type CheckoutTotalsView,
  type ShipmentGroupView,
} from "@/components/checkout/CheckoutForm";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Checkout" };

export default async function CheckoutPage() {
  const user = await requirePageUser([Role.CUSTOMER], "/checkout");
  const cart = await getCart();

  if (!cart || cart.items.length === 0) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center sm:px-6">
        <h1 className="text-2xl font-bold text-slate-900">Nothing to check out</h1>
        <p className="mt-2 text-sm text-slate-600">Your cart is empty.</p>
        <Link href="/parts" className="btn-primary mt-6">
          Browse parts
        </Link>
      </div>
    );
  }

  // Validate + price. Any failure (slot taken, out of stock, incomplete
  // install) sends the customer back to the cart to fix it.
  let reviewError: string | null = null;
  let quote: Awaited<ReturnType<typeof quoteCart>> | null = null;
  try {
    await validateCartForCheckout(cart);
    quote = await quoteCart(cart);
  } catch (err) {
    reviewError = err instanceof ApiError ? err.message : "Your cart cannot be priced right now";
  }

  if (!quote) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center sm:px-6">
        <h1 className="text-2xl font-bold text-slate-900">Almost there</h1>
        <p className="mx-auto mt-3 max-w-md rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {reviewError}
        </p>
        <Link href="/cart" className="btn-primary mt-6">
          Back to cart
        </Link>
      </div>
    );
  }

  // Names for the review cards.
  const supplierNameById = new Map(cart.items.map((i) => [i.part.supplierId, i.part.supplier.name]));
  const partNameById = new Map(cart.items.map((i) => [i.partId, i.part.name]));
  const installerIds = Array.from(
    new Set(
      [...quote.lines.map((l) => l.installerId), ...quote.groups.map((g) => g.installerId)].filter(
        (x): x is string => Boolean(x),
      ),
    ),
  );
  const installers = await db.installer.findMany({ where: { id: { in: installerIds } } });
  const installerById = new Map(installers.map((s) => [s.id, s]));

  const groups: ShipmentGroupView[] = quote.groups.map((g) => {
    const shop = g.installerId ? installerById.get(g.installerId) : undefined;
    const groupLines = quote!.lines.filter((l) => l.groupKey === g.key);
    return {
      key: g.key,
      supplierName: supplierNameById.get(g.supplierId) ?? "Supplier",
      destLabel: g.shipTo === ShipTo.INSTALLER ? shop?.name ?? "the shop" : "Your address",
      shippingCents: g.shippingCents,
      items: groupLines.map((l) => ({
        name: partNameById.get(l.partId) ?? "Part",
        qty: l.qty,
        lineTotalCents: l.lineTotalCents,
      })),
    };
  });

  // Appointment cards: one per (shop, slot) — mirrors the PAID fan-out dedupe.
  const apptMap = new Map<string, AppointmentGroupView>();
  for (const line of quote.lines) {
    if (!line.withInstall || !line.installerId || !line.apptStartAt) continue;
    const shop = installerById.get(line.installerId);
    if (!shop) continue;
    const key = `${line.installerId}|${line.apptStartAt.toISOString()}`;
    let entry = apptMap.get(key);
    if (!entry) {
      entry = {
        key,
        shopName: shop.name,
        timeLabel: formatShopTime(line.apptStartAt, shop.tzOffsetMinutes),
        laborTotalCents: 0,
        itemNames: [],
        shipToShop: false,
      };
      apptMap.set(key, entry);
    }
    entry.laborTotalCents += line.installTotalCents;
    entry.itemNames.push(`${partNameById.get(line.partId) ?? "Part"} × ${line.qty}`);
    if (line.shipTo === ShipTo.INSTALLER) entry.shipToShop = true;
  }

  const totals: CheckoutTotalsView = {
    partsSubtotalCents: quote.partsSubtotalCents,
    installSubtotalCents: quote.installSubtotalCents,
    shippingTotalCents: quote.shippingTotalCents,
    taxCents: quote.taxCents,
    totalCents: quote.totalCents,
  };

  const addresses = await db.address.findMany({
    where: { userId: user.id },
    orderBy: [{ isDefault: "desc" }, { label: "asc" }],
  });

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <h1 className="mb-6 text-2xl font-bold text-slate-900">Checkout</h1>
      <CheckoutForm
        addresses={addresses.map((a) => ({
          id: a.id,
          label: a.label,
          line1: a.line1,
          line2: a.line2,
          city: a.city,
          state: a.state,
          zip: a.zip,
          isDefault: a.isDefault,
        }))}
        userName={user.name}
        defaultPhone={user.phone ?? ""}
        groups={groups}
        appointments={Array.from(apptMap.values())}
        totals={totals}
      />
    </div>
  );
}
