import { api, jsonOk } from "@/lib/api";
import { db } from "@/lib/db";
import { activeProviderName } from "@/lib/payments";

export const dynamic = "force-dynamic";

/**
 * GET /api/health — public.
 *
 * One request that answers "did this deploy actually come up against a real
 * database with the catalog in it". Everything here is either a boolean or a
 * count already derivable from the public catalog, so it exposes nothing the
 * storefront does not. No connection strings, no secrets, no costs.
 */
export const GET = api(async () => {
  let database = false;
  let listedParts = 0;
  let shopStockListed = 0;
  let kits = 0;
  let kitLinks = 0;
  let installers = 0;
  let suppliers = 0;

  try {
    [listedParts, shopStockListed, kits, kitLinks, installers, suppliers] = await Promise.all([
      db.part.count({ where: { active: true } }),
      db.part.count({ where: { active: true, sourceRef: { startsWith: "S" } } }),
      db.part.count({ where: { active: true, isKit: true } }),
      db.kitComponent.count(),
      db.installer.count({ where: { active: true } }),
      db.supplier.count({ where: { active: true } }),
    ]);
    database = true;
  } catch {
    // Fall through with database:false — an unreachable database is the single
    // most useful thing this endpoint can report.
  }

  return jsonOk({
    ok: database && listedParts > 0,
    database,
    paymentProvider: activeProviderName(),
    catalog: { listedParts, shopStockListed, kits, kitLinks },
    shops: installers,
    suppliers,
  });
});
