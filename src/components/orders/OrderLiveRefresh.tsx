"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatDateTime } from "@/lib/format";
import { computeOrderStateKey } from "./order-utils";

export interface TimelineEntry {
  id: string;
  message: string;
  createdAt: string; // ISO
  actorRole: string | null;
  action: string;
  toStatus: string | null;
}

interface PollResponse {
  status: string;
  refundedTotalCents: number;
  purchaseOrders: { id: string; status: string }[];
  appointments: { id: string; status: string; startAt: string }[];
  payments: { status: string }[];
  timeline: TimelineEntry[];
}

function roleChip(role: string): string {
  if (role === "SYSTEM") return "System";
  return role.charAt(0) + role.slice(1).toLowerCase();
}

/**
 * Live activity feed for an order. Renders the timeline (newest first) and
 * polls GET /api/orders/[id] every 10s; when the order's state fingerprint
 * changes it refreshes the whole server-rendered page so statuses, progress
 * bar, and cards update too.
 */
export function OrderLiveRefresh({
  orderId,
  initialKey,
  initialTimeline,
}: {
  orderId: string;
  initialKey: string;
  initialTimeline: TimelineEntry[];
}) {
  const router = useRouter();
  const [timeline, setTimeline] = useState<TimelineEntry[]>(initialTimeline);
  const keyRef = useRef(initialKey);

  // A server re-render (after router.refresh) hands us fresh props.
  useEffect(() => {
    keyRef.current = initialKey;
    setTimeline(initialTimeline);
  }, [initialKey, initialTimeline]);

  useEffect(() => {
    let stopped = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/orders/${orderId}`, { cache: "no-store" });
        if (!res.ok || stopped) return;
        const data = (await res.json()) as PollResponse;
        if (stopped) return;
        setTimeline(data.timeline ?? []);
        const key = computeOrderStateKey({
          status: data.status,
          refundedTotalCents: data.refundedTotalCents,
          purchaseOrders: data.purchaseOrders ?? [],
          appointments: data.appointments ?? [],
          payments: data.payments ?? [],
          timelineCount: (data.timeline ?? []).length,
        });
        if (key !== keyRef.current) {
          keyRef.current = key;
          router.refresh();
        }
      } catch {
        /* transient network error — try again next tick */
      }
    };
    const id = setInterval(tick, 10_000);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [orderId, router]);

  if (timeline.length === 0) {
    return <p className="text-sm text-slate-500">No activity yet.</p>;
  }

  return (
    <ol className="space-y-4">
      {timeline.map((e) => (
        <li key={e.id} className="relative pl-6">
          <span className="absolute left-0 top-1.5 h-2.5 w-2.5 rounded-full bg-brand-500" aria-hidden />
          <p className="text-sm text-slate-900">{e.message}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span>{formatDateTime(e.createdAt)}</span>
            {e.actorRole && (
              <span className="badge bg-slate-100 text-slate-700">{roleChip(e.actorRole)}</span>
            )}
          </p>
        </li>
      ))}
    </ol>
  );
}
