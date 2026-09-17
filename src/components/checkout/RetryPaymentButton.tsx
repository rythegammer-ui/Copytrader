"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Starts a fresh payment attempt for an order, then reloads the pay page.
 * A guest passes the order access token, since they have no session.
 */
export function RetryPaymentButton({
  orderId,
  accessToken,
}: {
  orderId: string;
  accessToken?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const retry = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}/retry-payment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(accessToken ? { accessToken } : {}),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        setError(data?.error?.message ?? "Could not start a new payment attempt");
      }
      router.refresh();
    } catch {
      setError("Could not start a new payment attempt");
    } finally {
      setBusy(false);
    }
  }, [orderId, accessToken, router]);

  return (
    <div className="space-y-2">
      <button type="button" className="btn-primary" disabled={busy} onClick={retry}>
        {busy ? "Preparing…" : "Try payment again"}
      </button>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
