import { api, jsonOk } from "@/lib/api";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** GET /api/brands — public. All brands ordered by name. */
export const GET = api(async () => {
  const brands = await db.brand.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, slug: true },
  });
  return jsonOk(brands);
});
