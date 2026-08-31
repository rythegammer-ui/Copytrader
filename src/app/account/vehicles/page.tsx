import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { Role } from "@/lib/enums";
import { requirePageUser } from "@/lib/page-auth";
import { AccountVehicles, type GarageVehicle } from "@/components/account/account-vehicles";

export const metadata: Metadata = { title: "My garage" };
export const dynamic = "force-dynamic";

export default async function VehiclesPage() {
  const user = await requirePageUser([Role.CUSTOMER, Role.ADMIN], "/account/vehicles");

  const rows = await db.customerVehicle.findMany({
    where: { userId: user.id },
    include: { model: { include: { make: true } }, engine: true },
    orderBy: { id: "asc" },
  });

  const vehicles: GarageVehicle[] = rows.map((v) => ({
    id: v.id,
    year: v.year,
    makeName: v.model.make.name,
    modelName: v.model.name,
    engineName: v.engine?.name ?? null,
    nickname: v.nickname,
  }));

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <div className="mb-6">
        <Link href="/account" className="text-sm text-slate-500 hover:underline">
          ← Account
        </Link>
        <h1 className="mt-1 text-2xl font-bold text-slate-900">My garage</h1>
        <p className="text-sm text-slate-600">
          Save your vehicles so we can show only parts that fit.
        </p>
      </div>
      <AccountVehicles vehicles={vehicles} />
    </div>
  );
}
