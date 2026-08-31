"use client";

/**
 * Admin override transition control for a purchase order card: pick a target
 * status, supply reason / carrier + tracking where the transition needs them,
 * and POST /api/admin/pos/[id]/transition (always with override:true).
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { POStatus, statusLabel } from "@/lib/enums";

interface Props {
  poId: string;
  status: string; // current POStatus
}

const ALL_TARGETS: string[] = [
  POStatus.CONFIRMED,
  POStatus.REJECTED,
  POStatus.SHIPPED,
  POStatus.DELIVERED,
  POStatus.RECEIVED,
  POStatus.CANCELLED,
];

export function OverrideButtons({ poId, status }: Props) {
  const router = useRouter();
  const [to, setTo] = useState("");
  const [reason, setReason] = useState("");
  const [carrier, setCarrier] = useState("");
  const [trackingNumber, setTrackingNumber] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const targets = ALL_TARGETS.filter((t) => t !== status);
  const needsShipping = to === POStatus.SHIPPED;
  const needsReason = to === POStatus.REJECTED;
  const ready =
    to !== "" &&
    (!needsShipping || (carrier.trim() !== "" && trackingNumber.trim() !== "")) &&
    (!needsReason || reason.trim() !== "");

  const apply = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/pos/${poId}/transition`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to,
          ...(reason.trim() ? { reason: reason.trim() } : {}),
          ...(needsShipping
            ? { carrier: carrier.trim(), trackingNumber: trackingNumber.trim() }
            : {}),
        }),
      });
      if (!res.ok) {
        let msg = `Request failed (${res.status})`;
        try {
          const data = (await res.json()) as { error?: { message?: string } };
          msg = data.error?.message ?? msg;
        } catch {
          /* keep default */
        }
        setError(msg);
        return;
      }
      setTo("");
      setReason("");
      setCarrier("");
      setTrackingNumber("");
      router.refresh();
    } catch {
      setError("Network error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Admin override
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <select
          className="input w-auto"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          aria-label="Target status"
        >
          <option value="">Move to…</option>
          {targets.map((t) => (
            <option key={t} value={t}>
              {statusLabel(t)}
            </option>
          ))}
        </select>
        {needsShipping && (
          <>
            <input
              className="input w-28"
              placeholder="Carrier"
              value={carrier}
              onChange={(e) => setCarrier(e.target.value)}
            />
            <input
              className="input w-40"
              placeholder="Tracking #"
              value={trackingNumber}
              onChange={(e) => setTrackingNumber(e.target.value)}
            />
          </>
        )}
        <input
          className="input min-w-[10rem] flex-1"
          placeholder={needsReason ? "Reason (required)" : "Reason (optional)"}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <button type="button" className="btn-secondary" disabled={!ready || busy} onClick={apply}>
          {busy ? "Applying…" : "Apply"}
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
    </div>
  );
}
