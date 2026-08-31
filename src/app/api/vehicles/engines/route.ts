import { api, jsonOk } from "@/lib/api";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** GET /api/vehicles/engines?modelId= — public. Engines of a model, ordered by name. */
export const GET = api(async (req) => {
  const modelId = req.nextUrl.searchParams.get("modelId");
  if (!modelId) return jsonOk([]);
  const engines = await db.engine.findMany({
    where: { modelId },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  return jsonOk(engines);
});
