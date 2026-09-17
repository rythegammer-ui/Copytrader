/**
 * Import the Principe Performance & Parts inventory into the catalog.
 *
 *   npx tsx scripts/import-inventory.ts [--keep-demo]
 *
 * Reads data/ppp-catalog.json (generated from the Master Inventory workbook by
 * scripts/ppp-transform.py). Idempotent: parts are upserted by SKU, so running
 * it again updates prices and stock instead of duplicating rows. Safe to run on
 * every deploy.
 *
 * Demo seed parts are deactivated by default so the storefront shows the real
 * catalog; pass --keep-demo (or PPP_KEEP_DEMO=1) to leave them listed.
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import fs from "fs";
import path from "path";
import { Role } from "../src/lib/enums";

const db = new PrismaClient();

const KEEP_DEMO = process.argv.includes("--keep-demo") || process.env.PPP_KEEP_DEMO === "1";
/** Overwrite live stock levels with the sheet's counts (use after a recount). */
const RESET_STOCK = process.argv.includes("--reset-stock") || process.env.PPP_RESET_STOCK === "1";
const CATALOG = path.join(__dirname, "..", "data", "ppp-catalog.json");

/** The shop itself is the supplier: these parts are on our own shelves. */
const SUPPLIER = {
  slug: "principe-performance-parts",
  name: "Principe Performance & Parts",
  contactEmail: "parts@principeperformance.test",
  city: "Austin",
  state: "TX",
  // Rows still on a car or engine need pulling before they ship; this covers it
  // and keeps install appointments from being booked unrealistically early.
  leadTimeDays: 5,
  shippingFlatCents: 1499,
  shippingPerItemCents: 0,
};

const CATEGORY_NAMES: Record<string, string> = {
  brakes: "Brakes",
  engine: "Engine & Performance",
  suspension: "Suspension & Steering",
  electrical: "Electrical & Modules",
  filters: "Filters",
  exhaust: "Exhaust",
  cooling: "Cooling",
  lighting: "Lighting",
  ignition: "Ignition",
  accessories: "Accessories",
  "body-exterior": "Body & Exterior",
  interior: "Interior",
  drivetrain: "Drivetrain",
  "wheels-tires": "Wheels & Tires",
  "audio-electronics": "Audio & Electronics",
  "fuel-air": "Fuel & Air",
  hvac: "Heating & A/C",
  "shop-supplies": "Shop Supplies & Fluids",
};

interface CatalogFitment {
  make: string;
  model: string;
  yearFrom: number;
  yearTo: number;
  engine: string | null;
}

