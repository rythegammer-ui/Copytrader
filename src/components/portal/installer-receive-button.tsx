"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * "Mark received" for an inbound ship-to-shop PO. Receiving the parts is what
 * flips appointment readiness, so the page refreshes right after.
 */
export function InstallerReceiveButton({ poId, small }: { poId: string; small?: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function markReceived() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/installer/pos/${poId}/received`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        let msg = "Could not mark received — please try again";
        try {
          const data = (await res.json()) as { error?: { message?: string } };
          if (data.error?.message) msg = data.error.message;
        } catch {
          /* non-JSON error body */
        }
        setError(msg);
        return;
      }
      router.refresh();
    } catch {
      setError("Network error — please try again");
    } finally {
      setPending(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        className={small ? "btn-secondary px-3 py-1 text-xs" : "btn-primary"}
        disabled={pending}
        onClick={markReceived}
      >
        {pending ? "Saving…" : "Mark received"}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}
