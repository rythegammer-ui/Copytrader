import { api, jsonOk } from "@/lib/api";
import { db } from "@/lib/db";
import { EntityType, Role } from "@/lib/enums";
import { ApiError } from "@/lib/errors";
import { logEvent } from "@/lib/events";

export const dynamic = "force-dynamic";

/** DELETE /api/admin/fitments/[id] — remove a fitment rule. */
export const DELETE = api(
  async (_req, ctx, user) => {
    const fitment = await db.fitment.findUnique({
      where: { id: ctx.params.id },
      include: {
        part: { select: { id: true, sku: true } },
        model: { include: { make: { select: { name: true } } } },
      },
    });
    if (!fitment) throw new ApiError("NOT_FOUND", "Fitment not found", 404);

    await db.$transaction(async (tx) => {
      await tx.fitment.delete({ where: { id: fitment.id } });
      await logEvent(tx, {
        entityType: EntityType.PART,
        entityId: fitment.part.id,
        action: "fitment_removed",
        actorUserId: user.id,
        actorRole: user.role,
        internal: true,
        message: `Admin removed fitment ${fitment.model.make.name} ${fitment.model.name} ${fitment.yearFrom}-${fitment.yearTo} from ${fitment.part.sku}`,
      });
    });

    return jsonOk({ ok: true });
  },
  { roles: [Role.ADMIN] },
);
