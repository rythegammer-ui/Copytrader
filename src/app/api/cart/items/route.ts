import { z } from "zod";
import { api, jsonOk, parseBody } from "@/lib/api";
import { getOrCreateCart } from "@/lib/cart";
import { db } from "@/lib/db";
import { ShipTo, zShipTo } from "@/lib/enums";
import { ApiError } from "@/lib/errors";
import { fitmentVerdict } from "@/lib/fitment";

export const dynamic = "force-dynamic";

const zAddItem = z.object({
  partId: z.string().min(1),
  qty: z.number().int().min(1).max(10),
  withInstall: z.boolean().optional().default(false),
  installerId: z.string().min(1).optional(),
  apptStartAt: z.string().datetime({ offset: true }).optional(),
  shipTo: zShipTo.optional(),
  force: z.boolean().optional().default(false),
});

/**
 * POST /api/cart/items — public (guest cookie carts included).
 * Adds a part to the cart. Rows are unique per (cart, part): re-adding the
 * same part combines quantities (capped at 10) and REPLACES the install
 * configuration with the newly submitted one.
 */
export const POST = api(async (req) => {
  const body = await parseBody(req, zAddItem);

  const part = await db.part.findUnique({
    where: { id: body.partId },
    include: { fitments: true },
  });
  if (!part || !part.active) {
    throw new ApiError("PART_UNAVAILABLE", "That part is no longer available", 409);
  }
  if (!part.inStock) {
    throw new ApiError("OUT_OF_STOCK", `${part.name} is out of stock at the supplier`, 409);
  }

  const cart = await getOrCreateCart();

  // Fitment gate against the cart's vehicle context (force=true overrides).
  if (cart.ctxModelId && cart.ctxYear != null && !body.force) {
    const verdict = fitmentVerdict(part, part.fitments, {
      modelId: cart.ctxModelId,
      year: cart.ctxYear,
      engineId: cart.ctxEngineId,
    });
    if (verdict === "NO_FIT") {
      throw new ApiError(
        "INCOMPATIBLE",
        `${part.name} may not fit your selected vehicle`,
        409,
        { partId: part.id },
      );
    }
  }

  // Resolve the install configuration for this line.
  let installerId: string | null = null;
  let apptStartAt: Date | null = null;
  let shipTo: string = ShipTo.HOME;
  const withInstall = body.withInstall;
  if (withInstall) {
    if (!part.installEligible) {
      throw new ApiError("NOT_INSTALLABLE", `${part.name} is not eligible for installation`, 409);
    }
    // The shop is required (it prices the labor); the slot may be picked later
    // in the cart — checkout blocks INSTALL_INCOMPLETE until one is chosen.
    if (!body.installerId) {
      throw new ApiError("INSTALL_INCOMPLETE", "Pick a shop for the installation", 400);
    }
    const shop = await db.installer.findUnique({ where: { id: body.installerId } });
    if (!shop || !shop.active) {
      throw new ApiError("SHOP_UNAVAILABLE", "That installer shop is not available", 409);
    }
    installerId = shop.id;
    apptStartAt = body.apptStartAt ? new Date(body.apptStartAt) : null;
    shipTo = body.shipTo ?? ShipTo.INSTALLER;
  } else if (body.shipTo === ShipTo.INSTALLER) {
    throw new ApiError("SHIP_TO_SHOP_NEEDS_INSTALL", "Ship-to-shop requires installation", 400);
  }

  const existing = cart.items.find((i) => i.partId === part.id);
  const item = existing
    ? await db.cartItem.update({
        where: { id: existing.id },
        data: {
          qty: Math.min(10, existing.qty + body.qty),
          withInstall,
          installerId,
          apptStartAt,
          shipTo,
        },
      })
    : await db.cartItem.create({
        data: {
          cartId: cart.id,
          partId: part.id,
          qty: body.qty,
          withInstall,
          installerId,
          apptStartAt,
          shipTo,
        },
      });

  return jsonOk({ item }, existing ? 200 : 201);
});
