import { z } from "zod";
import { actorFor, api, jsonOk, parseBody } from "@/lib/api";
import { db } from "@/lib/db";
import { POStatus, Role } from "@/lib/enums";
import { transitionPO } from "@/lib/transitions";

export const dynamic = "force-dynamic";

const zRejectBody = z.object({
  reason: z.string().trim().min(3, "Please give a short reason").max(500),
});

/**
 * POST /api/supplier/pos/[id]/reject {reason} — supplier declines the PO.
 * Admins are notified inside transitionPO and resolve with a refund.
 */
export const POST = api(
  async (req, ctx, user) => {
    const { reason } = await parseBody(req, zRejectBody);
    await db.$transaction(async (tx) => {
      await transitionPO(tx, ctx.params.id, POStatus.REJECTED, actorFor(user), {
        rejectReason: reason,
      });
    });
    return jsonOk({ ok: true });
  },
  { roles: [Role.SUPPLIER] },
);
