"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { sendJson } from "./account-api";

export function AccountSignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function onClick() {
    setBusy(true);
    await sendJson("/api/auth/logout", "POST");
    router.push("/");
    router.refresh();
  }

  return (
    <button type="button" className="btn-secondary" onClick={onClick} disabled={busy}>
      {busy ? "Signing out…" : "Sign out"}
    </button>
  );
}
