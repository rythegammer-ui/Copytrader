import { api, jsonOk } from "@/lib/api";
import { getCart } from "@/lib/cart";
import { quoteCart, validateCartForCheckout } from "@/lib/checkout";
import { db } from "@/lib/db";
import { Role } from "@/lib/enums";
import { ApiError } from "@/lib/errors";

export const dynamic = "force-dynamic";

/**
 * POST /api/checkout/quote — CUSTOMER.
 * Validates the current cart (stock, install completeness, slot capacity and
 * feasibility) and returns the full checkout price breakdown. Validation
 * failures surface as their ApiError status (409 SLOT_TAKEN etc.) via the
 * api() wrapper.
 */
export const POST = api(
  async (_req, _ctx, user) => {
    void user; // getCart() scopes to the signed-in user's cart
    const cart = await getCart();
    if (!cart || cart.items.length === 0) {
      throw new ApiError("EMPTY_CART", "Your cart is empty", 400);
    }

    await validateCartForCheckout(cart);
    const quote = await quoteCart(cart);

    const partNameById = new Map(cart.items.map((i) => [i.partId, i.part.name]));
    const supplierNameById = new Map(cart.items.map((i) => [i.part.supplierId, i.part.supplier.name]));

    const installerIds = Array.from(
      new Set(
        [...quote.lines.map((l) => l.installerId), ...quote.groups.map((g) => g.installerId)].filter(
          (x): x is string => Boolean(x),
        ),
      ),
    );
    const installers = await db.installer.findMany({ where: { id: { in: installerIds } } });
    const installerById = new Map(installers.map((s) => [s.id, s]));

    return jsonOk({
      lines: quote.lines.map((l) => {
        const shop = l.installerId ? installerById.get(l.installerId) : undefined;
        return {
          cartItemId: l.cartItemId ?? null,
          name: partNameById.get(l.partId) ?? "Part",
          qty: l.qty,
          unitPriceCents: l.unitPriceCents,
          lineTotalCents: l.lineTotalCents,
          withInstall: l.withInstall,
          installTotalCents: l.installTotalCents,
          shipTo: l.shipTo,
          shopName: shop?.name ?? null,
          shopTzOffsetMinutes: shop?.tzOffsetMinutes ?? null,
          apptStartAt: l.apptStartAt ? l.apptStartAt.toISOString() : null,
        };
      }),
      groups: quote.groups.map((g) => {
        const shop = g.installerId ? installerById.get(g.installerId) : undefined;
        return {
          key: g.key,
          supplierName: supplierNameById.get(g.supplierId) ?? "Supplier",
          shipTo: g.shipTo,
          installerName: shop?.name ?? null,
          qty: g.qty,
          partsCents: g.partsCents,
          shippingCents: g.shippingCents,
          free: g.shippingCents === 0,
        };
      }),
      partsSubtotalCents: quote.partsSubtotalCents,
      installSubtotalCents: quote.installSubtotalCents,
      shippingTotalCents: quote.shippingTotalCents,
      taxCents: quote.taxCents,
      totalCents: quote.totalCents,
    });
  },
  { roles: [Role.CUSTOMER] },
);
