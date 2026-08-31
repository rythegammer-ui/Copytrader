import { z } from "zod";
import { actorFor, api, jsonOk, parseBody } from "@/lib/api";
import { db } from "@/lib/db";
import { AppointmentStatus, Role } from "@/lib/enums";
import { transitionAppointment } from "@/lib/transitions";

export const dynamic = "force-dynamic";

const zCompleteBody = z.object({
  notes: z.string().trim().max(2000).optional(),
});

/**
 * POST /api/installer/appointments/[id]/complete {notes?} — mark the install
 * done. Only legal from READY; shop scoping enforced in transitionAppointment.
 */
export const POST = api(
  async (req, ctx, user) => {
    const { notes } = await parseBody(req, zCompleteBody);
    await db.$transaction(async (tx) => {
      await transitionAppointment(tx, ctx.params.id, AppointmentStatus.COMPLETED, actorFor(user), {
        ...(notes ? { notes } : {}),
      });
    });
    return jsonOk({ ok: true });
  },
  { roles: [Role.INSTALLER] },
);
