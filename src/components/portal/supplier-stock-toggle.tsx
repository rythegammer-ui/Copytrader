"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * In stock / out of stock toggle for a supplier's own part. Optimistically
 * disabled while the request is in flight; refreshes the page on success.
 */
export function SupplierStockToggle({ partId, inStock }: { partId: string; inStock: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);

  async function toggle() {
    setPending(true);
    setError(false);
    try {
      const res = await fetch("/api/supplier/stock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ partId, inStock: !inStock }),
      });
      if (!res.ok) {
        setError(true);
        return;
      }
      router.refresh();
    } catch {
      setError(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        role="switch"
        aria-checked={inStock}
        disabled={pending}
        onClick={toggle}
        title={inStock ? "Mark out of stock" : "Mark in stock"}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-50 ${
          inStock ? "bg-green-500" : "bg-slate-300"
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition ${
            inStock ? "translate-x-6" : "translate-x-1"
          }`}
        />
      </button>
      <span className={`text-xs font-medium ${inStock ? "text-green-700" : "text-slate-500"}`}>
        {inStock ? "In stock" : "Out of stock"}
      </span>
      {error && <span className="text-xs text-red-600">Failed — retry</span>}
    </span>
  );
}
