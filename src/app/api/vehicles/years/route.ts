import { api, jsonOk } from "@/lib/api";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const FALLBACK_FROM = 1990;
const FALLBACK_TO = 2027;

/**
 * GET /api/vehicles/years?modelId= — public.
 * Year options for the picker, derived from the model's fitment rows
 * (min yearFrom .. max yearTo); falls back to 1990..2027 when the model has
 * no fitment coverage yet. Returned newest-first for the select.
 */
export const GET = api(async (req) => {
  const modelId = req.nextUrl.searchParams.get("modelId");
  let from = FALLBACK_FROM;
  let to = FALLBACK_TO;
  if (modelId) {
    const agg = await db.fitment.aggregate({
      where: { modelId },
      _min: { yearFrom: true },
      _max: { yearTo: true },
    });
    if (agg._min.yearFrom != null && agg._max.yearTo != null) {
      from = agg._min.yearFrom;
      to = agg._max.yearTo;
    }
  }
  // Guard against degenerate data producing huge arrays.
  if (to < from) [from, to] = [to, from];
  if (to - from > 120) from = to - 120;

  const years: number[] = [];
  for (let y = to; y >= from; y--) years.push(y);
  return jsonOk({ years });
});
