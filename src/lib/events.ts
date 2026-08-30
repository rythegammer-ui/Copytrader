import type { Prisma, PrismaClient } from "@prisma/client";

export type DbClient = PrismaClient | Prisma.TransactionClient;

export interface EventInput {
  orderId?: string | null;
  entityType: string; // EntityType
  entityId: string;
  action: string;
  fromStatus?: string | null;
  toStatus?: string | null;
  actorUserId?: string | null;
  actorRole?: string | null;
  internal?: boolean;
  message: string;
  meta?: Record<string, unknown>;
}

/** Append an EventLog row. Call inside the same transaction as the state change. */
export async function logEvent(db: DbClient, e: EventInput): Promise<void> {
  await db.eventLog.create({
    data: {
      orderId: e.orderId ?? null,
      entityType: e.entityType,
      entityId: e.entityId,
      action: e.action,
      fromStatus: e.fromStatus ?? null,
      toStatus: e.toStatus ?? null,
      actorUserId: e.actorUserId ?? null,
      actorRole: e.actorRole ?? null,
      internal: e.internal ?? false,
      message: e.message,
      metaJson: JSON.stringify(e.meta ?? {}),
    },
  });
}

export interface NotifyInput {
  userId: string;
  type: string;
  title: string;
  body: string;
  href?: string | null;
}

/** In-app notification + console mail stub (the required email stand-in). */
export async function notify(db: DbClient, n: NotifyInput): Promise<void> {
  await db.notification.create({
    data: { userId: n.userId, type: n.type, title: n.title, body: n.body, href: n.href ?? null },
  });
  console.log(`[MAIL-STUB] to=user:${n.userId} subject="${n.title}" body="${n.body}"`);
}

export async function notifyMany(db: DbClient, userIds: string[], n: Omit<NotifyInput, "userId">): Promise<void> {
  for (const userId of userIds) {
    await notify(db, { ...n, userId });
  }
}
