import { api, jsonOk } from "@/lib/api";
import { db } from "@/lib/db";
import { OrderStatus, Role } from "@/lib/enums";
import { expireStaleUnpaidOrder } from "@/lib/fulfillment";

export const dynamic = "force-dynamic";

const STALE_MS = 24 * 60 * 60_000;

function loadOrders(userId: string) {
  return db.order.findMany({
    where: { userId },
    orderBy: { placedAt: "desc" },
    include: { items: { select: { imageUrlSnapshot: true, qty: true } } },
  });
}

/** GET /api/orders — the signed-in customer's orders, newest first. */
export const GET = api(
  async (_req, _ctx, user) => {
    let orders = await loadOrders(user.id);

    // Lazy TTL: cancel unpaid orders older than 24h before returning them.
    const staleCandidates = orders.filter(
      (o) =>
        (o.status === OrderStatus.PENDING_PAYMENT || o.status === OrderStatus.PAYMENT_FAILED) &&
        Date.now() - o.placedAt.getTime() > STALE_MS,
    );
    let anyExpired = false;
    for (const o of staleCandidates) {
      if (await expireStaleUnpaidOrder(o)) anyExpired = true;
    }
    if (anyExpired) orders = await loadOrders(user.id);

    return jsonOk({
      orders: orders.map((o) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        placedAt: o.placedAt.toISOString(),
        status: o.status,
        totalCents: o.totalCents,
        refundedTotalCents: o.refundedTotalCents,
        itemCount: o.items.reduce((sum, i) => sum + i.qty, 0),
        thumbnails: o.items.slice(0, 3).map((i) => i.imageUrlSnapshot),
      })),
    });
  },
  { roles: [Role.CUSTOMER] },
);
