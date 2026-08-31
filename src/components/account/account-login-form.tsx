"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { sendJson } from "./account-api";

type LoginResponse = {
  user: { id: string; name: string; email: string; role: string };
  home?: string;
};

export function AccountLoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await sendJson<LoginResponse>("/api/auth/login", "POST", { email, password });
    if (!res.ok) {
      setError(res.error);
      setBusy(false);
      return;
    }
    // Honor the return path first (same-site only — never an open redirect),
    // falling back to the role's home surface.
    const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : null;
    router.push(safeNext ?? res.data.home ?? "/account");
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <form onSubmit={onSubmit} className="card space-y-4 p-6">
        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
            {error}
          </p>
        )}
        <div>
          <label className="label" htmlFor="login-email">
            Email
          </label>
          <input
            id="login-email"
            className="input"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="login-password">
            Password
          </label>
          <input
            id="login-password"
            className="input"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <button type="submit" className="btn-primary w-full" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
        <div className="flex items-center justify-between text-sm">
          <Link
            href={next ? `/register?next=${encodeURIComponent(next)}` : "/register"}
            className="font-medium text-brand-700 hover:underline"
          >
            Create an account
          </Link>
          <Link href="/forgot" className="text-slate-600 hover:underline">
            Forgot password?
          </Link>
        </div>
      </form>

      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <p className="font-semibold">Demo accounts</p>
        <p className="mt-1">
          <code className="font-mono">admin@demo.test</code> ·{" "}
          <code className="font-mono">customer@demo.test</code>
        </p>
        <p className="mt-1">
          Password: <code className="font-mono">password123</code>
        </p>
      </div>
    </div>
  );
}
