"use client";

import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatCents } from "@/lib/money";

export interface AddressOption {
  id: string;
  label: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  zip: string;
  isDefault: boolean;
}

export interface ShipmentGroupView {
  key: string;
  supplierName: string;
  destLabel: string; // "Your address" or the shop name
  shippingCents: number;
  items: { name: string; qty: number; lineTotalCents: number }[];
}

export interface AppointmentGroupView {
  key: string;
  shopName: string;
  timeLabel: string; // pre-formatted shop-local time
  laborTotalCents: number;
  itemNames: string[];
  shipToShop: boolean;
}

export interface CheckoutTotalsView {
  partsSubtotalCents: number;
  installSubtotalCents: number;
  shippingTotalCents: number;
  taxCents: number;
  totalCents: number;
}

const CART_CONFLICT_CODES = new Set([
  "SLOT_TAKEN",
  "SLOT_INFEASIBLE",
  "OUT_OF_STOCK",
  "PART_UNAVAILABLE",
  "NOT_INSTALLABLE",
  "INSTALL_INCOMPLETE",
  "SHIP_TO_SHOP_NEEDS_INSTALL",
  "SHOP_UNAVAILABLE",
  "EMPTY_CART",
  "QUOTE_MISMATCH",
]);

export function CheckoutForm({
  addresses,
  userName,
  defaultPhone,
  groups,
  appointments,
  totals,
}: {
  addresses: AddressOption[];
  userName: string;
  defaultPhone: string;
  groups: ShipmentGroupView[];
  appointments: AppointmentGroupView[];
  totals: CheckoutTotalsView;
}) {
  const router = useRouter();
  const defaultAddress = addresses.find((a) => a.isDefault) ?? addresses[0] ?? null;
  const [selectedId, setSelectedId] = useState<string>(defaultAddress ? defaultAddress.id : "new");
  const [name, setName] = useState(userName);
  const [line1, setLine1] = useState("");
  const [line2, setLine2] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [zip, setZip] = useState("");
  const [phone, setPhone] = useState(defaultPhone);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  // One idempotency key per checkout attempt session: double-clicks and
  // network retries replay the same order instead of creating duplicates.
  const idempotencyKeyRef = useRef<string | null>(null);

  const usingNew = selectedId === "new";
  const newAddressComplete =
    name.trim() && line1.trim() && city.trim() && /^[A-Za-z]{2}$/.test(state.trim()) && zip.trim();

  const placeOrder = useCallback(async () => {
    setError(null);
    if (usingNew && !newAddressComplete) {
      setError({ code: "VALIDATION", message: "Fill in the shipping address (2-letter state)." });
      return;
    }
    if (!idempotencyKeyRef.current) idempotencyKeyRef.current = crypto.randomUUID();
    setPending(true);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(usingNew
            ? {
                address: {
                  name: name.trim(),
                  line1: line1.trim(),
                  ...(line2.trim() ? { line2: line2.trim() } : {}),
                  city: city.trim(),
                  state: state.trim(),
                  zip: zip.trim(),
                },
              }
            : { addressId: selectedId }),
          ...(phone.trim() ? { contactPhone: phone.trim() } : {}),
          idempotencyKey: idempotencyKeyRef.current,
        }),
      });
      const data = (await res.json().catch(() => null)) as
        | { orderId?: string; error?: { code?: string; message?: string } }
        | null;
      if (res.ok && data?.orderId) {
        router.push(`/checkout/pay/${data.orderId}`);
        return;
      }
      setError({
        code: data?.error?.code ?? "ERROR",
        message: data?.error?.message ?? "Could not place the order",
      });
      setPending(false);
    } catch {
      setError({ code: "NETWORK", message: "Could not place the order — check your connection" });
      setPending(false);
    }
  }, [usingNew, newAddressComplete, name, line1, line2, city, state, zip, phone, selectedId, router]);

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
      <div className="space-y-6">
        {/* ---- Shipping address ---- */}
        <section className="card p-5">
          <h2 className="mb-4 text-lg font-bold text-slate-900">Shipping address</h2>
          <div className="space-y-2">
            {addresses.map((a) => (
              <label
                key={a.id}
                className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm ${
                  selectedId === a.id ? "border-brand-500 bg-brand-50" : "border-slate-200"
                }`}
              >
                <input
                  type="radio"
                  name="co-address"
                  className="mt-0.5 h-4 w-4 border-slate-300 text-brand-600 focus:ring-brand-500"
                  checked={selectedId === a.id}
                  onChange={() => setSelectedId(a.id)}
                />
                <span>
                  <span className="font-semibold text-slate-900">{a.label}</span>
                  {a.isDefault && (
                    <span className="badge ml-2 bg-brand-100 text-brand-800">Default</span>
                  )}
                  <span className="mt-0.5 block text-slate-600">
                    {a.line1}
                    {a.line2 ? `, ${a.line2}` : ""}, {a.city}, {a.state} {a.zip}
                  </span>
                </span>
              </label>
            ))}
            <label
              className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm ${
                usingNew ? "border-brand-500 bg-brand-50" : "border-slate-200"
              }`}
            >
              <input
                type="radio"
                name="co-address"
                className="h-4 w-4 border-slate-300 text-brand-600 focus:ring-brand-500"
                checked={usingNew}
                onChange={() => setSelectedId("new")}
              />
              <span className="font-semibold text-slate-900">
                {addresses.length > 0 ? "Use a different address" : "Enter your address"}
              </span>
            </label>
          </div>

          {usingNew && (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="label" htmlFor="co-name">
                  Full name
                </label>
                <input
                  id="co-name"
                  className="input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="sm:col-span-2">
                <label className="label" htmlFor="co-line1">
                  Address line 1
                </label>
                <input
                  id="co-line1"
                  className="input"
                  value={line1}
                  onChange={(e) => setLine1(e.target.value)}
                />
              </div>
              <div className="sm:col-span-2">
                <label className="label" htmlFor="co-line2">
                  Address line 2 <span className="font-normal text-slate-400">(optional)</span>
                </label>
                <input
                  id="co-line2"
                  className="input"
                  value={line2}
                  onChange={(e) => setLine2(e.target.value)}
                />
              </div>
              <div>
                <label className="label" htmlFor="co-city">
                  City
                </label>
                <input
                  id="co-city"
                  className="input"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label" htmlFor="co-state">
                    State
                  </label>
                  <input
                    id="co-state"
                    className="input"
                    maxLength={2}
                    placeholder="CA"
                    value={state}
                    onChange={(e) => setState(e.target.value.toUpperCase())}
                  />
                </div>
                <div>
                  <label className="label" htmlFor="co-zip">
                    ZIP
                  </label>
                  <input
                    id="co-zip"
                    className="input"
                    value={zip}
                    onChange={(e) => setZip(e.target.value)}
                  />
                </div>
              </div>
            </div>
          )}

          <div className="mt-4">
            <label className="label" htmlFor="co-phone">
              Contact phone <span className="font-normal text-slate-400">(for the shop)</span>
            </label>
            <input
              id="co-phone"
              className="input sm:max-w-xs"
              type="tel"
              placeholder="(555) 555-0123"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>
        </section>

        {/* ---- Review: shipment groups ---- */}
        <section className="space-y-3">
          <h2 className="text-lg font-bold text-slate-900">Shipments</h2>
          {groups.map((g) => (
            <div key={g.key} className="card p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-slate-900">
                  📦 {g.supplierName} <span className="font-normal text-slate-500">ships to</span>{" "}
                  {g.destLabel}
                </p>
                {g.shippingCents === 0 ? (
                  <span className="badge bg-green-100 text-green-800">FREE shipping</span>
                ) : (
                  <span className="text-sm font-medium text-slate-700">
                    Shipping {formatCents(g.shippingCents)}
                  </span>
                )}
              </div>
              <ul className="mt-2 space-y-1 text-sm text-slate-600">
                {g.items.map((it, idx) => (
                  <li key={idx} className="flex justify-between gap-4">
                    <span>
                      {it.name} × {it.qty}
                    </span>
                    <span className="font-medium text-slate-900">
                      {formatCents(it.lineTotalCents)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>

        {/* ---- Review: appointments ---- */}
        {appointments.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-lg font-bold text-slate-900">Installation appointments</h2>
            {appointments.map((a) => (
              <div key={a.key} className="card p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-slate-900">
                    🔧 {a.shopName} <span className="font-normal text-slate-500">·</span>{" "}
                    {a.timeLabel}
                  </p>
                  <span className="text-sm font-medium text-slate-700">
                    Labor {formatCents(a.laborTotalCents)}
                  </span>
                </div>
                <p className="mt-1 text-sm text-slate-600">{a.itemNames.join(", ")}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {a.shipToShop
                    ? "Parts ship straight to the shop — the appointment is confirmed once the shop receives them."
                    : "Parts ship to your address — bring them with you to the appointment."}
                </p>
              </div>
            ))}
          </section>
        )}
      </div>

      {/* ---- Totals + place order ---- */}
      <div>
        <div className="card sticky top-6 p-5">
          <h2 className="mb-4 text-lg font-bold text-slate-900">Total</h2>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-600">Parts</dt>
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
            <div className="flex justify-between">
              <dt className="text-slate-600">Shipping</dt>
              <dd className="font-medium text-slate-900">
                {totals.shippingTotalCents === 0 ? (
                  <span className="badge bg-green-100 text-green-800">FREE</span>
                ) : (
                  formatCents(totals.shippingTotalCents)
                )}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-600">Tax</dt>
              <dd className="font-medium text-slate-900">{formatCents(totals.taxCents)}</dd>
            </div>
            <div className="flex justify-between border-t border-slate-200 pt-2 text-base">
              <dt className="font-bold text-slate-900">Due now</dt>
              <dd className="font-bold text-slate-900">{formatCents(totals.totalCents)}</dd>
            </div>
          </dl>

          <button
            type="button"
            className="btn-primary mt-5 w-full"
            disabled={pending}
            onClick={placeOrder}
          >
            {pending ? "Placing order…" : `Place order & pay ${formatCents(totals.totalCents)}`}
          </button>

          {error && (
            <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800">
              <p>{error.message}</p>
              {CART_CONFLICT_CODES.has(error.code) && (
                <Link href="/cart" className="mt-1 inline-block font-semibold underline">
                  Back to cart to fix it
                </Link>
              )}
            </div>
          )}
          <p className="mt-3 text-center text-xs text-slate-500">
            One payment covers parts, shipping, labor and tax.
          </p>
        </div>
      </div>
    </div>
  );
}
