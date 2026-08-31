import { api, jsonOk } from "@/lib/api";
import { db } from "@/lib/db";
import { POStatus, Role, zPOStatus } from "@/lib/enums";
import { ApiError } from "@/lib/errors";

export const dynamic = "force-dynamic";

/**
 * GET /api/supplier/pos?status=CONFIRMED — the signed-in supplier's purchase
 * orders, newest first. Always scoped server-side by user.supplierId.
 */
export const GET = api(
  async (req, _ctx, user) => {
    if (!user.supplierId) {
      throw new ApiError("FORBIDDEN", "No supplier linked to this account", 403);
    }

    const statusRaw = req.nextUrl.searchParams.get("status");
    let status: string | undefined;
    if (statusRaw) {
      const parsed = zPOStatus.safeParse(statusRaw);
      if (!parsed.success) throw new ApiError("BAD_STATUS", "Unknown PO status filter", 400);
      status = parsed.data;
    }

    const pos = await db.purchaseOrder.findMany({
      where: { supplierId: user.supplierId, ...(status ? { status } : {}) },
      orderBy: { createdAt: "desc" },
      include: {
        order: { select: { orderNumber: true } },
        items: { select: { qty: true } },
      },
    });

    const now = Date.now();
    return jsonOk({
      pos: pos.map((po) => ({
        id: po.id,
        poNumber: po.poNumber,
        createdAt: po.createdAt.toISOString(),
        dueAt: po.dueAt ? po.dueAt.toISOString() : null,
        status: po.status,
        shipTo: po.shipTo,
        destName: po.destName,
        destCity: po.destCity,
        destState: po.destState,
        orderNumber: po.order.orderNumber,
        // total units across the PO's line items
        itemCount: po.items.reduce((sum, i) => sum + i.qty, 0),
        supplierCostTotalCents: po.supplierCostTotalCents,
        lateFlag:
          po.dueAt !== null &&
          po.dueAt.getTime() < now &&
          (po.status === POStatus.PENDING_CONFIRMATION || po.status === POStatus.CONFIRMED),
      })),
    });
  },
  { roles: [Role.SUPPLIER] },
);