interface CatalogPart {
  sourceRef: string;
  sku: string;
  slug: string;
  name: string;
  description: string;
  internalNotes: string | null;
  categorySlug: string;
  brandName: string;
  priceCents: number;
  floorPriceCents: number | null;
  supplierCostCents: number;
  stockQty: number;
  condition: string;
  localPickupOnly: boolean;
  acceptsOffers: boolean;
  installEligible: boolean;
  laborHoursTenths: number;
  weightGrams: number;
  active: boolean;
  inStock: boolean;
  isKit: boolean;
  universalFit: boolean;
  /** source refs of the rows this kit is assembled from */
  kitOf: string[];
  partNumber: string | null;
  sourceLabel: string;
  statusLabel: string;
  fitments: CatalogFitment[];
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

async function main(): Promise<void> {
  const raw = JSON.parse(fs.readFileSync(CATALOG, "utf8")) as { parts: CatalogPart[] };
  const parts = raw.parts;
  console.log(`Importing ${parts.length} inventory lines…`);

  // --- supplier -----------------------------------------------------------
  const supplier = await db.supplier.upsert({
    where: { slug: SUPPLIER.slug },
    create: SUPPLIER,
    update: {
      name: SUPPLIER.name,
      leadTimeDays: SUPPLIER.leadTimeDays,
      shippingFlatCents: SUPPLIER.shippingFlatCents,
      shippingPerItemCents: SUPPLIER.shippingPerItemCents,
      active: true,
    },
  });

  // --- supplier portal login ----------------------------------------------
  // Without a SUPPLIER-role user scoped to this supplier, nobody can confirm
  // or ship its purchase orders from the portal.
  const portalPassword = process.env.DEMO_PASSWORD || "password123";
  const existingPortalUser = await db.user.findUnique({ where: { email: SUPPLIER.contactEmail } });
  if (!existingPortalUser) {
    await db.user.create({
      data: {
        email: SUPPLIER.contactEmail,
        passwordHash: bcrypt.hashSync(portalPassword, 10),
        name: "Principe Parts Desk",
        role: Role.SUPPLIER,
        supplierId: supplier.id,
      },
    });
    console.log(`  supplier portal login created: ${SUPPLIER.contactEmail}`);
  } else if (existingPortalUser.supplierId !== supplier.id) {
    await db.user.update({
      where: { id: existingPortalUser.id },
      data: { role: Role.SUPPLIER, supplierId: supplier.id },
    });
  }

  // --- categories ---------------------------------------------------------
  const categoryIds = new Map<string, string>();
  for (const slug of new Set(parts.map((p) => p.categorySlug))) {
    const name = CATEGORY_NAMES[slug] ?? slug;
    const cat = await db.category.upsert({
      where: { slug },
      create: { slug, name },
      update: { name },
    });
    categoryIds.set(slug, cat.id);
  }

  // --- brands -------------------------------------------------------------
  const brandIds = new Map<string, string>();
  for (const name of new Set(parts.map((p) => p.brandName))) {
    // Upsert on slug: it is the constraint that collides when the source has
    // the same brand under two spellings.
    const brand = await db.brand.upsert({
      where: { slug: slugify(name) },
      create: { name, slug: slugify(name) },
      update: {},
    });
    brandIds.set(name, brand.id);
  }

  // --- vehicle taxonomy ---------------------------------------------------
  const modelIds = new Map<string, string>();
  const engineIds = new Map<string, string>();
  for (const f of parts.flatMap((p) => p.fitments)) {
    const modelKey = `${f.make}|${f.model}`;
    if (!modelIds.has(modelKey)) {
      const make = await db.make.upsert({
        where: { name: f.make },
        create: { name: f.make },
        update: {},
      });
      const model = await db.vehicleModel.upsert({
        where: { makeId_name: { makeId: make.id, name: f.model } },
        create: { makeId: make.id, name: f.model },
        update: {},
      });
      modelIds.set(modelKey, model.id);
    }
    if (f.engine) {
      const engineKey = `${modelKey}|${f.engine}`;
      if (!engineIds.has(engineKey)) {
        const engine = await db.engine.upsert({
          where: { modelId_name: { modelId: modelIds.get(modelKey)!, name: f.engine } },
          create: { modelId: modelIds.get(modelKey)!, name: f.engine },
          update: {},
        });
        engineIds.set(engineKey, engine.id);
      }
    }
  }

  // --- parts --------------------------------------------------------------
  let created = 0;
  let updated = 0;
  for (const p of parts) {
    const data = {
      slug: p.slug,
      name: p.name,
      description: p.description,
      internalNotes: p.internalNotes,
      imageUrl: `/images/placeholders/${p.categorySlug}.svg`,
      categoryId: categoryIds.get(p.categorySlug)!,
      brandId: brandIds.get(p.brandName)!,
      supplierId: supplier.id,
      priceCents: p.priceCents,
      floorPriceCents: p.floorPriceCents,
      supplierCostCents: p.supplierCostCents,
      weightGrams: p.weightGrams,
      installEligible: p.installEligible,
      laborHoursTenths: p.laborHoursTenths,
      universalFit: p.universalFit,
      inStock: p.inStock,
      active: p.active,
      // Every line here is finite stock — one car yields one alternator.
      trackStock: true,
      stockQty: p.stockQty,
      isKit: p.isKit,
      condition: p.condition,
      localPickupOnly: p.localPickupOnly,
      acceptsOffers: p.acceptsOffers,
      sourceRef: p.sourceRef,
    };

    const existing = await db.part.findUnique({ where: { sku: p.sku } });
    // The live store owns stock levels: orders draw them down and refunds put
    // them back. A catalog re-sync must not resurrect a part that has sold, so
    // stockQty/inStock are set on create only unless a reset is asked for.
    const { stockQty, inStock, ...catalogFields } = data;
    const part = existing
      ? await db.part.update({
          where: { sku: p.sku },
          data: RESET_STOCK ? data : catalogFields,
        })
      : await db.part.create({ data: { sku: p.sku, ...data } });
    existing ? updated++ : created++;

    // Fitment is derived data — rebuild it rather than diffing.
    await db.fitment.deleteMany({ where: { partId: part.id } });
    for (const f of p.fitments) {
      const modelId = modelIds.get(`${f.make}|${f.model}`)!;
      const engineId = f.engine ? engineIds.get(`${f.make}|${f.model}|${f.engine}`) ?? null : null;
      await db.fitment.create({
        data: {
          partId: part.id,
          modelId,
          engineId,
          yearFrom: f.yearFrom,
          yearTo: f.yearTo,
        },
      });
    }
  }

  // --- kits ---------------------------------------------------------------
  // A bundle is not a unit we own; it is an assembly of units we already own.
  // Linking it to its pieces is what stops the front clip and the hood inside
  // it from both being sold when the shop has one hood.
  const partIdBySku = new Map(
    (
      await db.part.findMany({
        where: { supplierId: supplier.id },
        select: { id: true, sku: true },
      })
    ).map((r) => [r.sku, r.id]),
  );
  let kitLinks = 0;
  for (const p of parts.filter((x) => x.isKit)) {
    const kitId = partIdBySku.get(p.sku);
    if (!kitId) continue;
    // Rebuild rather than diff — membership is derived from the sheet.
    await db.kitComponent.deleteMany({ where: { kitId } });
    for (const ref of p.kitOf) {
      const componentId = partIdBySku.get(`PPP-${ref}`);
      if (!componentId) {
        console.warn(`  ! kit ${p.sku} references ${ref}, which is not in the catalog`);
        continue;
      }
      await db.kitComponent.create({ data: { kitId, componentId, qty: 1 } });
      kitLinks++;
    }
    // The kit can only ever offer as many sets as its scarcest piece allows.
    const pieces = await db.kitComponent.findMany({
      where: { kitId },
      select: { qty: true, component: { select: { trackStock: true, stockQty: true } } },
    });
    const buildable = pieces.reduce((min, piece) => {
      if (!piece.component.trackStock) return min;
      return Math.min(min, Math.floor(piece.component.stockQty / Math.max(1, piece.qty)));
    }, Number.POSITIVE_INFINITY);
    const qty = Number.isFinite(buildable) ? buildable : 1;
    await db.part.update({
      where: { id: kitId },
      data: { stockQty: qty, inStock: qty > 0 },
    });
  }

  // --- rows that left the sheet --------------------------------------------
  // The catalog file is the source of truth for what this supplier sells, so
  // anything of theirs no longer in it has to go — otherwise a line deleted
  // from the workbook (a shop consumable, a part that turned out not to
  // exist) would stay on sale forever. A part that appears on an order is
  // only hidden, never deleted: order history must keep pointing at something.
  const wanted = new Set(parts.map((p) => p.sku));
  const mine = await db.part.findMany({
    where: { supplierId: supplier.id },
    select: { id: true, sku: true, name: true, _count: { select: { orderItems: true } } },
  });
  let pruned = 0;
  let retired = 0;
  for (const row of mine) {
    if (wanted.has(row.sku)) continue;
    if (row._count.orderItems > 0) {
      await db.part.update({ where: { id: row.id }, data: { active: false, inStock: false } });
      retired++;
    } else {
      await db.cartItem.deleteMany({ where: { partId: row.id } });
      await db.part.delete({ where: { id: row.id } });
      pruned++;
    }
  }

  // --- demo installer shops ------------------------------------------------
  // The seed ships four fictional garages with 555 phone numbers. Once real
  // card payments are on, a customer can pay for installation at a shop that
  // does not exist and nobody turns up. Matched by their seed slugs so a real
  // shop added later is never touched.
  const DEMO_INSTALLER_SLUGS = ["lone-star", "hill-country", "empire-auto", "golden-gate"];
  let demoShopsHidden = 0;
  if (!KEEP_DEMO) {
    const res = await db.installer.updateMany({
      where: { slug: { in: DEMO_INSTALLER_SLUGS }, active: true },
      data: { active: false },
    });
    demoShopsHidden = res.count;
  }

  // --- demo catalog -------------------------------------------------------
  let demoHidden = 0;
  if (!KEEP_DEMO) {
    const res = await db.part.updateMany({
      where: { supplierId: { not: supplier.id }, active: true },
      data: { active: false },
    });
    demoHidden = res.count;
  }

  const listed = await db.part.count({ where: { supplierId: supplier.id, active: true } });
  const listedValue = await db.part.aggregate({
    where: { supplierId: supplier.id, active: true },
    _sum: { priceCents: true },
  });

  console.log(`  parts created: ${created}, updated: ${updated}${RESET_STOCK ? " (stock levels reset from the sheet)" : " (live stock preserved)"}`);
  console.log(`  listed for sale: ${listed} (\$${((listedValue._sum.priceCents ?? 0) / 100).toLocaleString("en-US")})`);
  console.log(`  unlisted (no price / not for sale): ${parts.length - listed}`);
  console.log(`  kit component links: ${kitLinks}`);
  if (pruned || retired) {
    console.log(`  no longer in the sheet: ${pruned} deleted, ${retired} hidden (they appear on past orders)`);
  }
  if (demoShopsHidden) {
    console.log(`  demo installer shops deactivated: ${demoShopsHidden} — add the real shop before offering installation`);
  }
  if (demoHidden) console.log(`  demo seed parts deactivated: ${demoHidden} (re-run with --keep-demo to keep them)`);
}

main()
  .catch((err) => {
    console.error("Inventory import failed:", err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
