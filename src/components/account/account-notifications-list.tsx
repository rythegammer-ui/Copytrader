"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatDateTime } from "@/lib/format";
import { sendJson } from "./account-api";

export type NotificationRow = {
  id: string;
  type: string;
  title: string;
  body: string;
  href: string | null;
  readAt: string | null;
  createdAt: string;
};

export function AccountNotificationsList({ items }: { items: NotificationRow[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [busyAll, setBusyAll] = useState(false);

  const unreadCount = items.filter((n) => n.readAt === null).length;

  async function markRead(ids: string[]) {
    const res = await sendJson("/api/notifications", "POST", { ids });
    if (res.ok) router.refresh();
  }

  async function markAll() {
    setBusyAll(true);
    const res = await sendJson("/api/notifications", "POST", { all: true });
    setBusyAll(false);
    if (res.ok) router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-600">
          {unreadCount > 0 ? `${unreadCount} unread` : "All caught up"}
        </p>
        {unreadCount > 0 && (
          <button type="button" className="btn-secondary" onClick={markAll} disabled={busyAll}>
            {busyAll ? "Marking…" : "Mark all read"}
          </button>
        )}
      </div>

      <div className="card divide-y divide-slate-100">
        {items.length === 0 && (
          <p className="p-6 text-sm text-slate-500">No notifications yet.</p>
        )}
        {items.map((n) => {
          const unread = n.readAt === null;
          return (
            <div
              key={n.id}
              className={`flex items-start justify-between gap-4 p-4 ${
                unread ? "bg-brand-50/40" : ""
              }`}
            >
              <div className="min-w-0">
                <p className="flex items-center gap-2 font-medium text-slate-900">
                  {unread && (
                    <span
                      aria-label="Unread"
                      className="inline-block h-2 w-2 shrink-0 rounded-full bg-brand-600"
                    />
                  )}
                  {n.title}
                </p>
                <p className="mt-0.5 text-sm text-slate-600">{n.body}</p>
                <p className="mt-1 text-xs text-slate-400">{formatDateTime(n.createdAt)}</p>
                {n.href && (
                  <Link
                    href={n.href}
                    className="mt-1 inline-block text-sm font-medium text-brand-700 hover:underline"
                  >
                    View →
                  </Link>
                )}
              </div>
              {unread && (
                <button
                  type="button"
                  className="shrink-0 text-sm font-medium text-slate-500 hover:text-slate-800"
                  onClick={() => {
                    setBusyId(n.id);
                    markRead([n.id]).finally(() => setBusyId(null));
                  }}
                  disabled={busyId === n.id}
                >
                  {busyId === n.id ? "…" : "Mark read"}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
