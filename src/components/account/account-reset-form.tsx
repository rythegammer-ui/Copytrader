"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { sendJson } from "./account-api";

export function AccountResetForm({ token }: { token: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await sendJson("/api/auth/reset", "POST", { token, password });
    if (!res.ok) {
      setError(res.error);
      setBusy(false);
      return;
    }
    router.push("/login");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="card space-y-4 p-6">
      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {error}
        </p>
      )}
      <div>
        <label className="label" htmlFor="reset-password">
          New password
        </label>
        <input
          id="reset-password"
          className="input"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <p className="mt-1 text-xs text-slate-500">At least 8 characters.</p>
      </div>
      <div>
        <label className="label" htmlFor="reset-confirm">
          Confirm new password
        </label>
        <input
          id="reset-confirm"
          className="input"
          type="password"
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
      </div>
      <button type="submit" className="btn-primary w-full" disabled={busy}>
        {busy ? "Saving…" : "Set new password"}
      </button>
    </form>
  );
}
