"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { formatCents } from "@/lib/money";

/**
 * Demo-mode payment form (used when Stripe isn't configured). Any card values
 * work — the buttons drive /api/payments/mock/confirm, which runs the exact
 * same idempotent payment handlers as the Stripe webhook.
 */
export function MockPaymentForm({
  intentId,
  amountCents,
  orderId,
}: {
  intentId: string;
  amountCents: number;
  orderId: string;
}) {
  const router = useRouter();
  const [card, setCard] = useState("4242 4242 4242 4242");
  const [expiry, setExpiry] = useState("12 / 30");
  const [cvc, setCvc] = useState("123");
  const [busy, setBusy] = useState<"succeed" | "fail" | null>(null);
  const [declined, setDeclined] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = useCallback(
    async (outcome: "succeed" | "fail") => {
      setBusy(outcome);
      setError(null);
      setDeclined(false);
      try {
        const res = await fetch("/api/payments/mock/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ intentId, outcome }),
        });
        const data = (await res.json().catch(() => null)) as
          | { next?: string; error?: { message?: string } }
          | null;
        if (res.ok && outcome === "succeed") {
          router.push(data?.next ?? `/checkout/success/${orderId}`);
          return;
        }
        if (res.ok && outcome === "fail") {
          setDeclined(true);
          router.refresh(); // server now shows the failed state + retry
          return;
        }
        setError(data?.error?.message ?? "Payment could not be confirmed");
      } catch {
        setError("Payment could not be confirmed");
      } finally {
        setBusy(null);
      }
    },
    [intentId, orderId, router],
  );

  return (
    <div className="card p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-bold text-slate-900">Card payment</h2>
        <span className="badge bg-amber-100 text-amber-800">DEMO MODE — no real charge</span>
      </div>

      <div className="space-y-3">
        <div>
          <label className="label" htmlFor="mp-card">
            Card number
          </label>
          <input
            id="mp-card"
            className="input font-mono"
            inputMode="numeric"
            autoComplete="off"
            value={card}
            onChange={(e) => setCard(e.target.value)}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="mp-exp">
              Expiry
            </label>
            <input
              id="mp-exp"
              className="input font-mono"
              autoComplete="off"
              value={expiry}
              onChange={(e) => setExpiry(e.target.value)}
            />
          </div>
          <div>
            <label className="label" htmlFor="mp-cvc">
              CVC
            </label>
            <input
              id="mp-cvc"
              className="input font-mono"
              autoComplete="off"
              value={cvc}
              onChange={(e) => setCvc(e.target.value)}
            />
          </div>
        </div>
      </div>

      {declined && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800">
          <p className="font-semibold">Card declined (simulated)</p>
          <p className="mt-1">
            The payment failed. Use the retry button to start a new payment attempt.
          </p>
        </div>
      )}
      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      <button
        type="button"
        className="btn-primary mt-5 w-full text-base"
        disabled={busy !== null}
        onClick={() => confirm("succeed")}
      >
        {busy === "succeed" ? "Processing…" : `Pay ${formatCents(amountCents)}`}
      </button>
      <button
        type="button"
        className="btn-secondary mt-2 w-full"
        disabled={busy !== null}
        onClick={() => confirm("fail")}
      >
        {busy === "fail" ? "Simulating…" : "Simulate declined card"}
      </button>
      <p className="mt-3 text-center text-xs text-slate-500">
        Any card values work here. This demo checkout charges nothing.
      </p>
    </div>
  );
}
