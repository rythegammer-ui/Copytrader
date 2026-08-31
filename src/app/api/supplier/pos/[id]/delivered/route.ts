import { actorFor, api, jsonOk } from "@/lib/api";
import { db } from "@/lib/db";
import { POStatus, Role } from "@/lib/enums";
import { transitionPO } from "@/lib/transitions";

export const dynamic = "force-dynamic";

/**
 * POST /api/supplier/pos/[id]/delivered — demo carrier stand-in: the supplier
 * marks the shipment delivered (real carrier webhooks are a v2 item).
 */
export const POST = api(
  async (_req, ctx, user) => {
    await db.$transaction(async (tx) => {
      await transitionPO(tx, ctx.params.id, POStatus.DELIVERED, actorFor(user));
    });
    return jsonOk({ ok: true });
  },
  { roles: [Role.SUPPLIER] },
);
