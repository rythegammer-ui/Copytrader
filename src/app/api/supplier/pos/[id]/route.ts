import { api, jsonOk } from "@/lib/api";
import { db } from "@/lib/db";
import { Role } from "@/lib/enums";
import { ApiError } from "@/lib/errors";

export const dynamic = "force-dynamic";

/**
 * GET /api/supplier/pos/[id] — full PO detail for the owning supplier only.
 * Destination is the snapshot on the PO (shop address for INSTALLER dests —
 * never the customer's home address on ship-to-shop POs).
 */
export const GET = api(
  async (_req, ctx, user) => {
    if (!user.supplierId) {
      throw new ApiError("FORBIDDEN", "No supplier linked to this account", 403);
    }

    const po = await db.purchaseOrder.findFirst({
      where: { id: ctx.params.id, supplierId: user.supplierId },
      include: {
        order: { select: { orderNumber: true } },
        items: {
          select: {
            id: true,
            skuSnapshot: true,
            nameSnapshot: true,
            qty: true,
            supplierCostCentsSnapshot: true,
            itemStatus: true,
          },
        },
      },
    });
    if (!po) throw new ApiError("NOT_FOUND", "Purchase order not found", 404);

    return jsonOk({
      id: po.id,
      poNumber: po.poNumber,
      orderNumber: po.order.orderNumber,
      status: po.status,
      shipTo: po.shipTo,
      destination: {
        name: po.destName,
        line1: po.destLine1,
        line2: po.destLine2,
        city: po.destCity,
        state: po.destState,
        zip: po.destZip,
      },
      items: po.items.map((i) => ({
        id: i.id,
        skuSnapshot: i.skuSnapshot,
        nameSnapshot: i.nameSnapshot,
        qty: i.qty,
        supplierCostCentsSnapshot: i.supplierCostCentsSnapshot,
        itemStatus: i.itemStatus,
      })),
      supplierCostTotalCents: po.supplierCostTotalCents,
      shippingFeeCents: po.shippingFeeCents,
      carrier: po.carrier,
      trackingNumber: po.trackingNumber,
      trackingUrl: po.trackingUrl,
      rejectReason: po.rejectReason,
      createdAt: po.createdAt.toISOString(),
      dueAt: po.dueAt ? po.dueAt.toISOString() : null,
      confirmedAt: po.confirmedAt ? po.confirmedAt.toISOString() : null,
      shippedAt: po.shippedAt ? po.shippedAt.toISOString() : null,
      deliveredAt: po.deliveredAt ? po.deliveredAt.toISOString() : null,
      receivedAt: po.receivedAt ? po.receivedAt.toISOString() : null,
      cancelledAt: po.cancelledAt ? po.cancelledAt.toISOString() : null,
    });
  },
  { roles: [Role.SUPPLIER] },
);
