import { api, jsonOk } from "@/lib/api";
import { createRetryPayment } from "@/lib/checkout";
import { Role } from "@/lib/enums";

export const dynamic = "force-dynamic";

/**
 * POST /api/orders/[id]/retry-payment — CUSTOMER.
 * Creates a fresh payment attempt (new Payment row + provider intent) for an
 * order awaiting payment. Ownership is enforced inside createRetryPayment.
 */
export const POST = api(
  async (_req, ctx, user) => {
    const result = await createRetryPayment(ctx.params.id, user.id);
    return jsonOk(result, 201);
  },
  { roles: [Role.CUSTOMER] },
);
