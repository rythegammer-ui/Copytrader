import { z } from "zod";
import { api, jsonOk, parseBody } from "@/lib/api";
import { getCart } from "@/lib/cart";
import { db } from "@/lib/db";
import { ShipTo, zShipTo } from "@/lib/enums";
import { ApiError } from "@/lib/errors";

export const dynamic = "force-dynamic";

const zPatchItem = z.object({
  qty: z.number().int().min(1).max(10).optional(),
  withInstall: z.boolean().optional(),
  installerId: z.string().min(1).nullable().optional(),
  apptStartAt: z.string().datetime({ offset: true }).nullable().optional(),
  shipTo: zShipTo.optional(),
});

/** The cart item must belong to the CURRENT cart (cookie/user) — 404 otherwise. */
async function findOwnItem(itemId: string) {
  const cart = await getCart();
  const item = cart?.items.find((i) => i.id === itemId);
  if (!cart || !item) throw new ApiError("NOT_FOUND", "Cart item not found", 404);
  return item;
}

/**
 * PATCH /api/cart/items/[id] — public (guest cookie carts included).
 * Updates qty and/or install configuration with the same rules as add:
 * withInstall requires an eligible part + shop + slot; shipTo INSTALLER
 * requires withInstall; clearing withInstall resets shipTo to HOME and
 * nulls installerId/apptStartAt.
 */
export const PATCH = api(async (req, ctx) => {
  const body = await parseBody(req, zPatchItem);
  const item = await findOwnItem(ctx.params.id);

  const withInstall = body.withInstall ?? item.withInstall;
  let installerId: string | null =
    body.installerId !== undefined ? body.installerId : item.installerId;
  let apptStartAt: Date | null =
    body.apptStartAt !== undefined
      ? body.apptStartAt
        ? new Date(body.apptStartAt)
        : null
      : item.apptStartAt;
  let shipTo: string = body.shipTo ?? item.shipTo;

  if (withInstall) {
    if (!item.part.installEligible) {
      throw new ApiError(
        "NOT_INSTALLABLE",
        `${item.part.name} is not eligible for installation`,
        409,
      );
    }
    // Shop required; slot may still be chosen later (checkout enforces it).
    if (!installerId) {
      throw new ApiError("INSTALL_INCOMPLETE", "Pick a shop for the installation", 400);
    }
    const shop = await db.installer.findUnique({ where: { id: installerId } });
    if (!shop || !shop.active) {
      throw new ApiError("SHOP_UNAVAILABLE", "That installer shop is not available", 409);
    }
  } else {
    if (body.shipTo === ShipTo.INSTALLER) {
      throw new ApiError("SHIP_TO_SHOP_NEEDS_INSTALL", "Ship-to-shop requires installation", 400);
    }
    installerId = null;
    apptStartAt = null;
    shipTo = ShipTo.HOME;
  }

  const updated = await db.cartItem.update({
    where: { id: item.id },
    data: {
      qty: body.qty ?? item.qty,
      withInstall,
      installerId,
      apptStartAt,
      shipTo,
    },
  });
  return jsonOk({ item: updated });
});

/** DELETE /api/cart/items/[id] — remove a line from the current cart. */
export const DELETE = api(async (_req, ctx) => {
  const item = await findOwnItem(ctx.params.id);
  await db.cartItem.delete({ where: { id: item.id } });
  return jsonOk({ ok: true });
});
