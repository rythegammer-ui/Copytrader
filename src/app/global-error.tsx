"use client";

import { SHOP_PHONE_DISPLAY, SHOP_PHONE_TEL } from "@/lib/shop-contact";

/**
 * Last-resort boundary: catches failures in the root layout itself, which the
 * per-route boundary in error.tsx cannot, because that one renders *inside*
 * the layout that just failed.
 *
 * This replaces the root layout, so it has to supply its own <html> and <body>.
 * Everything is inline-styled on purpose — a boundary that depends on the
 * stylesheet loading is a boundary that shows an unreadable page on exactly the
 * failure it exists to handle.
 *
 * Next's `reset` is deliberately unused here. It only clears error state and
 * re-renders from the client router cache, which at this level means rebuilding
 * the very layout that just failed from the same payload — a button that cannot
 * work. A full reload genuinely refetches everything, and the home link is the
 * escape hatch for when the reload lands on the same failure.
 */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "24px",
          fontFamily: "system-ui,-apple-system,Segoe UI,sans-serif",
          background: "#f8fafc",
          color: "#0f172a",
        }}
      >
        <main style={{ maxWidth: "32rem", textAlign: "center" }}>
          <p style={{ fontWeight: 800, letterSpacing: "0.08em", color: "#1d4ed8", margin: 0 }}>
            PRINCIPE PERFORMANCE &amp; PARTS
          </p>
          <h1 style={{ fontSize: "1.5rem", margin: "12px 0 0" }}>The site hit a snag</h1>
          <p style={{ color: "#475569", lineHeight: 1.6 }}>
            We&apos;re having a brief problem loading the store. Please try again in a moment.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              marginTop: "8px",
              padding: "10px 20px",
              borderRadius: "8px",
              border: 0,
              background: "#1d4ed8",
              color: "#fff",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Reload the page
          </button>
          <p style={{ marginTop: "16px", fontSize: "0.875rem" }}>
            <a href="/" style={{ color: "#1d4ed8", fontWeight: 600 }}>
              Go to the home page
            </a>
          </p>
          <p style={{ marginTop: "28px", fontSize: "0.875rem", color: "#475569" }}>
            Parts are always available by phone:{" "}
            <a href={`tel:${SHOP_PHONE_TEL}`} style={{ color: "#1d4ed8", fontWeight: 600 }}>
              {SHOP_PHONE_DISPLAY}
            </a>
          </p>
          {error.digest && (
            <p style={{ fontSize: "0.75rem", color: "#94a3b8" }}>Reference {error.digest}</p>
          )}
        </main>
      </body>
    </html>
  );
}
