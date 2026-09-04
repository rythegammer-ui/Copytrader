import { z } from "zod";
import { actorFor, api, jsonOk, parseBody } from "@/lib/api";
import { Role } from "@/lib/enums";
import { cancelInstallOnly } from "@/lib/fulfillment";

export const dynamic = "force-dynamic";
// Multi-step transactions + payment-provider calls: allow more than the 10s serverless default.
export const maxDuration = 30;

const zCancelBody = z.object({
  reason: z.string().trim().min(1).max(500).optional(),
});

/**
 * POST /api/appointments/[id]/cancel — cancel ONLY the installation (parts
 * still ship) with an automatic labor refund. The customer 24-hour rule and
 * ownership are enforced inside cancelInstallOnly.
 */
export const POST = api(
  async (req, ctx, user) => {
    const { reason } = await parseBody(req, zCancelBody);
    await cancelInstallOnly(ctx.params.id, actorFor(user), reason || "Install cancelled by customer");
    return jsonOk({ ok: true });
  },
  { roles: [Role.CUSTOMER, Role.ADMIN] },
);
