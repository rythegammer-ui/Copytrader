import { api, jsonOk } from "@/lib/api";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/errors";
import { blocksNeeded, earliestFeasible, getSlotGrid } from "@/lib/slots";

export const dynamic = "force-dynamic";

const DEFAULT_DAYS = 14;
const MAX_DAYS = 30;
const DEFAULT_LEAD_DAYS = 3;

/**
 * GET /api/installers/[id]/slots?from=YYYY-MM-DD&days=14&laborTenths=NN&lead=N
 * Public slot grid for the install widget. Slots before
 * earliestFeasible(lead) are returned with feasible=false so the picker can
 * disable them ("parts won't arrive by then").
 */
export const GET = api(async (req, ctx) => {
  const shop = await db.installer.findUnique({ where: { id: ctx.params.id } });
  if (!shop || !shop.active) throw new ApiError("NOT_FOUND", "Installer not found", 404);

  const sp = req.nextUrl.searchParams;

  const fromRaw = sp.get("from");
  let fromDate = new Date();
  if (fromRaw && /^\d{4}-\d{2}-\d{2}$/.test(fromRaw)) {
    const parsed = new Date(`${fromRaw}T00:00:00Z`);
    if (!Number.isNaN(parsed.getTime())) fromDate = parsed;
  }

  const daysRaw = parseInt(sp.get("days") ?? `${DEFAULT_DAYS}`, 10);
  const days = Math.min(MAX_DAYS, Math.max(1, Number.isFinite(daysRaw) ? daysRaw : DEFAULT_DAYS));

  const laborRaw = parseInt(sp.get("laborTenths") ?? "10", 10);
  const laborTenths = Number.isFinite(laborRaw) && laborRaw > 0 ? laborRaw : 10;

  const leadRaw = parseInt(sp.get("lead") ?? `${DEFAULT_LEAD_DAYS}`, 10);
  const leadDays = Number.isFinite(leadRaw) && leadRaw >= 0 ? leadRaw : DEFAULT_LEAD_DAYS;

  const neededBlocks = blocksNeeded(laborTenths, shop.slotMinutes);
  const notBefore = earliestFeasible(leadDays);
  const grid = await getSlotGrid(db, shop, fromDate, days, neededBlocks, notBefore);

  return jsonOk({
    tzOffsetMinutes: shop.tzOffsetMinutes,
    slotMinutes: shop.slotMinutes,
    neededBlocks,
    slots: grid.map((s) => ({
      startAt: s.startAt.toISOString(),
      available: s.available,
      feasible: s.feasible,
    })),
  });
});
