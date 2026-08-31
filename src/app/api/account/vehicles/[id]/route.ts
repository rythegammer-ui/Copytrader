import { api, jsonOk } from "@/lib/api";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/errors";
import { Role } from "@/lib/enums";

export const dynamic = "force-dynamic";

export const DELETE = api(
  async (_req, ctx, user) => {
    const vehicle = await db.customerVehicle.findFirst({
      where: { id: ctx.params.id, userId: user.id },
    });
    if (!vehicle) throw new ApiError("NOT_FOUND", "Vehicle not found", 404);

    await db.customerVehicle.delete({ where: { id: vehicle.id } });
    return jsonOk({ ok: true });
  },
  { roles: [Role.CUSTOMER] },
);
