import { Suspense } from "react";
import type { Metadata } from "next";
import { AccountRegisterForm } from "@/components/account/account-register-form";

export const metadata: Metadata = { title: "Create account" };
export const dynamic = "force-dynamic";

export default function RegisterPage() {
  return (
    <div className="mx-auto w-full max-w-md px-4 py-12">
      <h1 className="mb-6 text-2xl font-bold text-slate-900">Create your account</h1>
      <Suspense fallback={<div className="card h-80 animate-pulse" />}>
        <AccountRegisterForm />
      </Suspense>
    </div>
  );
}
