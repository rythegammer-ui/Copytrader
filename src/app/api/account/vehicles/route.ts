import { z } from "zod";
import { api, jsonOk, parseBody } from "@/lib/api";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/errors";
import { Role } from "@/lib/enums";

export const dynamic = "force-dynamic";

const zVehicleCreate = z.object({
  modelId: z.string().min(1),
  year: z.number().int().min(1980).max(2030),
  engineId: z.string().min(1).optional(),
  nickname: z.string().trim().min(1).max(60).optional(),
});

export const GET = api(
  async (_req, _ctx, user) => {
    const rows = await db.customerVehicle.findMany({
      where: { userId: user.id },
      include: { model: { include: { make: true } }, engine: true },
      orderBy: { id: "asc" },
    });
    return jsonOk({
      vehicles: rows.map((v) => ({
        id: v.id,
        modelId: v.modelId,
        engineId: v.engineId,
        year: v.year,
        nickname: v.nickname,
        makeName: v.model.make.name,
        modelName: v.model.name,
        engineName: v.engine?.name ?? null,
      })),
    });
  },
  { roles: [Role.CUSTOMER] },
);

export const POST = api(
  async (req, _ctx, user) => {
    const body = await parseBody(req, zVehicleCreate);

    const model = await db.vehicleModel.findUnique({
      where: { id: body.modelId },
      include: { make: true },
    });
    if (!model) throw new ApiError("NOT_FOUND", "Vehicle model not found", 404);

    if (body.engineId) {
      const engine = await db.engine.findFirst({
        where: { id: body.engineId, modelId: model.id },
      });
      if (!engine) {
        throw new ApiError("BAD_ENGINE", "That engine does not belong to the selected model", 400);
      }
    }

    const vehicle = await db.customerVehicle.create({
      data: {
        userId: user.id,
        modelId: model.id,
        year: body.year,
        engineId: body.engineId ?? null,
        nickname: body.nickname ?? null,
      },
      include: { model: { include: { make: true } }, engine: true },
    });

    return jsonOk(
      {
        vehicle: {
          id: vehicle.id,
          modelId: vehicle.modelId,
          engineId: vehicle.engineId,
          year: vehicle.year,
          nickname: vehicle.nickname,
          makeName: vehicle.model.make.name,
          modelName: vehicle.model.name,
          engineName: vehicle.engine?.name ?? null,
        },
      },
      201,
    );
  },
  { roles: [Role.CUSTOMER] },
);
