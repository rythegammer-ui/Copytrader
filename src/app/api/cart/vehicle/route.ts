import { z } from "zod";
import { api, jsonOk, parseBody } from "@/lib/api";
import { getOrCreateCart } from "@/lib/cart";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/errors";

export const dynamic = "force-dynamic";

const zVehicle = z.object({
  modelId: z.string().min(1).nullable().optional(),
  year: z.number().int().min(1950).max(2035).nullable().optional(),
  engineId: z.string().min(1).nullable().optional(),
});

/**
 * PUT /api/cart/vehicle — public (guest cookie carts included).
 * Sets or clears the cart's active vehicle fitment context. Fields are
 * applied individually: pass null to clear a field; clearing the model also
 * clears year + engine.
 */
export const PUT = api(async (req) => {
  const body = await parseBody(req, zVehicle);
  const cart = await getOrCreateCart();

  const data: { ctxModelId?: string | null; ctxYear?: number | null; ctxEngineId?: string | null } =
    {};

  if (body.modelId !== undefined) {
    if (body.modelId === null) {
      data.ctxModelId = null;
      data.ctxYear = null;
      data.ctxEngineId = null;
    } else {
      const model = await db.vehicleModel.findUnique({ where: { id: body.modelId } });
      if (!model) throw new ApiError("NOT_FOUND", "Unknown vehicle model", 404);
      data.ctxModelId = model.id;
      // A model change invalidates a previously chosen engine unless a new
      // one is supplied in the same request.
      if (body.engineId === undefined && body.modelId !== cart.ctxModelId) {
        data.ctxEngineId = null;
      }
    }
  }

  if (body.year !== undefined) data.ctxYear = body.year;

  if (body.engineId !== undefined) {
    if (body.engineId === null) {
      data.ctxEngineId = null;
    } else {
      const engine = await db.engine.findUnique({ where: { id: body.engineId } });
      const effectiveModelId = data.ctxModelId !== undefined ? data.ctxModelId : cart.ctxModelId;
      if (!engine || engine.modelId !== effectiveModelId) {
        throw new ApiError("NOT_FOUND", "Unknown engine for that model", 404);
      }
      data.ctxEngineId = engine.id;
    }
  }

  const updated = await db.cart.update({ where: { id: cart.id }, data });
  return jsonOk({
    vehicle:
      updated.ctxModelId && updated.ctxYear != null
        ? { modelId: updated.ctxModelId, year: updated.ctxYear, engineId: updated.ctxEngineId }
        : null,
  });
});
