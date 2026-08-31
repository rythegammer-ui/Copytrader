import { z } from "zod";
import { actorFor, api, jsonOk, parseBody } from "@/lib/api";
import { Role } from "@/lib/enums";
import { cancelOrder } from "@/lib/fulfillment";

export const dynamic = "force-dynamic";

const zCancelBody = z.object({
  reason: z.string().trim().min(1).max(500).optional(),
});

/**
 * POST /api/orders/[id]/cancel — cancel an order. Customer eligibility (own
 * order, no supplier confirmation yet) is enforced inside cancelOrder.
 */
export const POST = api(
  async (req, ctx, user) => {
    const { reason } = await parseBody(req, zCancelBody);
    await cancelOrder(ctx.params.id, actorFor(user), reason || "Cancelled by customer");
    return jsonOk({ ok: true });
  },
  { roles: [Role.CUSTOMER, Role.ADMIN] },
);
