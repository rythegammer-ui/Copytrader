/**
 * Shared renderer for attention-queue entries (server component — used by the
 * dashboard preview and the full /admin/attention page).
 */
import Link from "next/link";
import { formatDateTime } from "@/lib/format";
import type { AttentionEntry } from "@/components/admin/admin-data";

export function severityBadgeClass(severity: "red" | "amber"): string {
  return severity === "red" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800";
}

const KIND_LABELS: Record<AttentionEntry["kind"], string> = {
  LATE_PO: "Late PO",
  REJECTED_PO: "Rejected PO",
  STUCK_SHIPPED: "Stuck in transit",
  PAID_NO_POS: "Paid, no POs",
  NEEDS_RESCHEDULE: "Needs reschedule",
  NO_SHOW: "No-show",
  PAST_PENDING: "Slot passed",
  REFUND_FAILED: "Refund failed",
  CANCELLED_UNREFUNDED: "Unrefunded cancel",
};

export function AttentionList({ entries }: { entries: AttentionEntry[] }) {
  if (entries.length === 0) {
    return <p className="p-4 text-sm text-slate-500">Nothing needs attention right now.</p>;
  }
  return (
    <ul className="divide-y divide-slate-100">
      {entries.map((e, idx) => (
        <li key={`${e.kind}-${e.href}-${e.at}-${idx}`}>
          <Link href={e.href} className="block px-4 py-3 transition hover:bg-slate-50">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`badge ${severityBadgeClass(e.severity)}`}>
                {KIND_LABELS[e.kind]}
              </span>
              <span className="text-sm font-medium text-slate-900">{e.title}</span>
            </div>
            <p className="mt-0.5 text-sm text-slate-600">{e.detail}</p>
            <p className="mt-0.5 text-xs text-slate-400">{formatDateTime(e.at)}</p>
          </Link>
        </li>
      ))}
    </ul>
  );
}
