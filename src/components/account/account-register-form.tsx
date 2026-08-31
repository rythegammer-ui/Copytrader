"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { sendJson } from "./account-api";

export function AccountRegisterForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next");

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await sendJson("/api/auth/register", "POST", {
      name,
      email,
      password,
      ...(phone.trim() ? { phone: phone.trim() } : {}),
    });
    if (!res.ok) {
      setError(res.error);
      setBusy(false);
      return;
    }
    const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : null;
    router.push(safeNext ?? "/account");
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
        <label className="label" htmlFor="reg-name">
          Full name
        </label>
        <input
          id="reg-name"
          className="input"
          type="text"
          autoComplete="name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div>
        <label className="label" htmlFor="reg-email">
          Email
        </label>
        <input
          id="reg-email"
          className="input"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <div>
        <label className="label" htmlFor="reg-phone">
          Phone <span className="font-normal text-slate-400">(optional)</span>
        </label>
        <input
          id="reg-phone"
          className="input"
          type="tel"
          autoComplete="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
      </div>
      <div>
        <label className="label" htmlFor="reg-password">
          Password
        </label>
        <input
          id="reg-password"
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
      <button type="submit" className="btn-primary w-full" disabled={busy}>
        {busy ? "Creating account…" : "Create account"}
      </button>
      <p className="text-sm text-slate-600">
        Already have an account?{" "}
        <Link
          href={next ? `/login?next=${encodeURIComponent(next)}` : "/login"}
          className="font-medium text-brand-700 hover:underline"
        >
          Sign in
        </Link>
      </p>
    </form>
  );
}
