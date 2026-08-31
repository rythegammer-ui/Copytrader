import { actorFor, api, jsonOk } from "@/lib/api";
import { db } from "@/lib/db";
import { POStatus, Role } from "@/lib/enums";
import { transitionPO } from "@/lib/transitions";

export const dynamic = "force-dynamic";

/**
 * POST /api/supplier/pos/[id]/confirm — supplier accepts the PO.
 * Supplier scoping (actor.supplierId must own the PO) is enforced inside
 * transitionPO; illegal transitions return 409.
 */
export const POST = api(
  async (_req, ctx, user) => {
    await db.$transaction(async (tx) => {
      await transitionPO(tx, ctx.params.id, POStatus.CONFIRMED, actorFor(user));
    });
    return jsonOk({ ok: true });
  },
  { roles: [Role.SUPPLIER] },
);
