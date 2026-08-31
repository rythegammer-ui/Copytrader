import { z } from "zod";
import { api, jsonOk, parseBody } from "@/lib/api";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/errors";
import { Role } from "@/lib/enums";

export const dynamic = "force-dynamic";

const ANY_AUTHED = [Role.CUSTOMER, Role.ADMIN, Role.SUPPLIER, Role.INSTALLER];

export const GET = api(
  async (req, _ctx, user) => {
    const unreadOnly = new URL(req.url).searchParams.get("unread") === "1";
    const notifications = await db.notification.findMany({
      where: { userId: user.id, ...(unreadOnly ? { readAt: null } : {}) },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    const unreadCount = await db.notification.count({
      where: { userId: user.id, readAt: null },
    });
    return jsonOk({ notifications, unreadCount });
  },
  { roles: ANY_AUTHED },
);

const zMarkRead = z.object({
  ids: z.array(z.string().min(1)).max(200).optional(),
  all: z.boolean().optional(),
});

export const POST = api(
  async (req, _ctx, user) => {
    const body = await parseBody(req, zMarkRead);

    if (body.all === true) {
      const res = await db.notification.updateMany({
        where: { userId: user.id, readAt: null },
        data: { readAt: new Date() },
      });
      return jsonOk({ ok: true, updated: res.count });
    }

    if (body.ids && body.ids.length > 0) {
      // Scoped to the caller's own notifications — client ids are not trusted.
      const res = await db.notification.updateMany({
        where: { userId: user.id, id: { in: body.ids }, readAt: null },
        data: { readAt: new Date() },
      });
      return jsonOk({ ok: true, updated: res.count });
    }

    throw new ApiError("VALIDATION", "Provide ids[] or all:true", 400);
  },
  { roles: ANY_AUTHED },
);
