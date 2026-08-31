/**
 * Tiny revenue-by-day bar chart — pure divs, no chart library. Server-safe
 * (no interactivity beyond native title tooltips).
 */
import { formatCents } from "@/lib/money";
import type { KpiByDay } from "@/components/admin/admin-data";

export function RevenueChart({ byDay }: { byDay: KpiByDay[] }) {
  const max = Math.max(1, ...byDay.map((d) => d.revenueCents));
  const first = byDay[0];
  const last = byDay[byDay.length - 1];
  return (
    <div>
      <div className="flex h-32 items-end gap-[2px]">
        {byDay.map((d) => {
          const pct = Math.round((d.revenueCents / max) * 100);
          return (
            <div
              key={d.date}
              className="group relative flex-1"
              title={`${d.date}: ${formatCents(d.revenueCents)} · ${d.orders} order${d.orders === 1 ? "" : "s"}`}
            >
              <div
                className={`w-full rounded-t ${d.revenueCents > 0 ? "bg-brand-500 group-hover:bg-brand-700" : "bg-slate-200"}`}
                style={{ height: `${Math.max(pct, d.revenueCents > 0 ? 4 : 2)}%` }}
              />
            </div>
          );
        })}
      </div>
      {first && last && (
        <div className="mt-1 flex justify-between text-[10px] text-slate-400">
          <span>{first.date}</span>
          <span>{last.date}</span>
        </div>
      )}
    </div>
  );
}
