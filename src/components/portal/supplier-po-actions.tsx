"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { POStatus } from "@/lib/enums";

const CARRIERS = ["UPS", "FedEx", "USPS", "DHL"] as const;

async function postJson(url: string, body?: unknown): Promise<string | null> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    if (res.ok) return null;
    try {
      const data = (await res.json()) as { error?: { message?: string } };
      return data.error?.message ?? "Something went wrong — please try again";
    } catch {
      return "Something went wrong — please try again";
    }
  } catch {
    return "Network error — please try again";
  }
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="card w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h3 className="font-semibold text-slate-900">{title}</h3>
          <button
            type="button"
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

/**
 * State-appropriate action buttons for one PO on the supplier portal:
 * Confirm / Reject (reason modal) / Ship (carrier + tracking modal) /
 * Mark delivered (demo carrier stand-in). Buttons disable while a request
 * is in flight; the page refreshes after each successful transition.
 */
export function SupplierPoActions({ poId, status }: { poId: string; status: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<"reject" | "ship" | null>(null);
  const [reason, setReason] = useState("");
  const [carrier, setCarrier] = useState<(typeof CARRIERS)[number]>("UPS");
  const [trackingNumber, setTrackingNumber] = useState("");

  async function run(url: string, body?: unknown) {
    setPending(true);
    setError(null);
    const err = await postJson(url, body);
    setPending(false);
    if (err) {
      setError(err);
      return;
    }
    setModal(null);
    setReason("");
    setTrackingNumber("");
    router.refresh();
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        {status === POStatus.PENDING_CONFIRMATION && (
          <>
            <button
              type="button"
              className="btn-primary"
              disabled={pending}
              onClick={() => run(`/api/supplier/pos/${poId}/confirm`)}
            >
              {pending ? "Confirming…" : "Confirm PO"}
            </button>
            <button
              type="button"
              className="btn-danger"
              disabled={pending}
              onClick={() => {
                setError(null);
                setModal("reject");
              }}
            >
              Reject…
            </button>
          </>
        )}
        {status === POStatus.CONFIRMED && (
          <button
            type="button"
            className="btn-primary"
            disabled={pending}
            onClick={() => {
              setError(null);
              setModal("ship");
            }}
          >
            Mark shipped…
          </button>
        )}
        {status === POStatus.SHIPPED && (
          <button
            type="button"
            className="btn-secondary"
            disabled={pending}
            onClick={() => run(`/api/supplier/pos/${poId}/delivered`)}
            title="Demo carrier stand-in — real carrier webhooks are a v2 item"
          >
            {pending ? "Updating…" : "Mark delivered (demo carrier)"}
          </button>
        )}
      </div>
      {error && modal === null && <p className="mt-2 text-sm text-red-600">{error}</p>}

      {modal === "reject" && (
        <Modal title="Reject purchase order" onClose={() => setModal(null)}>
          <label className="label" htmlFor="reject-reason">
            Why are you rejecting this PO?
          </label>
          <textarea
            id="reject-reason"
            className="input min-h-[90px]"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Out of stock until next month"
            maxLength={500}
          />
          <p className="mt-2 text-xs text-slate-500">
            The PartsPro team will be notified and will resolve this with the customer.
          </p>
          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
          <div className="mt-4 flex justify-end gap-3">
            <button type="button" className="btn-secondary" onClick={() => setModal(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-danger"
              disabled={pending || reason.trim().length < 3}
              onClick={() => run(`/api/supplier/pos/${poId}/reject`, { reason: reason.trim() })}
            >
              {pending ? "Rejecting…" : "Reject PO"}
            </button>
          </div>
        </Modal>
      )}

      {modal === "ship" && (
        <Modal title="Mark as shipped" onClose={() => setModal(null)}>
          <label className="label" htmlFor="ship-carrier">
            Carrier
          </label>
          <select
            id="ship-carrier"
            className="input"
            value={carrier}
            onChange={(e) => setCarrier(e.target.value as (typeof CARRIERS)[number])}
          >
            {CARRIERS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <label className="label mt-3" htmlFor="ship-tracking">
            Tracking number
          </label>
          <input
            id="ship-tracking"
            className="input"
            value={trackingNumber}
            onChange={(e) => setTrackingNumber(e.target.value)}
            placeholder="1Z999AA10123456784"
            maxLength={100}
          />
          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
          <div className="mt-4 flex justify-end gap-3">
            <button type="button" className="btn-secondary" onClick={() => setModal(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={pending || trackingNumber.trim().length === 0}
              onClick={() =>
                run(`/api/supplier/pos/${poId}/ship`, {
                  carrier,
                  trackingNumber: trackingNumber.trim(),
                })
              }
            >
              {pending ? "Saving…" : "Confirm shipment"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
