"use client";

import { useState } from "react";
import Link from "next/link";
import { sendJson } from "./account-api";

export function AccountForgotForm() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await sendJson("/api/auth/forgot", "POST", { email });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setSent(true);
  }

  if (sent) {
    return (
      <div className="card space-y-3 p-6">
        <p className="text-sm text-slate-700">
          If an account exists for <span className="font-semibold">{email}</span>, a reset link has
          been issued. Check the <span className="font-semibold">server console</span> for the reset
          link (demo — no real email is sent).
        </p>
        <Link href="/login" className="btn-secondary w-full">
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="card space-y-4 p-6">
      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {error}
        </p>
      )}
      <div>
        <label className="label" htmlFor="forgot-email">
          Email
        </label>
        <input
          id="forgot-email"
          className="input"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <button type="submit" className="btn-primary w-full" disabled={busy}>
        {busy ? "Sending…" : "Send reset link"}
      </button>
      <p className="text-sm text-slate-600">
        Remembered it?{" "}
        <Link href="/login" className="font-medium text-brand-700 hover:underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}
