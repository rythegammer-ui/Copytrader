"use client";

/**
 * Admin refund composer: pick whole lines and/or install-only portions, see a
 * live breakdown from /refund-preview, optionally override the amount, then
 * confirm → POST /api/admin/orders/[id]/refunds.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { OrderItemStatus } from "@/lib/enums";
import { formatCents } from "@/lib/money";

export interface ComposerItem {
  id: string;
  name: string;
  sku: string;
  qty: number;
  lineTotalCents: number;
  installTotalCents: number;
  withInstall: boolean;
  installRefunded: boolean;
  itemStatus: string; // OrderItemStatus
  poNumber: string | null;
}

interface Preview {
  partsCents: number;
  installCents: number;
  shippingCents: number;
  taxCents: number;
  amountCents: number;
  isFinal: boolean;
}

interface Props {
  orderId: string;
  remainingCents: number; // totalCents - refundedTotalCents
  items: ComposerItem[];
}

async function readError(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { error?: { message?: string } };
    return data.error?.message ?? `Request failed (${res.status})`;
  } catch {
    return `Request failed (${res.status})`;
  }
}

export function RefundComposer({ orderId, remainingCents, items }: Props) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [installOnly, setInstallOnly] = useState<string[]>([]);
  const [customAmount, setCustomAmount] = useState("");
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const liveItems = items.filter((i) => i.itemStatus === OrderItemStatus.PENDING);
  const hasSelection = selected.length > 0 || installOnly.length > 0;

  // Custom amount override (dollars input → cents).
  const customCents =
    customAmount.trim() === "" ? null : Math.round(Number(customAmount) * 100);
  const customValid =
    customCents === null || (Number.isFinite(customCents) && customCents > 0 && customCents <= remainingCents);
  const finalAmount = customCents !== null && customValid ? customCents : preview?.amountCents ?? 0;

  useEffect(() => {
    if (!hasSelection) {
      setPreview(null);
      setPreviewError(null);
      return;
    }
    let stale = false;
    const run = async () => {
      try {
        const res = await fetch(`/api/admin/orders/${orderId}/refund-preview`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            items: selected.map((id) => ({ orderItemId: id })),
            installOnlyItemIds: installOnly,
          }),
        });
        if (stale) return;
        if (!res.ok) {
          setPreview(null);
          setPreviewError(await readError(res));
          return;
        }
        setPreview((await res.json()) as Preview);
        setPreviewError(null);
      } catch {
        if (!stale) setPreviewError("Preview failed — network error");
      }
    };
    void run();
    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, selected.join(","), installOnly.join(",")]);

  const toggle = (list: string[], set: (v: string[]) => void, id: string) => {
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  };

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/orders/${orderId}/refunds`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(selected.length > 0
            ? { items: selected.map((id) => ({ orderItemId: id, install: true })) }
            : {}),
          ...(installOnly.length > 0 ? { installOnlyItemIds: installOnly } : {}),
          ...(customCents !== null && customValid ? { customAmountCents: customCents } : {}),
          reason: reason.trim(),
        }),
      });
      if (!res.ok) {
        setError(await readError(res));
        setConfirmOpen(false);
        return;
      }
      setSelected([]);
      setInstallOnly([]);
      setCustomAmount("");
      setReason("");
      setPreview(null);
      setConfirmOpen(false);
      router.refresh();
    } catch {
      setError("Network error — refund not issued");
      setConfirmOpen(false);
    } finally {
      setSubmitting(false);
    }
  };

  if (remainingCents <= 0) {
    return (
      <p className="text-sm text-slate-500">
        This order is fully refunded — nothing left to refund.
      </p>
    );
  }

  const canSubmit =
    reason.trim().length > 0 &&
    customValid &&
    finalAmount > 0 &&
    (hasSelection || customCents !== null) &&
    (!hasSelection || customCents !== null || preview !== null);

  return (
    <div className="space-y-4">
      {liveItems.length > 0 ? (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {liveItems.map((i) => {
            const fullSelected = selected.includes(i.id);
            const canInstallOnly = i.withInstall && !i.installRefunded && !fullSelected;
            return (
              <li key={i.id} className="p-3 text-sm">
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 rounded border-slate-300"
                    checked={fullSelected}
                    onChange={() => {
                      toggle(selected, setSelected, i.id);
                      // Full refund covers install — drop any install-only pick.
                      setInstallOnly((prev) => prev.filter((x) => x !== i.id));
                    }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium text-slate-900">
                        {i.name} <span className="text-slate-400">× {i.qty}</span>
                      </span>
                      <span className="font-semibold text-slate-900">
                        {formatCents(i.lineTotalCents)}
                      </span>
                    </span>
                    <span className="block text-xs text-slate-500">
                      {i.sku}
                      {i.poNumber ? ` · ${i.poNumber}` : ""}
                      {i.withInstall
                        ? ` · install ${formatCents(i.installTotalCents)}${i.installRefunded ? " (already refunded)" : fullSelected ? " (included)" : ""}`
                        : ""}
                    </span>
                  </span>
                </label>
                {canInstallOnly && (
                  <label className="mt-2 flex cursor-pointer items-center gap-3 pl-7 text-xs text-slate-600">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-slate-300"
                      checked={installOnly.includes(i.id)}
                      onChange={() => toggle(installOnly, setInstallOnly, i.id)}
                    />
                    Refund installation only ({formatCents(i.installTotalCents)}) — part still
                    ships
                  </label>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-slate-500">
          No live items left — use a custom amount to refund the remaining balance.
        </p>
      )}

      {/* live preview */}
      {hasSelection && (
        <div className="rounded-lg bg-slate-50 p-3 text-sm">
          {previewError ? (
            <p className="text-red-700">{previewError}</p>
          ) : preview ? (
            <dl className="space-y-1">
              <div className="flex justify-between text-slate-600">
                <dt>Parts</dt>
                <dd>{formatCents(preview.partsCents)}</dd>
              </div>
              <div className="flex justify-between text-slate-600">
                <dt>Installation (untaxed)</dt>
                <dd>{formatCents(preview.installCents)}</dd>
              </div>
              <div className="flex justify-between text-slate-600">
                <dt>Shipping</dt>
                <dd>{formatCents(preview.shippingCents)}</dd>
              </div>
              <div className="flex justify-between text-slate-600">
                <dt>Tax back</dt>
                <dd>{formatCents(preview.taxCents)}</dd>
              </div>
              <div className="flex justify-between border-t border-slate-200 pt-1 font-semibold text-slate-900">
                <dt>Refund total</dt>
                <dd>{formatCents(preview.amountCents)}</dd>
              </div>
              {preview.isFinal && (
                <p className="text-xs text-purple-700">
                  This refunds all remaining value — the order will be marked refunded.
                </p>
              )}
            </dl>
          ) : (
            <p className="text-slate-500">Calculating…</p>
          )}
        </div>
      )}

      <div>
        <label className="label" htmlFor="refund-custom">
          Custom amount override (optional, max {formatCents(remainingCents)})
        </label>
        <input
          id="refund-custom"
          className="input"
          inputMode="decimal"
          placeholder="e.g. 25.00"
          value={customAmount}
          onChange={(e) => setCustomAmount(e.target.value)}
        />
        {!customValid && (
          <p className="mt-1 text-xs text-red-700">
            Enter an amount between $0.01 and {formatCents(remainingCents)}.
          </p>
        )}
        {customCents !== null && customValid && hasSelection && (
          <p className="mt-1 text-xs text-amber-700">
            Overriding the computed amount — items are still flipped per your selection.
          </p>
        )}
      </div>

      <div>
        <label className="label" htmlFor="refund-reason">
          Reason (required)
        </label>
        <input
          id="refund-reason"
          className="input"
          placeholder="Why is this refund being issued?"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>

      {error && <p className="text-sm text-red-700">{error}</p>}

      <button
        type="button"
        className="btn-danger w-full"
        disabled={!canSubmit || submitting}
        onClick={() => setConfirmOpen(true)}
      >
        Refund {finalAmount > 0 ? formatCents(finalAmount) : "…"}
      </button>

      {/* confirm modal */}
      {confirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="card w-full max-w-md p-6">
            <h3 className="text-lg font-semibold text-slate-900">Confirm refund</h3>
            <p className="mt-2 text-sm text-slate-600">
              Refund <span className="font-semibold">{formatCents(finalAmount)}</span> on this
              order? {selected.length > 0 && `${selected.length} line(s) will be marked refunded. `}
              {installOnly.length > 0 && `${installOnly.length} install(s) will be cancelled. `}
              This cannot be undone.
            </p>
            <p className="mt-2 text-sm text-slate-600">
              Reason: <span className="italic">{reason.trim()}</span>
            </p>
            <div className="mt-4 flex justify-end gap-3">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setConfirmOpen(false)}
                disabled={submitting}
              >
                Back
              </button>
              <button type="button" className="btn-danger" onClick={submit} disabled={submitting}>
                {submitting ? "Refunding…" : "Issue refund"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
