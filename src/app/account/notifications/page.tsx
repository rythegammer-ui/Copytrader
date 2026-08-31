import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { Role } from "@/lib/enums";
import { requirePageUser } from "@/lib/page-auth";
import {
  AccountNotificationsList,
  type NotificationRow,
} from "@/components/account/account-notifications-list";

export const metadata: Metadata = { title: "Notifications" };
export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const user = await requirePageUser([Role.CUSTOMER, Role.ADMIN], "/account/notifications");

  const rows = await db.notification.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const items: NotificationRow[] = rows.map((n) => ({
    id: n.id,
    type: n.type,
    title: n.title,
    body: n.body,
    href: n.href,
    readAt: n.readAt ? n.readAt.toISOString() : null,
    createdAt: n.createdAt.toISOString(),
  }));

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <div className="mb-6">
        <Link href="/account" className="text-sm text-slate-500 hover:underline">
          ← Account
        </Link>
        <h1 className="mt-1 text-2xl font-bold text-slate-900">Notifications</h1>
      </div>
      <AccountNotificationsList items={items} />
    </div>
  );
}
