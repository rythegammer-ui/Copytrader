import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { Role } from "@/lib/enums";
import { requirePageUser } from "@/lib/page-auth";
import {
  AccountAddresses,
  AccountPasswordForm,
  AccountProfileForm,
  type AddressRow,
} from "@/components/account/account-settings-forms";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await requirePageUser([Role.CUSTOMER, Role.ADMIN], "/account/settings");

  const rows = await db.address.findMany({
    where: { userId: user.id },
    orderBy: [{ isDefault: "desc" }, { label: "asc" }],
  });

  const addresses: AddressRow[] = rows.map((a) => ({
    id: a.id,
    label: a.label,
    line1: a.line1,
    line2: a.line2,
    city: a.city,
    state: a.state,
    zip: a.zip,
    isDefault: a.isDefault,
  }));

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-8 sm:px-6">
      <div>
        <Link href="/account" className="text-sm text-slate-500 hover:underline">
          ← Account
        </Link>
        <h1 className="mt-1 text-2xl font-bold text-slate-900">Settings</h1>
      </div>
      <AccountProfileForm
        profile={{ name: user.name, email: user.email, phone: user.phone }}
      />
      <AccountPasswordForm />
      <AccountAddresses addresses={addresses} />
    </div>
  );
}
