import { api, jsonOk } from "@/lib/api";
import { db } from "@/lib/db";
import { Role } from "@/lib/enums";
import { ApiError } from "@/lib/errors";
import { expireStaleUnpaidOrder } from "@/lib/fulfillment";
import { carrierTrackingUrl } from "@/lib/transitions";
import { itemDisplayStatus } from "@/components/orders/order-utils";

export const dynamic = "force-dynamic";

function loadOrder(id: string) {
  return db.order.findUnique({
    where: { id },
    include: {
      items: true,
      purchaseOrders: {
        include: { items: { select: { id: true } } },
        orderBy: { createdAt: "asc" },
      },
      appointments: { include: { installer: true }, orderBy: { startAt: "asc" } },
      payments: { orderBy: [{ createdAt: "desc" }, { id: "desc" }] },
      refunds: { orderBy: [{ createdAt: "desc" }, { id: "desc" }] },
    },
  });
}

/**
 * GET /api/orders/[id] — full order detail for the owning customer (or any
 * admin). Also powers the order page's 10s live-refresh poller.
 */
export const GET = api(
  async (_req, ctx, user) => {
    let order = await loadOrder(ctx.params.id);
    if (!order) throw new ApiError("NOT_FOUND", "Order not found", 404);
    if (user.role !== Role.ADMIN && order.userId !== user.id) {
      // Don't reveal that the order exists.
      throw new ApiError("NOT_FOUND", "Order not found", 404);
    }

    if (await expireStaleUnpaidOrder(order)) {
      order = await loadOrder(ctx.params.id);
      if (!order) throw new ApiError("NOT_FOUND", "Order not found", 404);
    }

    const events = await db.eventLog.findMany({
      where: { orderId: order.id, ...(user.role === Role.ADMIN ? {} : { internal: false }) },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 100,
    });

    const poById = new Map(order.purchaseOrders.map((po) => [po.id, po]));

    return jsonOk({
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      currency: order.currency,
      placedAt: order.placedAt.toISOString(),
      paidAt: order.paidAt?.toISOString() ?? null,
      completedAt: order.completedAt?.toISOString() ?? null,
      cancelledAt: order.cancelledAt?.toISOString() ?? null,
      cancelReason: order.cancelReason,
      partsSubtotalCents: order.partsSubtotalCents,
      installSubtotalCents: order.installSubtotalCents,
      shippingTotalCents: order.shippingTotalCents,
      taxRateBps: order.taxRateBps,
      taxCents: order.taxCents,
      totalCents: order.totalCents,
      refundedTotalCents: order.refundedTotalCents,
      address: {
        name: order.shipName,
        line1: order.shipLine1,
        line2: order.shipLine2,
        city: order.shipCity,
        state: order.shipState,
        zip: order.shipZip,
      },
      contactEmail: order.contactEmail,
      contactPhone: order.contactPhone,
      vehicleDesc: order.vehicleDesc,
      items: order.items.map((i) => {
        const po = i.purchaseOrderId ? poById.get(i.purchaseOrderId) : undefined;
        return {
          id: i.id,
          nameSnapshot: i.nameSnapshot,
          skuSnapshot: i.skuSnapshot,
          imageUrlSnapshot: i.imageUrlSnapshot,
          qty: i.qty,
          unitPriceCents: i.unitPriceCents,
          lineTotalCents: i.lineTotalCents,
          withInstall: i.withInstall,
          installUnitCents: i.installUnitCents,
          installTotalCents: i.installTotalCents,
          installRefunded: i.installRefunded,
          shipTo: i.shipTo,
          installerIdSnapshot: i.installerIdSnapshot,
          appointmentId: i.appointmentId,
          purchaseOrderId: i.purchaseOrderId,
          itemStatus: i.itemStatus,
          displayStatus: itemDisplayStatus(i.itemStatus, po?.status ?? null),
        };
      }),
      purchaseOrders: order.purchaseOrders.map((po) => ({
        id: po.id,
        poNumber: po.poNumber,
        status: po.status,
        shipTo: po.shipTo,
        installerId: po.installerId,
        carrier: po.carrier,
        trackingNumber: po.trackingNumber,
        trackingUrl:
          po.trackingUrl ??
          (po.carrier && po.trackingNumber ? carrierTrackingUrl(po.carrier, po.trackingNumber) : null),
        destName: po.destName,
        destCity: po.destCity,
        destState: po.destState,
        confirmedAt: po.confirmedAt?.toISOString() ?? null,
        shippedAt: po.shippedAt?.toISOString() ?? null,
        deliveredAt: po.deliveredAt?.toISOString() ?? null,
        receivedAt: po.receivedAt?.toISOString() ?? null,
        itemIds: po.items.map((x) => x.id),
      })),
      appointments: order.appointments.map((a) => ({
        id: a.id,
        status: a.status,
        startAt: a.startAt.toISOString(),
        durationMinutes: a.durationMinutes,
        totalLaborHoursTenths: a.totalLaborHoursTenths,
        partsReadyAt: a.partsReadyAt?.toISOString() ?? null,
        vehicleDesc: a.vehicleDesc,
        installer: {
          name: a.installer.name,
          city: a.installer.city,
          line1: a.installer.line1,
          phone: a.installer.phone,
          tzOffsetMinutes: a.installer.tzOffsetMinutes,
        },
      })),
      payments: order.payments.map((p) => ({
        provider: p.provider,
        status: p.status,
        amountCents: p.amountCents,
        createdAt: p.createdAt.toISOString(),
      })),
      refunds: order.refunds.map((r) => ({
        amountCents: r.amountCents,
        reason: r.reason,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
      })),
      timeline: events.map((e) => ({
        id: e.id,
        message: e.message,
        createdAt: e.createdAt.toISOString(),
        actorRole: e.actorRole,
        action: e.action,
        toStatus: e.toStatus,
      })),
    });
  },
  { roles: [Role.CUSTOMER, Role.ADMIN] },
);
