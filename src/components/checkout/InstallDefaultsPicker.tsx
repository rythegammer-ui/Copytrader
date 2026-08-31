"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { formatShopTime } from "@/lib/format";
import { formatCents } from "@/lib/money";

interface ShopDto {
  id: string;
  name: string;
  city: string;
  state: string;
  hourlyRateCents: number;
  tzOffsetMinutes: number;
}

interface SlotDto {
  startAt: string;
  available: boolean;
  feasible: boolean;
}

/**
 * "Use one shop & time for all installs" helper on the cart page: picks a
 * shop + slot (sized for the combined labor of every install-eligible line)
 * and applies it to the whole cart via /api/cart/apply-install-defaults.
 */
export function InstallDefaultsPicker({
  eligibleCount,
  totalLaborTenths,
  maxLeadDays,
}: {
  eligibleCount: number;
  totalLaborTenths: number;
  maxLeadDays: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [shops, setShops] = useState<ShopDto[]>([]);
  const [installerId, setInstallerId] = useState("");
  const [slots, setSlots] = useState<SlotDto[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const shop = shops.find((s) => s.id === installerId) ?? null;

  useEffect(() => {
    if (!open) return;
    let alive = true;
    fetch("/api/installers")
      .then((r) => r.json())
      .then((data: ShopDto[]) => {
        if (alive && Array.isArray(data)) setShops(data);
      })
      .catch(() => {
        if (alive) setError("Could not load installer shops");
      });
    return () => {
      alive = false;
    };
  }, [open]);

  useEffect(() => {
    setSelectedSlot(null);
    if (!open || !installerId) {
      setSlots([]);
      return;
    }
    let alive = true;
    setSlotsLoading(true);
    fetch(
      `/api/installers/${encodeURIComponent(installerId)}/slots?days=14&laborTenths=${Math.max(1, totalLaborTenths)}&lead=${maxLeadDays}`,
    )
      .then((r) => r.json())
      .then((data: { slots?: SlotDto[] }) => {
        if (alive) setSlots(Array.isArray(data.slots) ? data.slots : []);
      })
      .catch(() => {
        if (alive) setError("Could not load appointment slots");
      })
      .finally(() => {
        if (alive) setSlotsLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [open, installerId, totalLaborTenths, maxLeadDays]);

  const days = useMemo(() => {
    if (!shop) return [];
    const map = new Map<string, { label: string; slots: SlotDto[] }>();
    for (const slot of slots) {
      const dayLabel = formatShopTime(slot.startAt, shop.tzOffsetMinutes).split(" · ")[0];
      let bucket = map.get(dayLabel);
      if (!bucket) {
        bucket = { label: dayLabel, slots: [] };
        map.set(dayLabel, bucket);
      }
      bucket.slots.push(slot);
    }
    return Array.from(map.values());
  }, [slots, shop]);

  const apply = useCallback(async () => {
    if (!installerId || !selectedSlot) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/cart/apply-install-defaults", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ installerId, apptStartAt: selectedSlot }),
      });
      if (res.ok) {
        setOpen(false);
        router.refresh();
        return;
      }
      const data = (await res.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setError(data?.error?.message ?? "Could not apply the installation defaults");
    } catch {
      setError("Could not apply the installation defaults");
    } finally {
      setBusy(false);
    }
  }, [installerId, selectedSlot, router]);

  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-900">
            🔧 Use one shop &amp; time for all installs
          </p>
          <p className="text-xs text-slate-500">
            Book every install-eligible part ({eligibleCount}) into a single appointment, parts
            shipped straight to the shop.
          </p>
        </div>
        <button type="button" className="btn-secondary" onClick={() => setOpen((o) => !o)}>
          {open ? "Close" : "Choose shop & time"}
        </button>
      </div>

      {open && (
        <div className="mt-4 space-y-4 border-t border-slate-200 pt-4">
          <div>
            <label className="label" htmlFor="idp-shop">
              Shop
            </label>
            <select
              id="idp-shop"
              className="input"
              value={installerId}
              onChange={(e) => setInstallerId(e.target.value)}
            >
              <option value="">Choose a shop…</option>
              {shops.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} — {s.city}, {s.state} ({formatCents(s.hourlyRateCents)}/hr)
                </option>
              ))}
            </select>
          </div>

          {shop && (
            <div>
              <p className="label">Pick a time (sized for the combined labor)</p>
              {slotsLoading ? (
                <p className="text-sm text-slate-500">Loading slots…</p>
              ) : days.length === 0 ? (
                <p className="text-sm text-slate-500">No slots in the next 14 days.</p>
              ) : (
                <div className="max-h-64 space-y-3 overflow-y-auto pr-1">
                  {days.map((day) => (
                    <div key={day.label}>
                      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                        {day.label}
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {day.slots.map((slot) => {
                          const time = formatShopTime(slot.startAt, shop.tzOffsetMinutes).split(
                            " · ",
                          )[1];
                          const disabled = !slot.available || !slot.feasible;
                          const selected = selectedSlot === slot.startAt;
                          return (
                            <button
                              key={slot.startAt}
                              type="button"
                              disabled={disabled}
                              title={
                                !slot.feasible
                                  ? "Parts won't arrive by then"
                                  : !slot.available
                                    ? "Fully booked"
                                    : undefined
                              }
                              onClick={() => setSelectedSlot(selected ? null : slot.startAt)}
                              className={
                                selected
                                  ? "rounded-md bg-brand-600 px-2.5 py-1 text-xs font-semibold text-white"
                                  : disabled
                                    ? "cursor-not-allowed rounded-md border border-slate-200 bg-slate-100 px-2.5 py-1 text-xs text-slate-400 line-through"
                                    : "rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:border-brand-500 hover:text-brand-700"
                              }
                            >
                              {time}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="flex items-center gap-3">
            <button
              type="button"
              className="btn-primary"
              disabled={busy || !installerId || !selectedSlot}
              onClick={apply}
            >
              {busy ? "Applying…" : "Apply to all installable items"}
            </button>
            {error && <p className="text-sm text-red-600">{error}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
