import { api, jsonOk } from "@/lib/api";
import { db } from "@/lib/db";
import { Role } from "@/lib/enums";

export const dynamic = "force-dynamic";

interface CategoryNode {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  children: CategoryNode[];
}

/**
 * GET /api/admin/taxonomy — everything the admin CRUD forms need:
 * category tree, brands, and the Make -> Model -> Engine hierarchy.
 */
export const GET = api(
  async () => {
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

    // Build the category tree (arbitrary depth; seed uses <= 2 levels).
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

    return jsonOk({
      categories: roots,
      brands: brands.map((b) => ({ id: b.id, name: b.name, slug: b.slug })),
      makes: makes.map((m) => ({
        id: m.id,
        name: m.name,
        models: m.models.map((mo) => ({
          id: mo.id,
          name: mo.name,
          engines: mo.engines.map((e) => ({ id: e.id, name: e.name })),
        })),
      })),
    });
  },
  { roles: [Role.ADMIN] },
);
