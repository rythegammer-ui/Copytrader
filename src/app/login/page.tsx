import { Suspense } from "react";
import type { Metadata } from "next";
import { AccountLoginForm } from "@/components/account/account-login-form";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <div className="mx-auto w-full max-w-md px-4 py-12">
      <h1 className="mb-6 text-2xl font-bold text-slate-900">Sign in</h1>
      <Suspense fallback={<div className="card h-64 animate-pulse" />}>
        <AccountLoginForm />
      </Suspense>
    </div>
  );
}
