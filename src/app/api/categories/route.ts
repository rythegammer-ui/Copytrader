import { api, jsonOk } from "@/lib/api";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/categories — public. Category tree (top-level parents with
 * children[]) plus active-part counts; a parent's count includes its children.
 */
export const GET = api(async () => {
  const categories = await db.category.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { parts: { where: { active: true } } } } },
  });

  const parents = categories.filter((c) => c.parentId === null);
  const tree = parents.map((parent) => {
    const children = categories
      .filter((c) => c.parentId === parent.id)
      .map((c) => ({
        id: c.id,
        name: c.name,
        slug: c.slug,
        partCount: c._count.parts,
      }));
    return {
      id: parent.id,
      name: parent.name,
      slug: parent.slug,
      partCount: parent._count.parts + children.reduce((s, c) => s + c.partCount, 0),
      children,
    };
  });

  return jsonOk(tree);
});
