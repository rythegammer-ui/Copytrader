"use client";

import Link from "next/link";
import { useEffect } from "react";
import { SHOP_PHONE_DISPLAY, SHOP_PHONE_TEL } from "@/lib/shop-contact";

/**
 * Route-level error boundary.
 *
 * Without this file Next.js renders its own bare crash screen — white page,
 * "Application error: a server-side exception has occurred", and a digest
 * number. A shopper who arrives from a Facebook Marketplace link and sees that
 * leaves and does not come back, and the digest tells them nothing.
 *
 * Every page under the root layout renders inside this boundary, so a failed
 * query anywhere degrades to a page that still has the header, the footer, a
 * retry button and the shop's phone number on it.
 *
 * `reset()` re-renders the segment. That is worth offering because the errors
 * this catches in practice are transient — a database waking from idle, or a
 * schema push running during a deploy — so trying again usually works.
 */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The server only sends a digest to the browser; the message stays server
    // side. Logging here is what connects a customer's report to the server log.
    console.error("Page failed to render", error.digest ?? error.message);
  }, [error]);

  return (
    <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
      <div className="card p-8 text-center">
        <h1 className="text-2xl font-bold text-slate-900">This page didn&apos;t load</h1>
        <p className="mt-3 text-slate-600">
          Something went wrong on our end — not on yours, and nothing you were doing was
          lost. This is usually brief, so trying again is the fastest fix.
        </p>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <button type="button" onClick={reset} className="btn-primary">
            Try again
          </button>
          <Link href="/parts" className="btn-secondary">
            Browse parts
          </Link>
        </div>

        <p className="mt-8 border-t border-slate-200 pt-6 text-sm text-slate-600">
          Need a part now, or want photos of one? Call or text{" "}
          <a href={`tel:${SHOP_PHONE_TEL}`} className="font-semibold text-brand-700">
            {SHOP_PHONE_DISPLAY}
          </a>
          .
        </p>

        {error.digest && (
          <p className="mt-3 text-xs text-slate-400">
            If you call, mentioning reference {error.digest} helps us find it.
          </p>
        )}
      </div>
    </div>
  );
}
