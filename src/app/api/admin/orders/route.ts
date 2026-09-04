import { api, jsonOk } from "@/lib/api";
import { ci } from "@/lib/search";
import { db } from "@/lib/db";
import { Role, zOrderStatus } from "@/lib/enums";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;

/**
 * GET /api/admin/orders?status=&q=&page= — paginated admin orders table.
 * q matches the order number or the customer's email/name.
 */
export const GET = api(
  async (req) => {
    const sp = req.nextUrl.searchParams;
    const statusParam = sp.get("status");
    const status = zOrderStatus.safeParse(statusParam);
    const q = (sp.get("q") ?? "").trim();
    const rawPage = Number(sp.get("page") ?? "1");
    const page = Number.isFinite(rawPage) ? Math.max(1, Math.floor(rawPage)) : 1;

    const where = {
      ...(status.success ? { status: status.data } : {}),
      ...(q
        ? {
            OR: [
              { orderNumber: ci(q) },
              { user: { email: ci(q.toLowerCase()) } },
              { user: { name: ci(q) } },
            ],
          }
        : {}),
    };

    const [total, orders] = await Promise.all([
      db.order.count({ where }),
      db.order.findMany({
        where,
        orderBy: { placedAt: "desc" },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        include: {
          user: { select: { name: true, email: true } },
          items: { select: { qty: true, withInstall: true } },
        },
      }),
    ]);

    return jsonOk({
      page,
      pageSize: PAGE_SIZE,
      total,
      rows: orders.map((o) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        placedAt: o.placedAt.toISOString(),
        customerName: o.user.name,
        customerEmail: o.user.email,
        status: o.status,
        totalCents: o.totalCents,
        refundedTotalCents: o.refundedTotalCents,
        itemCount: o.items.reduce((s, i) => s + i.qty, 0),
        hasInstall: o.items.some((i) => i.withInstall),
      })),
    });
  },
  { roles: [Role.ADMIN] },
);
