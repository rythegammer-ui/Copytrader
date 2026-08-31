import type { Metadata } from "next";
import { AccountResetForm } from "@/components/account/account-reset-form";

export const metadata: Metadata = { title: "Reset password" };
export const dynamic = "force-dynamic";

export default function ResetPage({ params }: { params: { token: string } }) {
  return (
    <div className="mx-auto w-full max-w-md px-4 py-12">
      <h1 className="mb-2 text-2xl font-bold text-slate-900">Set a new password</h1>
      <p className="mb-6 text-sm text-slate-600">
        Reset links expire 30 minutes after they are issued.
      </p>
      <AccountResetForm token={decodeURIComponent(params.token)} />
    </div>
  );
}
