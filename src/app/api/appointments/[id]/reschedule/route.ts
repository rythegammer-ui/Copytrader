import { z } from "zod";
import { actorFor, api, jsonOk, parseBody } from "@/lib/api";
import { Role } from "@/lib/enums";
import { ApiError } from "@/lib/errors";
import { rescheduleAppointment } from "@/lib/fulfillment";

export const dynamic = "force-dynamic";

const zRescheduleBody = z.object({
  startAt: z.string().min(1),
});

/**
 * POST /api/appointments/[id]/reschedule — move an appointment to a new slot.
 * Ownership/scoping (customer owns the order, installer owns the shop) and
 * capacity are enforced inside rescheduleAppointment.
 */
export const POST = api(
  async (req, ctx, user) => {
    const { startAt } = await parseBody(req, zRescheduleBody);
    const when = new Date(startAt);
    if (Number.isNaN(when.getTime())) {
      throw new ApiError("BAD_TIME", "startAt must be a valid ISO timestamp", 400);
    }
    await rescheduleAppointment(ctx.params.id, when, actorFor(user));
    return jsonOk({ ok: true });
  },
  { roles: [Role.CUSTOMER, Role.INSTALLER, Role.ADMIN] },
);
