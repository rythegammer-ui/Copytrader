"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Installer actions on an appointment detail page:
 * - "Mark install complete" (notes textarea modal) — only when READY
 * - "Customer no-show" — only when READY and the slot window has passed
 * Buttons disable while a request is in flight.
 */
export function InstallerAppointmentActions({
  appointmentId,
  canComplete,
  canNoShow,
}: {
  appointmentId: string;
  canComplete: boolean;
  canNoShow: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [notes, setNotes] = useState("");

  async function post(url: string, body: unknown) {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        let msg = "Something went wrong — please try again";
        try {
          const data = (await res.json()) as { error?: { message?: string } };
          if (data.error?.message) msg = data.error.message;
        } catch {
          /* non-JSON error body */
        }
        setError(msg);
        return false;
      }
      return true;
    } catch {
      setError("Network error — please try again");
      return false;
    } finally {
      setPending(false);
    }
  }

  async function complete() {
    const trimmed = notes.trim();
    const ok = await post(
      `/api/installer/appointments/${appointmentId}/complete`,
      trimmed ? { notes: trimmed } : {},
    );
    if (ok) {
      setCompleteOpen(false);
      router.refresh();
    }
  }

  async function noShow() {
    if (!window.confirm("Mark this appointment as a customer no-show?")) return;
    const ok = await post(`/api/installer/appointments/${appointmentId}/no-show`, {});
    if (ok) router.refresh();
  }

  if (!canComplete && !canNoShow) return null;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        {canComplete && (
          <button
            type="button"
            className="btn-primary"
            disabled={pending}
            onClick={() => {
              setError(null);
              setCompleteOpen(true);
            }}
          >
            Mark install complete…
          </button>
        )}
        {canNoShow && (
          <button type="button" className="btn-danger" disabled={pending} onClick={noShow}>
            {pending ? "Saving…" : "Customer no-show"}
          </button>
        )}
      </div>
      {error && !completeOpen && <p className="mt-2 text-sm text-red-600">{error}</p>}

      {completeOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="card w-full max-w-md overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <h3 className="font-semibold text-slate-900">Complete installation</h3>
              <button
                type="button"
                className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                onClick={() => setCompleteOpen(false)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <div className="px-5 py-4">
              <label className="label" htmlFor="complete-notes">
                Work notes (optional)
              </label>
              <textarea
                id="complete-notes"
                className="input min-h-[90px]"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. Replaced front pads and rotors, road-tested OK"
                maxLength={2000}
              />
              {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
              <div className="mt-4 flex justify-end gap-3">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setCompleteOpen(false)}
                >
                  Cancel
                </button>
                <button type="button" className="btn-primary" disabled={pending} onClick={complete}>
                  {pending ? "Saving…" : "Complete install"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
