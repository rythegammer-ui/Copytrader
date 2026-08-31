"use client";

/**
 * Admin order-level actions: cancel with a required reason (API enforces the
 * pre-FULFILLED rule), and retry a refund on a cancelled-but-unrefunded order
 * (custom refund of the exact remaining balance).
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatCents } from "@/lib/money";

async function readError(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { error?: { message?: string } };
    return data.error?.message ?? `Request failed (${res.status})`;
  } catch {
    return `Request failed (${res.status})`;
  }
}

export function AdminCancelButton({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cancel = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/orders/${orderId}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      if (!res.ok) {
        setError(await readError(res));
        return;
      }
      setOpen(false);
      router.refresh();
    } catch {
      setError("Network error");
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button type="button" className="btn-danger" onClick={() => setOpen(true)}>
        Cancel order…
      </button>
    );
  }
  return (
    <div className="w-full max-w-sm rounded-lg border border-red-200 bg-red-50 p-3">
      <p className="mb-2 text-sm font-medium text-red-800">
        Cancel this order? Any remaining balance is auto-refunded.
      </p>
      <input
        className="input"
        placeholder="Reason (required)"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
      <div className="mt-2 flex justify-end gap-2">
        <button
          type="button"
          className="btn-secondary"
          onClick={() => setOpen(false)}
          disabled={busy}
        >
          Keep order
        </button>
        <button
          type="button"
          className="btn-danger"
          disabled={busy || reason.trim() === ""}
          onClick={cancel}
        >
          {busy ? "Cancelling…" : "Confirm cancel"}
        </button>
      </div>
    </div>
  );
}

export function RetryRefundButton({
  orderId,
  remainingCents,
}: {
  orderId: string;
  remainingCents: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const retry = async () => {
    if (!window.confirm(`Refund the remaining ${formatCents(remainingCents)} to the customer?`)) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/orders/${orderId}/refunds`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customAmountCents: remainingCents,
          reason: "Retry refund — order cancelled but previous refund failed",
        }),
      });
      if (!res.ok) {
        setError(await readError(res));
        return;
      }
      router.refresh();
    } catch {
      setError("Network error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <button type="button" className="btn-danger" disabled={busy} onClick={retry}>
        {busy ? "Refunding…" : `Retry refund (${formatCents(remainingCents)})`}
      </button>
      {error && <p className="text-xs text-red-700">{error}</p>}
    </div>
  );
}
