import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { Role } from "@/lib/enums";
import { requirePageUser } from "@/lib/page-auth";
import { FitmentEditor } from "@/components/admin-crud/FitmentEditor";
import { PartForm } from "@/components/admin-crud/PartForm";

export const metadata: Metadata = { title: "Edit part — admin" };
export const dynamic = "force-dynamic";

export default async function AdminPartEditPage({ params }: { params: { id: string } }) {
  await requirePageUser([Role.ADMIN], `/admin/parts/${params.id}`);

  const [part, categories, brands, suppliers, makes] = await Promise.all([
    db.part.findUnique({
      where: { id: params.id },
      include: {
        fitments: {
          include: {
            model: { include: { make: { select: { name: true } } } },
            engine: { select: { name: true } },
          },
          orderBy: { yearFrom: "asc" },
        },
      },
    }),
    db.category.findMany({ orderBy: { name: "asc" } }),
    db.brand.findMany({ orderBy: { name: "asc" } }),
    db.supplier.findMany({ orderBy: { name: "asc" } }),
    db.make.findMany({
      orderBy: { name: "asc" },
      include: {
        models: {
          orderBy: { name: "asc" },
          include: { engines: { orderBy: { name: "asc" } } },
        },
      },
    }),
  ]);
  if (!part) notFound();

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
      <div className="mb-4">
        <Link href="/admin/parts" className="text-sm text-brand-700 hover:underline">
          ← Back to parts
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <img
            src={part.imageUrl}
            alt=""
            className="h-12 w-12 rounded-lg border border-slate-200 bg-white object-cover"
          />
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{part.name}</h1>
            <p className="text-sm text-slate-500">
              <span className="font-mono">{part.sku}</span> ·{" "}
              <Link href={`/parts/${part.slug}`} className="text-brand-700 hover:underline">
                View in store →
              </Link>
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-6">
        <PartForm
          mode="edit"
          partId={part.id}
          initial={{
            sku: part.sku,
            slug: part.slug,
            name: part.name,
            description: part.description,
            imageUrl: part.imageUrl,
            categoryId: part.categoryId,
            brandId: part.brandId,
            supplierId: part.supplierId,
            priceCents: part.priceCents,
            supplierCostCents: part.supplierCostCents,
            weightGrams: part.weightGrams,
            installEligible: part.installEligible,
            laborHoursTenths: part.laborHoursTenths,
            installFixedFeeCents: part.installFixedFeeCents,
            universalFit: part.universalFit,
            inStock: part.inStock,
            active: part.active,
          }}
          categories={categories.map((c) => ({ id: c.id, name: c.name }))}
          brands={brands.map((b) => ({ id: b.id, name: b.name }))}
          suppliers={suppliers.map((s) => ({ id: s.id, name: s.name }))}
        />

        <FitmentEditor
          partId={part.id}
          universalFit={part.universalFit}
          fitments={part.fitments.map((f) => ({
            id: f.id,
            makeName: f.model.make.name,
            modelName: f.model.name,
            engineName: f.engine?.name ?? null,
            yearFrom: f.yearFrom,
            yearTo: f.yearTo,
            notes: f.notes,
          }))}
          makes={makes.map((m) => ({
            id: m.id,
            name: m.name,
            models: m.models.map((mo) => ({
              id: mo.id,
              name: mo.name,
              engines: mo.engines.map((e) => ({ id: e.id, name: e.name })),
            })),
          }))}
        />
      </div>
    </div>
  );
}
