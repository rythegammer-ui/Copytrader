"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { ShipTo } from "@/lib/enums";
import { formatShopTime } from "@/lib/format";
import { formatCents } from "@/lib/money";
import { InstallDefaultsPicker } from "@/components/checkout/InstallDefaultsPicker";

export interface CartLineView {
  id: string;
  slug: string;
  name: string;
  imageUrl: string;
  priceCents: number;
  qty: number;
  lineTotalCents: number;
  withInstall: boolean;
  installEligible: boolean;
  installerName: string | null;
  tzOffsetMinutes: number | null;
  apptStartAt: string | null;
  shipTo: string;
  installTotalCents: number;
  verdict: "FITS" | "VERIFY_ENGINE" | "NO_FIT" | "UNIVERSAL" | null;
}

export interface CartGroupView {
  key: string;
  supplierName: string;
  shipTo: string;
  installerName: string | null;
  shippingCents: number;
}

export interface CartTotalsView {
  partsSubtotalCents: number;
  installSubtotalCents: number;
  groups: CartGroupView[];
  shippingTotalCents: number;
  taxCents: number;
  totalCents: number;
}

export function CartView({
  lines,
  vehicleLabel,
  totals,
  quoteError,
  signedIn,
  installHelper,
}: {
  lines: CartLineView[];
  vehicleLabel: string | null;
  totals: CartTotalsView | null;
  quoteError: string | null;
  signedIn: boolean;
  installHelper: { eligibleCount: number; totalLaborTenths: number; maxLeadDays: number };
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mutate = useCallback(
    async (itemId: string, method: "PATCH" | "DELETE", body?: unknown) => {
      setBusyId(itemId);
      setError(null);
      try {
        const res = await fetch(`/api/cart/items/${encodeURIComponent(itemId)}`, {
          method,
          headers: { "Content-Type": "application/json" },
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => null)) as {
            error?: { message?: string };
          } | null;
          setError(data?.error?.message ?? "Could not update your cart");
        }
        router.refresh();
      } catch {
        setError("Could not update your cart");
      } finally {
        setBusyId(null);
      }
    },
    [router],
  );

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
      <div className="space-y-4">
        {error && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </p>
        )}

        {lines.map((line) => {
          const busy = busyId === line.id;
          return (
            <div key={line.id} className="card p-4">
              <div className="flex gap-4">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={line.imageUrl}
                  alt={line.name}
                  className="h-20 w-20 flex-shrink-0 rounded-lg border border-slate-200 object-cover"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <Link
                        href={`/parts/${line.slug}`}
                        className="font-semibold text-slate-900 hover:text-brand-700"
                      >
                        {line.name}
                      </Link>
                      <p className="mt-0.5 text-sm text-slate-500">
                        {formatCents(line.priceCents)} each
                      </p>
                    </div>
                    <p className="font-semibold text-slate-900">
                      {formatCents(line.lineTotalCents)}
                    </p>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-4">
                    <div className="inline-flex items-center rounded-lg border border-slate-300">
                      <button
                        type="button"
                        aria-label="Decrease quantity"
                        className="px-2.5 py-1 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                        disabled={busy || line.qty <= 1}
                        onClick={() => mutate(line.id, "PATCH", { qty: line.qty - 1 })}
                      >
                        −
                      </button>
                      <span className="min-w-[2rem] border-x border-slate-300 px-2 py-1 text-center text-sm font-medium">
                        {line.qty}
                      </span>
                      <button
                        type="button"
                        aria-label="Increase quantity"
                        className="px-2.5 py-1 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                        disabled={busy || line.qty >= 10}
                        onClick={() => mutate(line.id, "PATCH", { qty: line.qty + 1 })}
                      >
                        +
                      </button>
                    </div>
                    <button
                      type="button"
                      className="text-sm font-medium text-slate-500 hover:text-red-600 hover:underline disabled:opacity-50"
                      disabled={busy}
                      onClick={() => mutate(line.id, "DELETE")}
                    >
                      Remove
                    </button>
                  </div>

                  {line.verdict === "NO_FIT" && vehicleLabel && (
                    <p className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-800">
                      ✕ May not fit your {vehicleLabel} — double-check before checking out.
                    </p>
                  )}
                  {line.verdict === "VERIFY_ENGINE" && vehicleLabel && (
                    <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800">
                      ⚠ Fits your {vehicleLabel} only for specific engines — verify your engine.
                    </p>
                  )}
                </div>
              </div>

              {line.withInstall && line.installerName && (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-brand-100 bg-brand-50 px-3 py-2.5">
                  <div className="text-sm text-slate-700">
                    <p className="font-semibold text-slate-900">
                      🔧 Installation at {line.installerName}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-600">
                      {line.apptStartAt && line.tzOffsetMinutes != null
                        ? formatShopTime(line.apptStartAt, line.tzOffsetMinutes)
                        : "Time to be confirmed"}
                      {" · "}
                      {line.shipTo === ShipTo.INSTALLER
                        ? "parts ship to the shop"
                        : "ships to you — bring the part along"}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-semibold text-slate-900">
                      {formatCents(line.installTotalCents)}
                    </span>
                    <Link
                      href={`/parts/${line.slug}`}
                      className="text-xs font-medium text-brand-700 hover:underline"
                    >
                      Edit
                    </Link>
                    <button
                      type="button"
                      className="text-xs font-medium text-slate-500 hover:text-red-600 hover:underline disabled:opacity-50"
                      disabled={busy}
                      onClick={() => mutate(line.id, "PATCH", { withInstall: false })}
                    >
                      Remove install
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {installHelper.eligibleCount > 0 && (
          <InstallDefaultsPicker
            eligibleCount={installHelper.eligibleCount}
            totalLaborTenths={installHelper.totalLaborTenths}
            maxLeadDays={installHelper.maxLeadDays}
          />
        )}
      </div>

      <div>
        <div className="card sticky top-6 p-5">
          <h2 className="mb-4 text-lg font-bold text-slate-900">Order summary</h2>

          {quoteError && (
            <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
              <p className="font-semibold">Something needs your attention</p>
              <p className="mt-1">{quoteError}</p>
              <p className="mt-1 text-xs">
                Fix the items above — pick a different appointment time or remove unavailable
                parts — then totals and checkout will unlock.
              </p>
            </div>
          )}

          {totals ? (
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-slate-600">Parts subtotal</dt>
                <dd className="font-medium text-slate-900">
                  {formatCents(totals.partsSubtotalCents)}
                </dd>
              </div>
              {totals.installSubtotalCents > 0 && (
                <div className="flex justify-between">
                  <dt className="text-slate-600">Installation labor (tax-free)</dt>
                  <dd className="font-medium text-slate-900">
                    {formatCents(totals.installSubtotalCents)}
                  </dd>
                </div>
              )}
              {totals.groups.map((g) => (
                <div key={g.key} className="flex justify-between">
                  <dt className="text-slate-600">
                    Shipping — {g.supplierName} →{" "}
                    {g.shipTo === ShipTo.INSTALLER ? g.installerName ?? "shop" : "you"}
                  </dt>
                  <dd className="font-medium text-slate-900">
                    {g.shippingCents === 0 ? (
                      <span className="badge bg-green-100 text-green-800">FREE</span>
                    ) : (
                      formatCents(g.shippingCents)
                    )}
                  </dd>
                </div>
              ))}
              <div className="flex justify-between">
                <dt className="text-slate-600">Tax</dt>
                <dd className="font-medium text-slate-900">{formatCents(totals.taxCents)}</dd>
              </div>
              <div className="flex justify-between border-t border-slate-200 pt-2 text-base">
                <dt className="font-bold text-slate-900">Total</dt>
                <dd className="font-bold text-slate-900">{formatCents(totals.totalCents)}</dd>
              </div>
            </dl>
          ) : (
            !quoteError && <p className="text-sm text-slate-500">Totals unavailable.</p>
          )}

          <Link
            href={signedIn ? "/checkout" : "/login?next=%2Fcheckout"}
            className={`btn-primary mt-5 w-full ${totals ? "" : "pointer-events-none opacity-50"}`}
            aria-disabled={!totals}
          >
            {signedIn ? "Check out" : "Sign in to check out"}
          </Link>
          <p className="mt-2 text-center text-xs text-slate-500">
            Parts, shipping, labor and tax — one payment.
          </p>
        </div>
      </div>
    </div>
  );
}
