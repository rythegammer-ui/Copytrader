import { api, jsonOk } from "@/lib/api";
import { db } from "@/lib/db";
import { Role } from "@/lib/enums";
import { readinessSummary } from "@/components/orders/order-utils";

export const dynamic = "force-dynamic";

/**
 * GET /api/appointments — the signed-in customer's appointments (via their
 * orders), upcoming first, then past (most recent past first).
 */
export const GET = api(
  async (_req, _ctx, user) => {
    const appts = await db.appointment.findMany({
      where: { order: { userId: user.id } },
      orderBy: { startAt: "asc" },
      include: {
        installer: true,
        order: { select: { id: true, orderNumber: true } },
        items: {
          select: {
            nameSnapshot: true,
            qty: true,
            shipTo: true,
            itemStatus: true,
            purchaseOrder: { select: { status: true } },
          },
        },
      },
    });

    const now = Date.now();
    const upcoming = appts.filter((a) => a.startAt.getTime() >= now);
    const past = appts.filter((a) => a.startAt.getTime() < now).reverse();

    return jsonOk({
      appointments: [...upcoming, ...past].map((a) => ({
        id: a.id,
        orderId: a.order.id,
        orderNumber: a.order.orderNumber,
        status: a.status,
        startAt: a.startAt.toISOString(),
        durationMinutes: a.durationMinutes,
        totalLaborHoursTenths: a.totalLaborHoursTenths,
        partsReadyAt: a.partsReadyAt?.toISOString() ?? null,
        vehicleDesc: a.vehicleDesc,
        shop: {
          id: a.installer.id,
          name: a.installer.name,
          line1: a.installer.line1,
          city: a.installer.city,
          state: a.installer.state,
          zip: a.installer.zip,
          phone: a.installer.phone,
          tzOffsetMinutes: a.installer.tzOffsetMinutes,
        },
        items: a.items.map((i) => ({
          nameSnapshot: i.nameSnapshot,
          qty: i.qty,
          shipTo: i.shipTo,
        })),
        readiness: readinessSummary(
          a.status,
          a.items.map((i) => ({
            itemStatus: i.itemStatus,
            shipTo: i.shipTo,
            poStatus: i.purchaseOrder?.status ?? null,
          })),
        ),
      })),
    });
  },
  { roles: [Role.CUSTOMER] },
);
