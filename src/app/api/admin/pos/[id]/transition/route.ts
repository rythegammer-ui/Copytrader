import { z } from "zod";
import { actorFor, api, jsonOk, parseBody } from "@/lib/api";
import { db } from "@/lib/db";
import { Role, zPOStatus } from "@/lib/enums";
import { transitionPO } from "@/lib/transitions";

export const dynamic = "force-dynamic";

const zTransitionBody = z.object({
  to: zPOStatus,
  reason: z.string().trim().min(1).max(500).optional(),
  carrier: z.string().trim().min(1).max(50).optional(),
  trackingNumber: z.string().trim().min(1).max(100).optional(),
});

/**
 * POST /api/admin/pos/[id]/transition — admin override transition on a PO.
 * Logged as an internal admin_override event by the transition layer.
 */
export const POST = api(
  async (req, ctx, user) => {
    const body = await parseBody(req, zTransitionBody);
    await db.$transaction(
      async (tx) => {
        await transitionPO(tx, ctx.params.id, body.to, actorFor(user), {
          override: true,
          rejectReason: body.reason,
          carrier: body.carrier,
          trackingNumber: body.trackingNumber,
        });
      },
      { timeout: 30_000, maxWait: 10_000 },
    );
    return jsonOk({ ok: true });
  },
  { roles: [Role.ADMIN] },
);
