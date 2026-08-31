import { api, jsonOk } from "@/lib/api";
import { db } from "@/lib/db";
import { Role, ShipTo } from "@/lib/enums";
import { ApiError } from "@/lib/errors";
import { itemArrivalState } from "@/components/portal/installer-utils";

export const dynamic = "force-dynamic";

/**
 * GET /api/installer/appointments/[id] — full appointment detail for the
 * owning shop, including the inbound (ship-to-shop) POs feeding its items.
 */
export const GET = api(
  async (_req, ctx, user) => {
    if (!user.installerId) {
      throw new ApiError("FORBIDDEN", "No installer shop linked to this account", 403);
    }

    const appt = await db.appointment.findFirst({
      where: { id: ctx.params.id, installerId: user.installerId },
      include: {
        installer: true,
        order: { select: { orderNumber: true } },
        items: {
          include: {
            purchaseOrder: { include: { supplier: { select: { name: true } } } },
          },
        },
      },
    });
    if (!appt) throw new ApiError("NOT_FOUND", "Appointment not found", 404);

    // Deduplicate the ship-to-shop POs behind this appointment's items.
    const inboundById = new Map<
      string,
      {
        id: string;
        poNumber: string;
        status: string;
        supplierName: string;
        carrier: string | null;
        trackingNumber: string | null;
        trackingUrl: string | null;
        shippedAt: string | null;
        deliveredAt: string | null;
        receivedAt: string | null;
      }
    >();
    for (const item of appt.items) {
      const po = item.purchaseOrder;
      if (!po || po.shipTo !== ShipTo.INSTALLER || po.installerId !== user.installerId) continue;
      if (!inboundById.has(po.id)) {
        inboundById.set(po.id, {
          id: po.id,
          poNumber: po.poNumber,
          status: po.status,
          supplierName: po.supplier.name,
          carrier: po.carrier,
          trackingNumber: po.trackingNumber,
          trackingUrl: po.trackingUrl,
          shippedAt: po.shippedAt ? po.shippedAt.toISOString() : null,
          deliveredAt: po.deliveredAt ? po.deliveredAt.toISOString() : null,
          receivedAt: po.receivedAt ? po.receivedAt.toISOString() : null,
        });
      }
    }

    return jsonOk({
      id: appt.id,
      status: appt.status,
      startAt: appt.startAt.toISOString(),
      durationMinutes: appt.durationMinutes,
      totalLaborHoursTenths: appt.totalLaborHoursTenths,
      orderNumber: appt.order.orderNumber,
      customerName: appt.customerName,
      customerPhone: appt.customerPhone,
      vehicleDesc: appt.vehicleDesc,
      notes: appt.notes,
      tzOffsetMinutes: appt.installer.tzOffsetMinutes,
      items: appt.items.map((i) => ({
        id: i.id,
        nameSnapshot: i.nameSnapshot,
        skuSnapshot: i.skuSnapshot,
        qty: i.qty,
        shipTo: i.shipTo,
        itemStatus: i.itemStatus,
        poId: i.purchaseOrder?.id ?? null,
        poNumber: i.purchaseOrder?.poNumber ?? null,
        poStatus: i.purchaseOrder?.status ?? null,
        arrivalState: itemArrivalState(i.itemStatus, i.shipTo, i.purchaseOrder?.status),
      })),
      inboundPos: Array.from(inboundById.values()),
    });
  },
  { roles: [Role.INSTALLER] },
);
