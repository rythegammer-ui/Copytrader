import { z } from "zod";
import { api, jsonOk, parseBody } from "@/lib/api";
import { db } from "@/lib/db";
import { EntityType, Role } from "@/lib/enums";
import { ApiError } from "@/lib/errors";
import { logEvent } from "@/lib/events";

export const dynamic = "force-dynamic";

const zStockBody = z.object({
  partId: z.string().min(1),
  inStock: z.boolean(),
});

/**
 * POST /api/supplier/stock {partId, inStock} — supplier toggles the stock
 * signal on their OWN parts only. Not a status-machine field, but still
 * audit-logged (internal) in the same transaction.
 */
export const POST = api(
  async (req, _ctx, user) => {
    if (!user.supplierId) {
      throw new ApiError("FORBIDDEN", "No supplier linked to this account", 403);
    }
    const { partId, inStock } = await parseBody(req, zStockBody);

    const part = await db.part.findUnique({
      where: { id: partId },
      select: { id: true, name: true, sku: true, supplierId: true },
    });
    if (!part || part.supplierId !== user.supplierId) {
      throw new ApiError("FORBIDDEN", "Not your part", 403);
    }

    await db.$transaction(async (tx) => {
      await tx.part.update({ where: { id: part.id }, data: { inStock } });
      await logEvent(tx, {
        entityType: EntityType.PART,
        entityId: part.id,
        action: "stock_change",
        internal: true,
        actorUserId: user.id,
        actorRole: user.role,
        message: `${part.name} (${part.sku}) marked ${inStock ? "in stock" : "out of stock"}`,
      });
    });

    return jsonOk({ ok: true, partId: part.id, inStock });
  },
  { roles: [Role.SUPPLIER] },
);
