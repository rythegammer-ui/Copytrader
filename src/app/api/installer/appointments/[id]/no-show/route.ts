import { actorFor, api, jsonOk } from "@/lib/api";
import { db } from "@/lib/db";
import { AppointmentStatus, Role } from "@/lib/enums";
import { transitionAppointment } from "@/lib/transitions";

export const dynamic = "force-dynamic";

/**
 * POST /api/installer/appointments/[id]/no-show — customer didn't show.
 * transitionAppointment rejects the call until the appointment window has
 * passed and enforces shop scoping.
 */
export const POST = api(
  async (_req, ctx, user) => {
    await db.$transaction(async (tx) => {
      await transitionAppointment(tx, ctx.params.id, AppointmentStatus.NO_SHOW, actorFor(user));
    });
    return jsonOk({ ok: true });
  },
  { roles: [Role.INSTALLER] },
);
