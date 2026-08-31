import { actorFor, api, jsonOk } from "@/lib/api";
import { db } from "@/lib/db";
import { POStatus, Role } from "@/lib/enums";
import { transitionPO } from "@/lib/transitions";

export const dynamic = "force-dynamic";

/**
 * POST /api/installer/pos/[id]/received — the shop confirms physical receipt
 * of a ship-to-shop PO. transitionPO verifies the actor's installerId matches
 * the PO's destination shop and re-runs appointment readiness in the same tx.
 */
export const POST = api(
  async (_req, ctx, user) => {
    await db.$transaction(async (tx) => {
      await transitionPO(tx, ctx.params.id, POStatus.RECEIVED, actorFor(user));
    });
    return jsonOk({ ok: true });
  },
  { roles: [Role.INSTALLER] },
);
