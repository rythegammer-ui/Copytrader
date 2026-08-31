import { z } from "zod";
import { actorFor, api, jsonOk, parseBody } from "@/lib/api";
import { db } from "@/lib/db";
import { POStatus, Role } from "@/lib/enums";
import { transitionPO } from "@/lib/transitions";

export const dynamic = "force-dynamic";

const zShipBody = z.object({
  carrier: z.enum(["UPS", "FedEx", "USPS", "DHL"]),
  trackingNumber: z.string().trim().min(1, "Tracking number is required").max(100),
});

/**
 * POST /api/supplier/pos/[id]/ship {carrier, trackingNumber} — mark shipped.
 * transitionPO stores carrier + tracking and derives the tracking URL.
 */
export const POST = api(
  async (req, ctx, user) => {
    const { carrier, trackingNumber } = await parseBody(req, zShipBody);
    await db.$transaction(async (tx) => {
      await transitionPO(tx, ctx.params.id, POStatus.SHIPPED, actorFor(user), {
        carrier,
        trackingNumber,
      });
    });
    return jsonOk({ ok: true });
  },
  { roles: [Role.SUPPLIER] },
);
