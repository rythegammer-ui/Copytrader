import type { Metadata } from "next";
import { AccountForgotForm } from "@/components/account/account-forgot-form";

export const metadata: Metadata = { title: "Forgot password" };
export const dynamic = "force-dynamic";

export default function ForgotPage() {
  return (
    <div className="mx-auto w-full max-w-md px-4 py-12">
      <h1 className="mb-2 text-2xl font-bold text-slate-900">Forgot your password?</h1>
      <p className="mb-6 text-sm text-slate-600">
        Enter your email and we&apos;ll issue a reset link. In this demo the link is printed to the
        server console instead of being emailed.
      </p>
      <AccountForgotForm />
    </div>
  );
}
