import { api, jsonOk } from "@/lib/api";
import { db } from "@/lib/db";
import { activeProviderName } from "@/lib/payments";

/**
 * Which Stripe mode a key belongs to, from its prefix alone.
 *
 * Prefixes are the only thing read here — never the key itself. Getting this
 * wrong is the commonest way a store goes live: a test secret key silently
 * accepts card numbers that will never settle, and a live key paired with a
 * test webhook secret drops every event on a signature failure.
 */
function keyMode(value: string | undefined): "live" | "test" | "unset" | "unrecognised" {
  if (!value) return "unset";
  if (value.startsWith("sk_live_") || value.startsWith("pk_live_") || value.startsWith("rk_live_")) {
    return "live";
  }
  if (value.startsWith("sk_test_") || value.startsWith("pk_test_") || value.startsWith("rk_test_")) {
    return "test";
  }
  return "unrecognised";
}

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

  // Booleans and key PREFIXES only. A publishable key is public by design and
  // a prefix is not a credential, but nothing here returns key material.
  const secretMode = keyMode(process.env.STRIPE_SECRET_KEY);
  const publishableMode = keyMode(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY);
  const webhookSecretSet = Boolean(process.env.STRIPE_WEBHOOK_SECRET);
  const stripe = {
    secretKey: secretMode,
    publishableKey: publishableMode,
    webhookSecret: webhookSecretSet,
    // Every piece present, both keys from the same mode, and a webhook secret
    // to verify deliveries with. Anything less and checkout will not complete.
    ready:
      secretMode !== "unset" &&
      secretMode !== "unrecognised" &&
      publishableMode === secretMode &&
      webhookSecretSet,
    modeMismatch:
      secretMode !== "unset" && publishableMode !== "unset" && publishableMode !== secretMode,
  };

  return jsonOk({
    ok: database && listedParts > 0,
    database,
    paymentProvider: activeProviderName(),
    stripe,
    catalog: { listedParts, shopStockListed, kits, kitLinks },
    shops: installers,
    suppliers,
  });
});
