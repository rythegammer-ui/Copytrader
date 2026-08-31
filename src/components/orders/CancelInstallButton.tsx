"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatCents } from "@/lib/money";

/**
 * Cancels ONLY the installation on an appointment (parts still ship).
 * Visible >= 24h before the slot; the labor charge is auto-refunded.
 */
export function CancelInstallButton({
  appointmentId,
  refundCents,
}: {
  appointmentId: string;
  refundCents: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onCancel() {
    const ok = window.confirm(
      `Cancel the installation? Your labor charge of ${formatCents(refundCents)} will be refunded. ` +
        "Your parts still ship as ordered.",
    );
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/appointments/${appointmentId}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        let msg = "Could not cancel the installation";
        try {
          const data = (await res.json()) as { error?: { message?: string } };
          if (data.error?.message) msg = data.error.message;
        } catch {
          /* non-JSON error body */
        }
        setError(msg);
        return;
      }
      router.refresh();
    } catch {
      setError("Network error — please try again");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="inline-flex flex-col items-start gap-1">
      <button type="button" className="btn-secondary text-red-700" onClick={onCancel} disabled={busy}>
        {busy ? "Cancelling…" : "Cancel install"}
      </button>
      <p className="text-xs text-slate-500">
        Cancelling refunds the {formatCents(refundCents)} labor charge.
      </p>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
