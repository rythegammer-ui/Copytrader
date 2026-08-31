"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Cancels a whole order (unpaid orders, or paid orders while every PO is
 * still awaiting supplier confirmation — the server re-checks eligibility).
 */
export function CancelOrderButton({
  orderId,
  confirmText = "Cancel this order? This cannot be undone.",
  label = "Cancel order",
}: {
  orderId: string;
  confirmText?: string;
  label?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onCancel() {
    if (!window.confirm(confirmText)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/orders/${orderId}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        let msg = "Could not cancel the order";
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
    <div className="inline-flex flex-col items-end gap-1">
      <button type="button" className="btn-danger" onClick={onCancel} disabled={busy}>
        {busy ? "Cancelling…" : label}
      </button>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
