import { api, jsonOk } from "@/lib/api";
import { db } from "@/lib/db";
import { Role, zAppointmentStatus } from "@/lib/enums";
import { ApiError } from "@/lib/errors";
import { itemArrivalState } from "@/components/portal/installer-utils";

export const dynamic = "force-dynamic";

function parseDateParam(raw: string | null): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * GET /api/installer/appointments?status=&from=&to= — the signed-in shop's
 * appointments, scoped server-side by user.installerId.
 */
export const GET = api(
  async (req, _ctx, user) => {
    if (!user.installerId) {
      throw new ApiError("FORBIDDEN", "No installer shop linked to this account", 403);
    }

    const sp = req.nextUrl.searchParams;
    const statusRaw = sp.get("status");
    let status: string | undefined;
    if (statusRaw) {
      const parsed = zAppointmentStatus.safeParse(statusRaw);
      if (!parsed.success) throw new ApiError("BAD_STATUS", "Unknown appointment status", 400);
      status = parsed.data;
    }
    const from = parseDateParam(sp.get("from"));
    const to = parseDateParam(sp.get("to"));

    const shop = await db.installer.findUnique({ where: { id: user.installerId } });
    if (!shop) throw new ApiError("NOT_FOUND", "Installer shop not found", 404);

    const appts = await db.appointment.findMany({
      where: {
        installerId: user.installerId,
        ...(status ? { status } : {}),
        ...(from || to
          ? { startAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
          : {}),
      },
      orderBy: { startAt: "asc" },
      include: {
        order: { select: { orderNumber: true } },
        items: {
          include: { purchaseOrder: { select: { id: true, poNumber: true, status: true } } },
        },
      },
    });

    return jsonOk({
      shop: {
        id: shop.id,
        name: shop.name,
        tzOffsetMinutes: shop.tzOffsetMinutes,
        slotMinutes: shop.slotMinutes,
      },
      appointments: appts.map((a) => ({
        id: a.id,
        status: a.status,
        startAt: a.startAt.toISOString(),
        durationMinutes: a.durationMinutes,
        totalLaborHoursTenths: a.totalLaborHoursTenths,
        orderNumber: a.order.orderNumber,
        customerName: a.customerName,
        customerPhone: a.customerPhone,
        vehicleDesc: a.vehicleDesc,
        notes: a.notes,
        items: a.items.map((i) => ({
          id: i.id,
          nameSnapshot: i.nameSnapshot,
          qty: i.qty,
          shipTo: i.shipTo,
          itemStatus: i.itemStatus,
          poId: i.purchaseOrder?.id ?? null,
          poNumber: i.purchaseOrder?.poNumber ?? null,
          poStatus: i.purchaseOrder?.status ?? null,
          arrivalState: itemArrivalState(i.itemStatus, i.shipTo, i.purchaseOrder?.status),
        })),
      })),
    });
  },
  { roles: [Role.INSTALLER] },
);
