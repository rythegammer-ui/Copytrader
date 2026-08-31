import type { Metadata } from "next";
import { db } from "@/lib/db";
import { Role } from "@/lib/enums";
import { requirePageUser } from "@/lib/page-auth";
import { TaxonomyManager, type CategoryNode } from "@/components/admin-crud/TaxonomyManager";

export const metadata: Metadata = { title: "Taxonomy — admin" };
export const dynamic = "force-dynamic";

export default async function AdminTaxonomyPage() {
  await requirePageUser([Role.ADMIN], "/admin/taxonomy");

  const [categories, brands, makes] = await Promise.all([
    db.category.findMany({ orderBy: { name: "asc" } }),
    db.brand.findMany({ orderBy: { name: "asc" } }),
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

  // Build the category tree (matches /api/admin/taxonomy).
  const nodes = new Map<string, CategoryNode>();
  for (const c of categories) {
    nodes.set(c.id, { id: c.id, name: c.name, slug: c.slug, parentId: c.parentId, children: [] });
  }
  const roots: CategoryNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentId ? nodes.get(node.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-slate-900">Taxonomy</h1>
        <p className="mt-1 text-sm text-slate-500">
          Categories, brands, and the Make → Model → Engine hierarchy used for fitment.
        </p>
      </div>
      <TaxonomyManager
        categories={roots}
        brands={brands.map((b) => ({ id: b.id, name: b.name, slug: b.slug }))}
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
  );
}
