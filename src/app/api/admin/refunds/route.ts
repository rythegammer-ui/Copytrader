import { api, jsonOk } from "@/lib/api";
import { db } from "@/lib/db";
import { Role } from "@/lib/enums";

export const dynamic = "force-dynamic";

/** GET /api/admin/refunds — every refund, newest first. */
export const GET = api(
  async () => {
    const refunds = await db.refund.findMany({
      orderBy: { createdAt: "desc" },
      take: 500,
      include: {
        order: { select: { id: true, orderNumber: true } },
        createdBy: { select: { name: true } },
      },
    });
    return jsonOk({
      refunds: refunds.map((r) => ({
        id: r.id,
        orderId: r.order.id,
        orderNumber: r.order.orderNumber,
        amountCents: r.amountCents,
        reason: r.reason,
        status: r.status,
        providerRefundId: r.providerRefundId,
        createdByName: r.createdBy?.name ?? "System",
        createdAt: r.createdAt.toISOString(),
      })),
    });
  },
  { roles: [Role.ADMIN] },
);
