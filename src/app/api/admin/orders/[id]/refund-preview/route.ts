import { z } from "zod";
import { api, jsonOk, parseBody } from "@/lib/api";
import { db } from "@/lib/db";
import { Role } from "@/lib/enums";
import { ApiError } from "@/lib/errors";
import { computeRefund, type RefundOrderSnapshot } from "@/lib/refunds";

export const dynamic = "force-dynamic";

const zPreviewBody = z.object({
  items: z
    .array(z.object({ orderItemId: z.string().min(1), install: z.boolean().optional() }))
    .optional(),
  installOnlyItemIds: z.array(z.string().min(1)).optional(),
});

/**
 * POST /api/admin/orders/[id]/refund-preview — dry-run of computeRefund for
 * the refund composer. Same snapshot shape lib/fulfillment builds; no writes.
 */
export const POST = api(
  async (req, ctx) => {
    const body = await parseBody(req, zPreviewBody);

    const order = await db.order.findUnique({
      where: { id: ctx.params.id },
      include: { items: true, purchaseOrders: true },
    });
    if (!order) throw new ApiError("NOT_FOUND", "Order not found", 404);
    if (!order.paidAt) throw new ApiError("NOT_PAID", "Order was never paid", 409);

    const snapshot: RefundOrderSnapshot = {
      totalCents: order.totalCents,
      taxRateBps: order.taxRateBps,
      refundedTotalCents: order.refundedTotalCents,
      items: order.items.map((i) => ({
        id: i.id,
        lineTotalCents: i.lineTotalCents,
        installTotalCents: i.installTotalCents,
        withInstall: i.withInstall,
        installRefunded: i.installRefunded,
        itemStatus: i.itemStatus,
        purchaseOrderId: i.purchaseOrderId,
        shipTo: i.shipTo,
      })),
      purchaseOrders: order.purchaseOrders.map((po) => ({
        id: po.id,
        shippingFeeCents: po.shippingFeeCents,
      })),
    };

    try {
      const r = computeRefund(snapshot, {
        itemIds: (body.items ?? []).map((i) => i.orderItemId),
        installOnlyItemIds: body.installOnlyItemIds ?? [],
      });
      return jsonOk({
        partsCents: r.partsCents,
        installCents: r.installCents,
        shippingCents: r.shippingCents,
        taxCents: r.taxCents,
        amountCents: r.amountCents,
        isFinal: r.isFinal,
      });
    } catch (err) {
      throw new ApiError(
        "BAD_SELECTION",
        err instanceof Error ? err.message : "Invalid refund selection",
        400,
      );
    }
  },
  { roles: [Role.ADMIN] },
);
