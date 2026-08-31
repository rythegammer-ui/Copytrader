import { z } from "zod";
import { actorFor, api, jsonOk, parseBody } from "@/lib/api";
import { db } from "@/lib/db";
import { Role, zAppointmentStatus } from "@/lib/enums";
import { transitionAppointment } from "@/lib/transitions";

export const dynamic = "force-dynamic";

const zBody = z.object({
  to: zAppointmentStatus,
  newStartAt: z.string().datetime({ offset: true }).optional(),
  notes: z.string().max(2000).optional(),
  override: z.boolean().optional(),
});

/**
 * POST /api/admin/appointments/[id]/transition — ADMIN.
 * Resolves stuck appointments: rebook a NO_SHOW (to: "READY" + newStartAt),
 * cancel a dead appointment, or force a state with override. All moves go
 * through the transition engine (legality tables + event log + rollup).
 */
export const POST = api(
  async (req, ctx, user) => {
    const body = await parseBody(req, zBody);
    await db.$transaction(
      async (tx) => {
        await transitionAppointment(tx, ctx.params.id, body.to, actorFor(user), {
          newStartAt: body.newStartAt ? new Date(body.newStartAt) : undefined,
          notes: body.notes,
          override: body.override,
        });
      },
      { timeout: 30_000, maxWait: 10_000 },
    );
    return jsonOk({ ok: true });
  },
  { roles: [Role.ADMIN] },
);
