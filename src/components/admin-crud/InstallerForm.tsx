"use client";

/**
 * Create/edit form for installer shops. Hours are HH:MM selects mapped to
 * minutes-from-midnight; open days are checkboxes mapped to the Sun=1..Sat=64
 * bitmask; timezone is a fixed-offset select (ET/CT/MT/PT).
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  centsToDollarInput,
  DAY_OPTIONS,
  minutesToHHMM,
  parseDollars,
  parseIntField,
  sendJson,
  TIME_OPTIONS,
  TZ_OPTIONS,
  type InstallerFormInitial,
} from "@/components/admin-crud/crud-shared";

interface InstallerFormProps {
  mode: "create" | "edit";
  installerId?: string;
  initial?: InstallerFormInitial;
  collapsible?: boolean;
}

const SLOT_OPTIONS = [30, 60, 90, 120, 180, 240];

export function InstallerForm({ mode, installerId, initial, collapsible }: InstallerFormProps) {
  const router = useRouter();
  const [open, setOpen] = useState(!collapsible);
  const [name, setName] = useState(initial?.name ?? "");
  const [slug, setSlug] = useState(initial?.slug ?? "");
  const [rate, setRate] = useState(centsToDollarInput(initial?.hourlyRateCents ?? 12000));
  const [line1, setLine1] = useState(initial?.line1 ?? "");
  const [city, setCity] = useState(initial?.city ?? "");
  const [state, setState] = useState(initial?.state ?? "");
  const [zip, setZip] = useState(initial?.zip ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [bays, setBays] = useState(String(initial?.bays ?? 2));
  const [openMinutes, setOpenMinutes] = useState(initial?.openMinutes ?? 480);
  const [closeMinutes, setCloseMinutes] = useState(initial?.closeMinutes ?? 1080);
  const [slotMinutes, setSlotMinutes] = useState(initial?.slotMinutes ?? 120);
  const [daysMask, setDaysMask] = useState(initial?.daysOpenMask ?? 62);
  const [tzOffset, setTzOffset] = useState(initial?.tzOffsetMinutes ?? -360);
  const [active, setActive] = useState(initial?.active ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const toggleDay = (bit: number) => {
    setDaysMask((m) => (m & bit ? m & ~bit : m | bit));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaved(false);

    const hourlyRateCents = parseDollars(rate);
    const baysNum = parseIntField(bays);
    if (hourlyRateCents === null || hourlyRateCents <= 0) return setError("Enter a valid hourly rate.");
    if (baysNum === null || baysNum <= 0) return setError("Enter the number of bays (≥ 1).");
    if (closeMinutes <= openMinutes) return setError("Closing time must be after opening time.");
    if (daysMask === 0) return setError("Pick at least one open day.");
    if (state.trim().length !== 2) return setError("State must be a 2-letter code.");

    const body = {
      name: name.trim(),
      slug: slug.trim(),
      hourlyRateCents,
      line1: line1.trim(),
      city: city.trim(),
      state: state.trim(),
      zip: zip.trim(),
      phone: phone.trim() || null,
      bays: baysNum,
      openMinutes,
      closeMinutes,
      slotMinutes,
      daysOpenMask: daysMask,
      tzOffsetMinutes: tzOffset,
      active,
    };

    setBusy(true);
    const res =
      mode === "create"
        ? await sendJson<{ id: string }>("/api/admin/installers", "POST", body)
        : await sendJson<{ id: string }>(`/api/admin/installers/${installerId}`, "PATCH", body);
    setBusy(false);

    if (!res.ok) {
      setError(res.error);
      return;
    }
    if (mode === "create" && res.data) {
      router.push(`/admin/installers/${res.data.id}`);
      router.refresh();
      return;
    }
    setSaved(true);
    router.refresh();
  };

  if (!open) {
    return (
      <button type="button" className="btn-primary" onClick={() => setOpen(true)}>
        + New installer shop
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="card p-5">
      {mode === "create" && (
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">New installer shop</h2>
          {collapsible && (
            <button type="button" className="text-sm text-slate-500 hover:underline" onClick={() => setOpen(false)}>
              Close
            </button>
          )}
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="if-name">Name</label>
          <input id="if-name" className="input" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div>
          <label className="label" htmlFor="if-slug">Slug</label>
          <input id="if-slug" className="input" value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="precision-auto" required />
        </div>
        <div>
          <label className="label" htmlFor="if-rate">Hourly rate ($/hr)</label>
          <input id="if-rate" className="input" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} required />
        </div>
        <div>
          <label className="label" htmlFor="if-phone">Phone (optional)</label>
          <input id="if-phone" className="input" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="if-line1">Street address</label>
          <input id="if-line1" className="input" value={line1} onChange={(e) => setLine1(e.target.value)} required />
        </div>
        <div>
          <label className="label" htmlFor="if-city">City</label>
          <input id="if-city" className="input" value={city} onChange={(e) => setCity(e.target.value)} required />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="if-state">State</label>
            <input id="if-state" className="input" maxLength={2} value={state} onChange={(e) => setState(e.target.value.toUpperCase())} required />
          </div>
          <div>
            <label className="label" htmlFor="if-zip">ZIP</label>
            <input id="if-zip" className="input" value={zip} onChange={(e) => setZip(e.target.value)} required />
          </div>
        </div>
        <div>
          <label className="label" htmlFor="if-bays">Bays (capacity per block)</label>
          <input id="if-bays" className="input" inputMode="numeric" value={bays} onChange={(e) => setBays(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="if-slot">Slot length</label>
          <select id="if-slot" className="input" value={slotMinutes} onChange={(e) => setSlotMinutes(Number(e.target.value))}>
            {SLOT_OPTIONS.map((m) => (
              <option key={m} value={m}>{m} minutes</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="if-open">Opens</label>
          <select id="if-open" className="input" value={openMinutes} onChange={(e) => setOpenMinutes(Number(e.target.value))}>
            {TIME_OPTIONS.map((m) => (
              <option key={m} value={m}>{minutesToHHMM(m)}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="if-close">Closes</label>
          <select id="if-close" className="input" value={closeMinutes} onChange={(e) => setCloseMinutes(Number(e.target.value))}>
            {TIME_OPTIONS.map((m) => (
              <option key={m} value={m}>{minutesToHHMM(m)}</option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <span className="label">Days open</span>
          <div className="flex flex-wrap gap-3">
            {DAY_OPTIONS.map((d) => (
              <label key={d.bit} className="inline-flex items-center gap-1.5 text-sm text-slate-700">
                <input type="checkbox" checked={(daysMask & d.bit) !== 0} onChange={() => toggleDay(d.bit)} />
                {d.label}
              </label>
            ))}
          </div>
        </div>
        <div>
          <label className="label" htmlFor="if-tz">Timezone (fixed offset)</label>
          <select id="if-tz" className="input" value={tzOffset} onChange={(e) => setTzOffset(Number(e.target.value))}>
            {TZ_OPTIONS.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>
        <div className="flex items-end pb-2">
          <label className="inline-flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            Active (bookable)
          </label>
        </div>
      </div>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      {saved && <p className="mt-3 text-sm text-green-700">Saved.</p>}

      <div className="mt-5 flex justify-end">
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? "Saving…" : mode === "create" ? "Create shop" : "Save changes"}
        </button>
      </div>
    </form>
  );
}
