"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { formatShopTime } from "@/lib/format";

interface SlotDto {
  startAt: string;
  available: boolean;
  feasible: boolean;
}

interface SlotsResponse {
  tzOffsetMinutes: number;
  slotMinutes: number;
  neededBlocks: number;
  slots: SlotDto[];
}

/**
 * "Reschedule" button + modal slot picker. Reuses the public
 * GET /api/installers/[id]/slots grid sized by this appointment's labor,
 * then POSTs the chosen slot to /api/appointments/[id]/reschedule.
 */
export function RescheduleDialog({
  appointmentId,
  installerId,
  laborTenths,
  shopName,
}: {
  appointmentId: string;
  installerId: string;
  laborTenths: number;
  shopName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [slots, setSlots] = useState<SlotDto[]>([]);
  const [tzOffsetMinutes, setTzOffsetMinutes] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<string | null>(null);

  const openDialog = useCallback(async () => {
    setOpen(true);
    setLoading(true);
    setError(null);
    setSlots([]);
    try {
      const res = await fetch(
        `/api/installers/${installerId}/slots?laborTenths=${laborTenths}&days=14&lead=0`,
        { cache: "no-store" },
      );
      if (!res.ok) {
        setError("Could not load available times — please try again");
        return;
      }
      const data = (await res.json()) as SlotsResponse;
      setTzOffsetMinutes(data.tzOffsetMinutes);
      setSlots(data.slots);
    } catch {
      setError("Network error — please try again");
    } finally {
      setLoading(false);
    }
  }, [installerId, laborTenths]);

  async function pick(startAt: string) {
    setSubmitting(startAt);
    setError(null);
    try {
      const res = await fetch(`/api/appointments/${appointmentId}/reschedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startAt }),
      });
      if (!res.ok) {
        let msg = "Could not reschedule — that time may have just been taken";
        try {
          const data = (await res.json()) as { error?: { message?: string } };
          if (data.error?.message) msg = data.error.message;
        } catch {
          /* non-JSON error body */
        }
        setError(msg);
        return;
      }
      setOpen(false);
      router.refresh();
    } catch {
      setError("Network error — please try again");
    } finally {
      setSubmitting(null);
    }
  }

  // Group slots by shop-local day using the shared shop-time formatter
  // ("Tue, Aug 30 · 2:00 PM" -> day + time).
  const days: { day: string; slots: { slot: SlotDto; time: string }[] }[] = [];
  for (const slot of slots) {
    const [day, time] = formatShopTime(slot.startAt, tzOffsetMinutes).split(" · ");
    const bucket = days.find((d) => d.day === day);
    if (bucket) bucket.slots.push({ slot, time });
    else days.push({ day, slots: [{ slot, time }] });
  }

  return (
    <>
      <button type="button" className="btn-secondary" onClick={openDialog}>
        Reschedule
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="card flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <div>
                <h3 className="font-semibold text-slate-900">Reschedule appointment</h3>
                <p className="text-sm text-slate-500">Pick a new time at {shopName}</p>
              </div>
              <button
                type="button"
                className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                onClick={() => setOpen(false)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {loading && <p className="text-sm text-slate-500">Loading available times…</p>}
              {!loading && days.length === 0 && !error && (
                <p className="text-sm text-slate-500">
                  No slots in the next two weeks — please contact the shop.
                </p>
              )}
              {days.map((d) => (
                <div key={d.day} className="mb-4">
                  <p className="mb-2 text-sm font-medium text-slate-700">{d.day}</p>
                  <div className="flex flex-wrap gap-2">
                    {d.slots.map(({ slot, time }) => (
                      <button
                        key={slot.startAt}
                        type="button"
                        disabled={!slot.available || submitting !== null}
                        title={
                          !slot.available
                            ? "This time is fully booked"
                            : !slot.feasible
                              ? "Parts may not have arrived by this time"
                              : undefined
                        }
                        onClick={() => pick(slot.startAt)}
                        className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition ${
                          !slot.available
                            ? "cursor-not-allowed border-slate-200 bg-slate-50 text-slate-300 line-through"
                            : submitting === slot.startAt
                              ? "border-brand-600 bg-brand-600 text-white"
                              : `border-slate-300 bg-white text-slate-700 hover:border-brand-500 hover:text-brand-700 ${
                                  slot.feasible ? "" : "opacity-60"
                                }`
                        }`}
                      >
                        {time}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
            </div>
            <div className="border-t border-slate-100 px-5 py-3 text-right">
              <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
