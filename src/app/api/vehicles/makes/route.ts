import { api, jsonOk } from "@/lib/api";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** GET /api/vehicles/makes — public. All makes ordered by name. */
export const GET = api(async () => {
  const makes = await db.make.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  return jsonOk(makes);
});
