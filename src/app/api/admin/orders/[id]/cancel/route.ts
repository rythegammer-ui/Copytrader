import { z } from "zod";
import { actorFor, api, jsonOk, parseBody } from "@/lib/api";
import { Role } from "@/lib/enums";
import { cancelOrder } from "@/lib/fulfillment";

export const dynamic = "force-dynamic";

const zCancelBody = z.object({
  reason: z.string().trim().min(1).max(500),
});

/**
 * POST /api/admin/orders/[id]/cancel — admin cancel (eligibility — any state
 * pre-FULFILLED — is enforced inside lib/fulfillment.cancelOrder).
 */
export const POST = api(
  async (req, ctx, user) => {
    const { reason } = await parseBody(req, zCancelBody);
    await cancelOrder(ctx.params.id, actorFor(user), reason);
    return jsonOk({ ok: true });
  },
  { roles: [Role.ADMIN] },
);
