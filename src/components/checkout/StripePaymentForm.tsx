"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatCents } from "@/lib/money";

/**
 * Minimal Stripe.js typings — the library is loaded from js.stripe.com at
 * runtime (per Stripe's terms it must not be bundled), so we declare just the
 * surface we use.
 */
interface StripeJsElement {
  mount: (el: HTMLElement) => void;
  unmount: () => void;
}
interface StripeJsElements {
  create: (type: "payment") => StripeJsElement;
}
interface StripeJsError {
  message?: string;
}
interface StripeJs {
  elements: (opts: { clientSecret: string }) => StripeJsElements;
  confirmPayment: (opts: {
    elements: StripeJsElements;
    confirmParams: { return_url: string };
  }) => Promise<{ error?: StripeJsError }>;
}
type StripeConstructor = (publishableKey: string) => StripeJs;

declare global {
  interface Window {
    Stripe?: StripeConstructor;
  }
}

const SCRIPT_ID = "stripe-js-v3";
const SCRIPT_SRC = "https://js.stripe.com/v3";

export function StripePaymentForm({
  clientSecret,
  orderId,
  amountCents,
}: {
  clientSecret: string;
  orderId: string;
  amountCents: number;
}) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const stripeRef = useRef<StripeJs | null>(null);
  const elementsRef = useRef<StripeJsElements | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;

  useEffect(() => {
    if (!publishableKey) return;
    let element: StripeJsElement | null = null;
    let cancelled = false;

    const init = () => {
      if (cancelled || !window.Stripe || !mountRef.current) return;
      try {
        const stripe = window.Stripe(publishableKey);
        const elements = stripe.elements({ clientSecret });
        element = elements.create("payment");
        element.mount(mountRef.current);
        stripeRef.current = stripe;
        elementsRef.current = elements;
        setReady(true);
      } catch {
        setError("Could not initialize the payment form");
      }
    };

    if (window.Stripe) {
      init();
    } else {
      let script = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
      if (!script) {
        script = document.createElement("script");
        script.id = SCRIPT_ID;
        script.src = SCRIPT_SRC;
        script.async = true;
        document.head.appendChild(script);
      }
      script.addEventListener("load", init);
      script.addEventListener("error", () => {
        if (!cancelled) setError("Could not load Stripe.js — check your connection");
      });
    }

    return () => {
      cancelled = true;
      if (element) {
        try {
          element.unmount();
        } catch {
          // already gone
        }
      }
    };
  }, [publishableKey, clientSecret]);

  const pay = useCallback(async () => {
    const stripe = stripeRef.current;
    const elements = elementsRef.current;
    if (!stripe || !elements) return;
    setBusy(true);
    setError(null);
    try {
      const { error: confirmError } = await stripe.confirmPayment({
        elements,
        confirmParams: {
          return_url: `${window.location.origin}/checkout/success/${orderId}`,
        },
      });
      // On success Stripe redirects; reaching here means it failed.
      if (confirmError) setError(confirmError.message ?? "Payment failed — try again");
    } catch {
      setError("Payment failed — try again");
    } finally {
      setBusy(false);
    }
  }, [orderId]);

  if (!publishableKey) {
    return (
      <div className="card p-6">
        <h2 className="text-lg font-bold text-slate-900">Card payment</h2>
        <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
          Stripe is active on the server but NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is not set, so the
          payment form cannot load. Add the publishable key to your environment and rebuild.
        </p>
      </div>
    );
  }

  return (
    <div className="card p-6">
      <h2 className="mb-4 text-lg font-bold text-slate-900">Card payment</h2>
      <div ref={mountRef} className="min-h-[120px]">
        {!ready && !error && <p className="text-sm text-slate-500">Loading secure payment form…</p>}
      </div>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      <button
        type="button"
        className="btn-primary mt-5 w-full text-base"
        disabled={!ready || busy}
        onClick={pay}
      >
        {busy ? "Processing…" : `Pay ${formatCents(amountCents)}`}
      </button>
      <p className="mt-3 text-center text-xs text-slate-500">
        Payments are processed securely by Stripe.
      </p>
    </div>
  );
}
