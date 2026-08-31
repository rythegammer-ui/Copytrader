import { z } from "zod";
import { api, jsonOk, parseBody } from "@/lib/api";
import { getOrCreateCart } from "@/lib/cart";
import { db } from "@/lib/db";
import { ShipTo } from "@/lib/enums";
import { ApiError } from "@/lib/errors";

export const dynamic = "force-dynamic";

const zDefaults = z.object({
  installerId: z.string().min(1),
  apptStartAt: z.string().datetime({ offset: true }),
});

/**
 * POST /api/cart/apply-install-defaults — public (guest cookie carts included).
 * "Use one shop & time for everything": sets withInstall + the given shop and
 * slot (and ship-to-shop) on every cart line whose part is install-eligible.
 * Checkout re-validates capacity/feasibility for the combined labor.
 */
export const POST = api(async (req) => {
  const body = await parseBody(req, zDefaults);
  const cart = await getOrCreateCart();

  const shop = await db.installer.findUnique({ where: { id: body.installerId } });
  if (!shop || !shop.active) {
    throw new ApiError("SHOP_UNAVAILABLE", "That installer shop is not available", 409);
  }
  const apptStartAt = new Date(body.apptStartAt);

  const eligibleIds = cart.items.filter((i) => i.part.installEligible).map((i) => i.id);
  if (eligibleIds.length > 0) {
    await db.cartItem.updateMany({
      where: { id: { in: eligibleIds } },
      data: {
        withInstall: true,
        installerId: shop.id,
        apptStartAt,
        shipTo: ShipTo.INSTALLER,
      },
    });
  }

  return jsonOk({ updated: eligibleIds.length });
});
