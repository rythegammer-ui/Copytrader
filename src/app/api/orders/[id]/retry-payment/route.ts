import { z } from "zod";
import { api, jsonOk, parseBody } from "@/lib/api";
import { createRetryPayment } from "@/lib/checkout";
import { ApiError } from "@/lib/errors";
import { getCurrentUser, tokenOpensOrder } from "@/lib/session";

export const dynamic = "force-dynamic";
// Multi-step transactions + payment-provider calls: allow more than the 10s serverless default.
export const maxDuration = 30;

const zRetry = z.object({
  /** A guest's order access token, when there is no session. */
  accessToken: z.string().min(1).optional(),
});

/**
 * POST /api/orders/[id]/retry-payment — the owning customer, or a guest
 * holding this order's access token.
 *
 * Creates a fresh payment attempt (new Payment row + provider intent) for an
 * order awaiting payment. The token grants no new power here: it already opens
 * the payment form for this order, so a card that was declined should not
 * strand the buyer. Entitlement is enforced inside createRetryPayment.
 */
export const POST = api(async (req, ctx) => {
  const body = await parseBody(req, zRetry);
  const user = await getCurrentUser();
  const viaToken = tokenOpensOrder(ctx.params.id, body.accessToken);

  if (!user && !viaToken) throw new ApiError("NOT_FOUND", "Order not found", 404);

  const result = await createRetryPayment(ctx.params.id, user?.id ?? null, viaToken);
  return jsonOk(result, 201);
});
