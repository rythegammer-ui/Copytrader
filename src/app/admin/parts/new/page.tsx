import Link from "next/link";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { Role } from "@/lib/enums";
import { requirePageUser } from "@/lib/page-auth";
import { PartForm } from "@/components/admin-crud/PartForm";

export const metadata: Metadata = { title: "New part — admin" };
export const dynamic = "force-dynamic";

export default async function AdminNewPartPage() {
  await requirePageUser([Role.ADMIN], "/admin/parts/new");

  const [categories, brands, suppliers] = await Promise.all([
    db.category.findMany({ orderBy: { name: "asc" } }),
    db.brand.findMany({ orderBy: { name: "asc" } }),
    db.supplier.findMany({ orderBy: { name: "asc" } }),
  ]);

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
      <div className="mb-4">
        <Link href="/admin/parts" className="text-sm text-brand-700 hover:underline">
          ← Back to parts
        </Link>
        <h1 className="mt-1 text-2xl font-bold text-slate-900">New part</h1>
        <p className="mt-1 text-sm text-slate-500">
          Prices are entered in dollars and stored as integer cents. Leave the image URL blank to
          use the category placeholder.
        </p>
      </div>
      <PartForm
        mode="create"
        categories={categories.map((c) => ({ id: c.id, name: c.name }))}
        brands={brands.map((b) => ({ id: b.id, name: b.name }))}
        suppliers={suppliers.map((s) => ({ id: s.id, name: s.name }))}
      />
    </div>
  );
}
