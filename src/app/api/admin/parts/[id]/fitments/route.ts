import { z } from "zod";
import { api, jsonOk, parseBody } from "@/lib/api";
import { db } from "@/lib/db";
import { EntityType, Role } from "@/lib/enums";
import { ApiError } from "@/lib/errors";
import { logEvent } from "@/lib/events";

export const dynamic = "force-dynamic";

const zFitmentCreate = z
  .object({
    modelId: z.string().min(1),
    yearFrom: z.number().int().min(1950).max(2100),
    yearTo: z.number().int().min(1950).max(2100),
    engineId: z.string().min(1).nullable().optional(),
    notes: z.string().trim().max(300).nullable().optional(),
  })
  .refine((b) => b.yearTo >= b.yearFrom, {
    message: "yearTo must be >= yearFrom",
    path: ["yearTo"],
  });

/** POST /api/admin/parts/[id]/fitments — add a fitment rule to a part. */
export const POST = api(
  async (req, ctx, user) => {
    const body = await parseBody(req, zFitmentCreate);
    const engineId = body.engineId ?? null;

    const [part, model] = await Promise.all([
      db.part.findUnique({ where: { id: ctx.params.id } }),
      db.vehicleModel.findUnique({
        where: { id: body.modelId },
        include: { make: { select: { name: true } } },
      }),
    ]);
    if (!part) throw new ApiError("NOT_FOUND", "Part not found", 404);
    if (!model) throw new ApiError("NOT_FOUND", "Vehicle model not found", 400);

    let engineName: string | null = null;
    if (engineId) {
      const engine = await db.engine.findUnique({ where: { id: engineId } });
      if (!engine || engine.modelId !== model.id) {
        throw new ApiError("NOT_FOUND", "Engine does not belong to that model", 400);
      }
      engineName = engine.name;
    }

    // SQLite treats NULLs as distinct in unique indexes, so the schema's
    // compound unique doesn't catch dup rows with engineId NULL — check here.
    const dup = await db.fitment.findFirst({
      where: {
        partId: part.id,
        modelId: model.id,
        engineId,
        yearFrom: body.yearFrom,
        yearTo: body.yearTo,
      },
    });
    if (dup) throw new ApiError("DUPLICATE", "An identical fitment rule already exists", 409);

    const fitment = await db.$transaction(async (tx) => {
      const created = await tx.fitment.create({
        data: {
          partId: part.id,
          modelId: model.id,
          yearFrom: body.yearFrom,
          yearTo: body.yearTo,
          engineId,
          notes: body.notes && body.notes.length > 0 ? body.notes : null,
        },
      });
      await logEvent(tx, {
        entityType: EntityType.PART,
        entityId: part.id,
        action: "fitment_added",
        actorUserId: user.id,
        actorRole: user.role,
        internal: true,
        message: `Admin added fitment ${model.make.name} ${model.name} ${body.yearFrom}-${body.yearTo}${engineName ? ` (${engineName})` : ""} to ${part.sku}`,
      });
      return created;
    });

    return jsonOk(
      {
        id: fitment.id,
        partId: fitment.partId,
        modelId: fitment.modelId,
        makeName: model.make.name,
        modelName: model.name,
        engineId: fitment.engineId,
        engineName,
        yearFrom: fitment.yearFrom,
        yearTo: fitment.yearTo,
        notes: fitment.notes,
      },
      201,
    );
  },
  { roles: [Role.ADMIN] },
);
