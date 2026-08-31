"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ShipTo } from "@/lib/enums";
import { formatShopTime } from "@/lib/format";
import { formatCents } from "@/lib/money";

export interface WidgetShop {
  installerId: string;
  name: string;
  city: string;
  state: string;
  hourlyRateCents: number;
  estimateCents: number; // per-unit install estimate at this shop
  tzOffsetMinutes: number;
  leadNote: string;
}

interface SlotDto {
  startAt: string;
  available: boolean;
  feasible: boolean;
}

/**
 * Part-detail purchase widget: qty, optional professional install (shop pick +
 * 14-day slot grid + ship-to choice), add to cart with incompatibility
 * force-add confirm.
 */
export function InstallWidget({
  partId,
  priceCents,
  installEligible,
  inStock,
  laborHoursTenths,
  supplierLeadDays,
  shops,
}: {
  partId: string;
  priceCents: number;
  installEligible: boolean;
  inStock: boolean;
  laborHoursTenths: number;
  supplierLeadDays: number;
  shops: WidgetShop[];
}) {
  const router = useRouter();
  const [qty, setQty] = useState(1);
  const [withInstall, setWithInstall] = useState(false);
  const [installerId, setInstallerId] = useState("");
  const [shipTo, setShipTo] = useState<string>(ShipTo.HOME);
  const [slots, setSlots] = useState<SlotDto[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsForce, setNeedsForce] = useState(false);
  const [added, setAdded] = useState(false);

  const shop = shops.find((s) => s.installerId === installerId) ?? null;

  // Load the 14-day slot grid whenever the shop or labor scale changes.
  useEffect(() => {
    setSelectedSlot(null);
    if (!withInstall || !installerId) {
      setSlots([]);
      return;
    }
    let alive = true;
    setSlotsLoading(true);
    const laborTenths = laborHoursTenths * qty;
    fetch(
      `/api/installers/${encodeURIComponent(installerId)}/slots?days=14&laborTenths=${laborTenths}&lead=${supplierLeadDays}`,
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
  }, [withInstall, installerId, qty, laborHoursTenths, supplierLeadDays]);

  // Group slots into shop-local days for the grid.
  const days = useMemo(() => {
    if (!shop) return [];
    const map = new Map<string, { label: string; slots: SlotDto[] }>();
    for (const slot of slots) {
      const [dayLabel, timeLabel] = formatShopTime(slot.startAt, shop.tzOffsetMinutes).split(" · ");
      void timeLabel;
      let bucket = map.get(dayLabel);
      if (!bucket) {
        bucket = { label: dayLabel, slots: [] };
        map.set(dayLabel, bucket);
      }
      bucket.slots.push(slot);
    }
    return Array.from(map.values());
  }, [slots, shop]);

  const installTotal = shop ? shop.estimateCents * qty : 0;

  const toggleInstall = (on: boolean) => {
    setWithInstall(on);
    setError(null);
    setNeedsForce(false);
    if (on) {
      setShipTo(ShipTo.INSTALLER);
      if (!installerId && shops.length > 0) setInstallerId(shops[0].installerId);
    } else {
      setShipTo(ShipTo.HOME);
      setSelectedSlot(null);
    }
  };

  const addToCart = useCallback(
    async (force: boolean) => {
      setError(null);
      setNeedsForce(false);
      if (withInstall && !installerId) {
        setError("Choose a shop for the installation");
        return;
      }
      setBusy(true);
      try {
        const res = await fetch("/api/cart/items", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            partId,
            qty,
            withInstall,
            installerId: withInstall ? installerId : undefined,
            apptStartAt: withInstall && selectedSlot ? selectedSlot : undefined,
            shipTo: withInstall ? shipTo : ShipTo.HOME,
            ...(force ? { force: true } : {}),
          }),
        });
        if (res.ok) {
          setAdded(true);
          router.refresh();
          return;
        }
        const body = (await res.json().catch(() => null)) as {
          error?: { code?: string; message?: string };
        } | null;
        if (res.status === 409 && body?.error?.code === "INCOMPATIBLE") {
          setNeedsForce(true);
        } else {
          setError(body?.error?.message ?? "Could not add to cart");
        }
      } catch {
        setError("Could not add to cart");
      } finally {
        setBusy(false);
      }
    },
    [partId, qty, withInstall, installerId, selectedSlot, shipTo, router],
  );

  if (added) {
    return (
      <div className="card space-y-3 p-5">
        <p className="flex items-center gap-2 text-sm font-semibold text-green-700">
          <span aria-hidden>✓</span> Added to your cart
        </p>
        <div className="flex gap-3">
          <Link href="/cart" className="btn-primary">
            View cart
          </Link>
          <button type="button" className="btn-secondary" onClick={() => setAdded(false)}>
            Keep shopping
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="card space-y-4 p-5">
      <div className="flex items-center justify-between gap-4">
        <label className="text-sm font-medium text-slate-700" htmlFor="iw-qty">
          Quantity
        </label>
        <select
          id="iw-qty"
          className="input w-24"
          value={qty}
          onChange={(e) => setQty(parseInt(e.target.value, 10))}
        >
          {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </div>

      {installEligible && shops.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
              checked={withInstall}
              onChange={(e) => toggleInstall(e.target.checked)}
            />
            <span>
              <span className="block text-sm font-semibold text-slate-900">
                Add professional installation
              </span>
              <span className="block text-xs text-slate-500">
                Book a shop and pay parts + labor in one checkout. Labor is tax-free.
              </span>
            </span>
          </label>

          {withInstall && (
            <div className="mt-4 space-y-4">
              <div>
                <label className="label" htmlFor="iw-shop">
                  Shop
                </label>
                <select
                  id="iw-shop"
                  className="input"
                  value={installerId}
                  onChange={(e) => setInstallerId(e.target.value)}
                >
                  <option value="">Choose a shop…</option>
                  {shops.map((s) => (
                    <option key={s.installerId} value={s.installerId}>
                      {s.name} — {s.city}, {s.state} (est. {formatCents(s.estimateCents)}/unit)
                    </option>
                  ))}
                </select>
                {shop && (
                  <p className="mt-1 text-xs text-slate-500">
                    Estimated labor: <span className="font-semibold">{formatCents(installTotal)}</span>{" "}
                    for {qty} unit{qty === 1 ? "" : "s"} · {shop.leadNote}
                  </p>
                )}
              </div>

              {shop && (
                <div>
                  <p className="label">Pick a time (optional — you can also choose at checkout)</p>
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

              <fieldset>
                <legend className="label">Where should the parts ship?</legend>
                <div className="space-y-1.5 text-sm text-slate-700">
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="iw-shipto"
                      className="h-4 w-4 border-slate-300 text-brand-600 focus:ring-brand-500"
                      checked={shipTo === ShipTo.INSTALLER}
                      onChange={() => setShipTo(ShipTo.INSTALLER)}
                    />
                    Ship to the shop (recommended)
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="iw-shipto"
                      className="h-4 w-4 border-slate-300 text-brand-600 focus:ring-brand-500"
                      checked={shipTo === ShipTo.HOME}
                      onChange={() => setShipTo(ShipTo.HOME)}
                    />
                    Ship to my address (bring the part with you)
                  </label>
                </div>
              </fieldset>
            </div>
          )}
        </div>
      )}

      <div className="border-t border-slate-200 pt-4">
        <div className="mb-3 flex items-center justify-between text-sm">
          <span className="text-slate-600">
            {qty} × {formatCents(priceCents)}
            {withInstall && shop ? " + install" : ""}
          </span>
          <span className="text-lg font-bold text-slate-900">
            {formatCents(priceCents * qty + (withInstall ? installTotal : 0))}
          </span>
        </div>

        {needsForce ? (
          <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3">
            <p className="text-sm text-amber-800">
              This part may not fit your selected vehicle. Add it anyway?
            </p>
            <div className="flex gap-2">
              <button type="button" className="btn-primary" disabled={busy} onClick={() => addToCart(true)}>
                Add anyway
              </button>
              <button type="button" className="btn-secondary" onClick={() => setNeedsForce(false)}>
                Never mind
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="btn-primary w-full"
            disabled={busy || !inStock}
            onClick={() => addToCart(false)}
          >
            {!inStock ? "Out of stock" : busy ? "Adding…" : "Add to cart"}
          </button>
        )}
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      </div>
    </div>
  );
}
