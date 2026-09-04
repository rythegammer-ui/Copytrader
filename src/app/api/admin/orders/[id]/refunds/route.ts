import { z } from "zod";
import { actorFor, api, jsonOk, parseBody } from "@/lib/api";
import { Role } from "@/lib/enums";
import { executeRefund } from "@/lib/fulfillment";
import type { RefundSelection } from "@/lib/refunds";

export const dynamic = "force-dynamic";
// Multi-step transactions + payment-provider calls: allow more than the 10s serverless default.
export const maxDuration = 30;

const zRefundBody = z.object({
  /** An entry means a FULL line refund (parts + install); `install` is informational. */
  items: z
    .array(z.object({ orderItemId: z.string().min(1), install: z.boolean().optional() }))
    .optional(),
  installOnlyItemIds: z.array(z.string().min(1)).optional(),
  customAmountCents: z.number().int().positive().optional(),
  reason: z.string().trim().min(1).max(500),
});

/**
 * POST /api/admin/orders/[id]/refunds — execute a refund composed by the admin.
 * Provider call + state flips happen inside lib/fulfillment.executeRefund.
 */
export const POST = api(
  async (req, ctx, user) => {
    const body = await parseBody(req, zRefundBody);

    const hasSelection =
      (body.items?.length ?? 0) > 0 || (body.installOnlyItemIds?.length ?? 0) > 0;
    const selection: RefundSelection | null = hasSelection
      ? {
          itemIds: (body.items ?? []).map((i) => i.orderItemId),
          installOnlyItemIds: body.installOnlyItemIds ?? [],
        }
      : null;

    const result = await executeRefund(
      ctx.params.id,
      selection,
      actorFor(user),
      body.reason,
      body.customAmountCents,
    );
    return jsonOk(result);
  },
  { roles: [Role.ADMIN] },
);
