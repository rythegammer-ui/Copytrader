import { api, jsonOk } from "@/lib/api";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** GET /api/vehicles/models?makeId= — public. Models of a make, ordered by name. */
export const GET = api(async (req) => {
  const makeId = req.nextUrl.searchParams.get("makeId");
  if (!makeId) return jsonOk([]);
  const models = await db.vehicleModel.findMany({
    where: { makeId },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  return jsonOk(models);
});
