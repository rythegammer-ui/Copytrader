/**
 * PartsPro seed — demo taxonomy, catalog, users, and historical orders frozen
 * at every lifecycle stage. Run via `npm run db:seed` (tsx prisma/seed.ts).
 *
 * Money is computed with the REAL pricing lib (priceQuote) so every seeded
 * order's subtotals/tax/total — and every PO's shippingFeeCents — are exactly
 * what production checkout would have produced.
 *
 * NOTE ON STATUS WRITES: the app-code rule "status writes only in src/lib"
 * applies to runtime code. A seed must materialize orders FROZEN mid-lifecycle
 * (transitions.ts stamps `new Date()` everywhere, which would destroy the
 * historical timestamps), so this file writes statuses + matching EventLog
 * trails directly, mirroring the exact rows src/lib/transitions.ts and
 * src/lib/payments/index.ts would have written at those times.
 */
import { PrismaClient } from "@prisma/client";
import type { Installer, Part, Supplier, User } from "@prisma/client";
import bcrypt from "bcryptjs";
import {
  AppointmentStatus,
  EntityType,
  OrderItemStatus,
  OrderStatus,
  PayProvider,
  PaymentStatus,
  POStatus,
  RefundStatus,
  Role,
  ShipTo,
} from "../src/lib/enums";
import { priceQuote, taxRateBps, type QuoteItemInput } from "../src/lib/pricing";
import { blockStartsForDate, blocksNeeded } from "../src/lib/slots";
import { carrierTrackingUrl } from "../src/lib/transitions";

const db = new PrismaClient();

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const now = new Date();
const DAY = 86_400_000;
const HOUR = 3_600_000;
const daysAgo = (n: number): Date => new Date(now.getTime() - n * DAY);
const daysFromNow = (n: number): Date => new Date(now.getTime() + n * DAY);
const hoursAgo = (n: number): Date => new Date(now.getTime() - n * HOUR);
const plus = (d: Date, ms: number): Date => new Date(d.getTime() + ms);

/** Deterministic PRNG so re-seeding produces the same catalog. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20260830);
const ri = (min: number, max: number): number => min + Math.floor(rnd() * (max - min + 1));

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-+|-+$)/g, "");
}

type ShopScheduleLike = Pick<
  Installer,
  "id" | "bays" | "openMinutes" | "closeMinutes" | "slotMinutes" | "daysOpenMask" | "tzOffsetMinutes"
>;

/**
 * A valid appointment block start (UTC) on the shop-local open day nearest to
 * `target`, walking forward (dir=1) or backward (dir=-1) past closed days.
 * blockIdx picks which block of the day (0 = opening block).
 */
function blockStartNear(shop: ShopScheduleLike, target: Date, dir: 1 | -1, blockIdx = 1): Date {
  for (let i = 0; i < 14; i++) {
    const probe = new Date(target.getTime() + dir * i * DAY);
    const local = new Date(probe.getTime() + shop.tzOffsetMinutes * 60_000);
    const starts = blockStartsForDate(
      shop,
      local.getUTCFullYear(),
      local.getUTCMonth(),
      local.getUTCDate(),
    );
    if (starts.length > blockIdx) return starts[blockIdx];
  }
  throw new Error("No open shop day found near target date");
}

// ---------------------------------------------------------------------------
// Static data
// ---------------------------------------------------------------------------

const MAKES: Record<string, Record<string, string[]>> = {
  Toyota: {
    Camry: ["2.5L I4", "3.5L V6"],
    Corolla: ["1.8L I4", "2.0L I4"],
    RAV4: ["2.5L I4", "2.5L Hybrid"],
    Tacoma: ["2.7L I4", "3.5L V6"],
  },
  Honda: {
    Civic: ["1.5L Turbo I4", "2.0L I4"],
    Accord: ["1.5L Turbo I4", "2.0L Turbo I4"],
    "CR-V": ["1.5L Turbo I4", "2.4L I4"],
    Pilot: ["3.5L V6"],
  },
  Ford: {
    "F-150": ["2.7L EcoBoost V6", "3.5L EcoBoost V6", "5.0L V8"],
    Mustang: ["2.3L EcoBoost I4", "5.0L V8"],
    Explorer: ["2.3L EcoBoost I4", "3.0L EcoBoost V6"],
    Escape: ["1.5L EcoBoost I3", "2.0L EcoBoost I4"],
  },
  Chevrolet: {
    "Silverado 1500": ["2.7L Turbo I4", "5.3L V8", "6.2L V8"],
    Equinox: ["1.5L Turbo I4", "2.0L Turbo I4"],
    Malibu: ["1.5L Turbo I4", "2.0L Turbo I4"],
  },
  BMW: {
    "3 Series": ["2.0L Turbo I4", "3.0L Turbo I6"],
    "5 Series": ["2.0L Turbo I4", "3.0L Turbo I6"],
    X3: ["2.0L Turbo I4", "3.0L Turbo I6"],
  },
  Subaru: {
    Outback: ["2.5L H4", "2.4L Turbo H4"],
    Forester: ["2.5L H4", "2.0L Turbo H4"],
    Impreza: ["2.0L H4", "2.5L H4"],
  },
  Nissan: {
    Altima: ["2.5L I4", "2.0L VC-Turbo I4"],
    Rogue: ["2.5L I4", "1.5L VC-Turbo I3"],
    Frontier: ["3.8L V6", "4.0L V6"],
  },
  Jeep: {
    Wrangler: ["3.6L V6", "2.0L Turbo I4"],
    "Grand Cherokee": ["3.6L V6", "5.7L V8"],
    Cherokee: ["2.4L I4", "3.2L V6"],
  },
};

const CATEGORIES = [
  { name: "Brakes", slug: "brakes", code: "BRK" },
  { name: "Engine", slug: "engine", code: "ENG" },
  { name: "Suspension", slug: "suspension", code: "SUS" },
  { name: "Electrical", slug: "electrical", code: "ELC" },
  { name: "Filters", slug: "filters", code: "FLT" },
  { name: "Exhaust", slug: "exhaust", code: "EXH" },
  { name: "Cooling", slug: "cooling", code: "COL" },
  { name: "Lighting", slug: "lighting", code: "LGT" },
  { name: "Ignition", slug: "ignition", code: "IGN" },
  { name: "Accessories", slug: "accessories", code: "ACC" },
] as const;

const BRANDS = [
  "Brembo",
  "Bosch",
  "Denso",
  "KYB",
  "Monroe",
  "NGK",
  "Bilstein",
  "Moog",
  "ACDelco",
  "Gates",
  "Hella",
  "K&N",
];

const SUPPLIERS = [
  {
    name: "AutoMax Distribution",
    slug: "automax",
    city: "Dallas",
    state: "TX",
    leadTimeDays: 3,
    shippingFlatCents: 999,
    shippingPerItemCents: 50,
  },
  {
    name: "Precision Parts Co.",
    slug: "precision-parts",
    city: "Houston",
    state: "TX",
    leadTimeDays: 2,
    shippingFlatCents: 799,
    shippingPerItemCents: 0,
  },
  {
    name: "Midwest Auto Supply",
    slug: "midwest-auto",
    city: "Chicago",
    state: "IL",
    leadTimeDays: 5,
    shippingFlatCents: 1199,
    shippingPerItemCents: 100,
  },
  {
    name: "Pacific Rim Imports",
    slug: "pacific-rim",
    city: "Los Angeles",
    state: "CA",
    leadTimeDays: 7,
    shippingFlatCents: 1499,
    shippingPerItemCents: 150,
  },
  {
    name: "Southern Gear & Axle",
    slug: "southern-gear",
    city: "Atlanta",
    state: "GA",
    leadTimeDays: 4,
    shippingFlatCents: 899,
    shippingPerItemCents: 25,
  },
];

const INSTALLERS = [
  {
    name: "Lone Star Auto Works",
    slug: "lone-star",
    hourlyRateCents: 11000,
    line1: "4400 S Congress Ave",
    city: "Austin",
    state: "TX",
    zip: "78745",
    phone: "+1 512 555 0180",
    bays: 3,
    daysOpenMask: 62, // Mon-Fri
    tzOffsetMinutes: -360, // CT
  },
  {
    name: "Hill Country Motorsports",
    slug: "hill-country",
    hourlyRateCents: 9500,
    line1: "1810 N Mays St",
    city: "Round Rock",
    state: "TX",
    zip: "78664",
    phone: "+1 512 555 0134",
    bays: 2,
    daysOpenMask: 126, // Mon-Sat
    tzOffsetMinutes: -360, // CT
  },
  {
    name: "Empire Auto Service",
    slug: "empire-auto",
    hourlyRateCents: 14000,
    line1: "612 Atlantic Ave",
    city: "Brooklyn",
    state: "NY",
    zip: "11217",
    phone: "+1 718 555 0166",
    bays: 2,
    daysOpenMask: 62, // Mon-Fri
    tzOffsetMinutes: -300, // ET
  },
  {
    name: "Golden Gate Garage",
    slug: "golden-gate",
    hourlyRateCents: 12500,
    line1: "298 Bayshore Blvd",
    city: "San Francisco",
    state: "CA",
    zip: "94124",
    phone: "+1 415 555 0119",
    bays: 3,
    daysOpenMask: 62, // Mon-Fri
    tzOffsetMinutes: -480, // PT
  },
];

/** ~11 generated part names per category (+ hero/split parts defined below). */
const PART_NAMES: Record<string, string[]> = {
  brakes: [
    "Front Brake Pad Set — Semi-Metallic",
    "Rear Brake Pad Set — Ceramic",
    "Front Brake Rotor Pair — Vented",
    "Rear Brake Rotor Pair",
    "Brake Caliper — Front Right",
    "Brake Master Cylinder",
    "Stainless Brake Hose Kit",
    "Parking Brake Shoe Set",
    "ABS Wheel Speed Sensor",
    "Brake Fluid Reservoir",
    "Rear Drum Brake Hardware Kit",
  ],
  engine: [
    "Timing Chain Kit",
    "Valve Cover Gasket Set",
    "Engine Mount — Front",
    "Oil Pump Assembly",
    "Crankshaft Position Sensor",
    "Camshaft Phaser",
    "Harmonic Balancer",
    "PCV Valve",
    "Intake Manifold Gasket Set",
    "Oil Pan — Stamped Steel",
    "Variable Valve Timing Solenoid",
  ],
  suspension: [
    "Front Strut Assembly — Left",
    "Rear Shock Absorber Pair",
    "Front Lower Control Arm",
    "Sway Bar End Link Kit",
    "Rear Coil Spring Set",
    "Front Lower Ball Joint",
    "Outer Tie Rod End",
    "Wheel Hub Bearing Assembly",
    "Strut Mount Kit",
    "Leaf Spring Shackle Kit",
    "Air Suspension Compressor",
  ],
  electrical: [
    "Alternator — 130A",
    "Starter Motor",
    "Oxygen Sensor — Upstream",
    "Battery Ground Strap",
    "Ignition Switch",
    "Master Window Switch",
    "Headlight Wiring Harness",
    "Voltage Regulator",
    "Knock Sensor",
    "Fuel Pump Relay",
    "Backup Camera Module",
  ],
  filters: [
    "Engine Air Filter",
    "Cabin Air Filter — Activated Carbon",
    "Premium Oil Filter",
    "Inline Fuel Filter",
    "Transmission Filter Kit",
    "Air Filter Box Assembly",
    "Crankcase Breather Filter",
    "Oil Filter Housing",
    "Cabin Air Filter 2-Pack",
    "Washable High-Flow Air Filter",
    "Diesel Fuel Filter",
  ],
  exhaust: [
    "Catalytic Converter — Direct Fit",
    "Performance Muffler",
    "Exhaust Manifold",
    "Mid-Pipe with Resonator",
    "Exhaust Gasket Kit",
    "Dual Tailpipe Tip",
    "Flex Pipe Repair Kit",
    "Cat-Back Exhaust System",
    "Exhaust Hanger Set",
    "Heat Shield Kit",
    "EGR Valve",
  ],
  cooling: [
    "Water Pump",
    "Thermostat with Housing",
    "Radiator Fan Assembly",
    "Coolant Reservoir Tank",
    "Heater Core",
    "Radiator Hose Kit — Upper & Lower",
    "Engine Oil Cooler",
    "Fan Clutch",
    "Coolant Temperature Sensor",
    "Front-Mount Intercooler",
    "Radiator Cap — 1.1 Bar",
  ],
  lighting: [
    "LED Headlight Bulb Kit — H11",
    "Halogen Headlight Assembly — Left",
    "Tail Light Assembly — Right",
    "Fog Light Kit",
    "Turn Signal Switch",
    "Third Brake Light",
    "License Plate Light Pair",
    "Headlight Ballast",
    "Daytime Running Light Module",
    "Interior Dome Light Kit",
    "Sequential Tail Light Kit",
  ],
  ignition: [
    "Ignition Coil Pack",
    "Distributor Cap & Rotor Kit",
    "Spark Plug Wire Set",
    "Glow Plug Set",
    "Ignition Control Module",
    "Coil-On-Plug Boot Kit",
    "Crank Trigger Kit",
    "Ballast Resistor",
    "Copper Core Spark Plug Set (4)",
    "Performance Coil Kit",
    "Ignition Lock Cylinder",
  ],
  accessories: [
    "All-Weather Floor Mat Set",
    "Cargo Area Liner",
    "Roof Rack Cross Bars",
    "Trailer Hitch — Class III",
    "Mud Flap Set",
    "Door Sill Protector Kit",
    "Neoprene Seat Cover Set",
    "Truck Bed Mat",
    "Center Console Organizer",
    "Rear Bumper Protector",
    "Emergency Roadside Kit",
  ],
};

const PRICE_RANGE: Record<string, [number, number]> = {
  brakes: [2500, 32000],
  engine: [1599, 60000],
  suspension: [8000, 45000],
  electrical: [1499, 30000],
  filters: [1499, 8999],
  exhaust: [5000, 89999],
  cooling: [4000, 40000],
  lighting: [1999, 25000],
  ignition: [1999, 15000],
  accessories: [1499, 22000],
};

const LABOR_RANGE: Record<string, [number, number]> = {
  brakes: [12, 20],
  engine: [8, 40],
  suspension: [25, 40],
  electrical: [5, 12],
  filters: [5, 8],
  exhaust: [10, 25],
  cooling: [15, 30],
  lighting: [5, 8],
  ignition: [6, 15],
  accessories: [5, 10],
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("Seeding PartsPro…");

  // ---- wipe everything in dependency order --------------------------------
  await db.eventLog.deleteMany();
  await db.notification.deleteMany();
  await db.refund.deleteMany();
  await db.webhookEvent.deleteMany();
  await db.payment.deleteMany();
  await db.orderItem.deleteMany();
  await db.appointment.deleteMany();
  await db.purchaseOrder.deleteMany();
  await db.order.deleteMany();
  await db.cartItem.deleteMany();
  await db.cart.deleteMany();
  await db.customerVehicle.deleteMany();
  await db.address.deleteMany();
  await db.fitment.deleteMany();
  await db.part.deleteMany();
  await db.user.deleteMany();
  await db.supplier.deleteMany();
  await db.installer.deleteMany();
  await db.category.deleteMany();
  await db.brand.deleteMany();
  await db.engine.deleteMany();
  await db.vehicleModel.deleteMany();
  await db.make.deleteMany();
  await db.counter.deleteMany();

  // ---- vehicle taxonomy ---------------------------------------------------
  const modelIdByKey = new Map<string, string>(); // "Toyota Camry" -> id
  const engineIdByKey = new Map<string, string>(); // "Toyota Camry|2.5L I4" -> id
  const allModels: Array<{ id: string; engineIds: string[] }> = [];

  for (const [makeName, models] of Object.entries(MAKES)) {
    const make = await db.make.create({ data: { name: makeName } });
    for (const [modelName, engines] of Object.entries(models)) {
      const model = await db.vehicleModel.create({
        data: { makeId: make.id, name: modelName },
      });
      modelIdByKey.set(`${makeName} ${modelName}`, model.id);
      const engineIds: string[] = [];
      for (const engineName of engines) {
        const engine = await db.engine.create({ data: { modelId: model.id, name: engineName } });
        engineIdByKey.set(`${makeName} ${modelName}|${engineName}`, engine.id);
        engineIds.push(engine.id);
      }
      allModels.push({ id: model.id, engineIds });
    }
  }

  const model = (key: string): string => {
    const id = modelIdByKey.get(key);
    if (!id) throw new Error(`Unknown model ${key}`);
    return id;
  };
  const engine = (key: string): string => {
    const id = engineIdByKey.get(key);
    if (!id) throw new Error(`Unknown engine ${key}`);
    return id;
  };

  // ---- categories / brands / suppliers / installers -----------------------
  const categoryIdBySlug = new Map<string, string>();
  for (const c of CATEGORIES) {
    const row = await db.category.create({ data: { name: c.name, slug: c.slug } });
    categoryIdBySlug.set(c.slug, row.id);
  }

  const brandIdByName = new Map<string, string>();
  for (const name of BRANDS) {
    const row = await db.brand.create({ data: { name, slug: slugify(name) } });
    brandIdByName.set(name, row.id);
  }

  const suppliersBySlug = new Map<string, Supplier>();
  for (const s of SUPPLIERS) {
    const row = await db.supplier.create({
      data: {
        name: s.name,
        slug: s.slug,
        contactEmail: `${s.slug}@supplier.test`,
        phone: `+1 800 555 0${ri(100, 199)}`,
        city: s.city,
        state: s.state,
        leadTimeDays: s.leadTimeDays,
        shippingFlatCents: s.shippingFlatCents,
        shippingPerItemCents: s.shippingPerItemCents,
      },
    });
    suppliersBySlug.set(s.slug, row);
  }
  const supplierList = Array.from(suppliersBySlug.values());

  const installersBySlug = new Map<string, Installer>();
  for (const i of INSTALLERS) {
    const row = await db.installer.create({
      data: {
        name: i.name,
        slug: i.slug,
        hourlyRateCents: i.hourlyRateCents,
        line1: i.line1,
        city: i.city,
        state: i.state,
        zip: i.zip,
        phone: i.phone,
        bays: i.bays,
        openMinutes: 480,
        closeMinutes: 1080,
        slotMinutes: 120,
        daysOpenMask: i.daysOpenMask,
        tzOffsetMinutes: i.tzOffsetMinutes,
      },
    });
    installersBySlug.set(i.slug, row);
  }

  // ---- parts --------------------------------------------------------------
  interface PartSeed {
    sku: string;
    slug: string;
    name: string;
    description: string;
    imageUrl: string;
    categorySlug: string;
    brandName: string;
    supplierSlug: string;
    priceCents: number;
    supplierCostCents: number;
    weightGrams: number;
    installEligible: boolean;
    laborHoursTenths: number;
    installFixedFeeCents: number | null;
    universalFit: boolean;
    inStock: boolean;
    fitments: Array<{ modelId: string; yearFrom: number; yearTo: number; engineId: string | null }>;
  }

  const usedSlugs = new Set<string>();
  const uniqueSlug = (base: string): string => {
    let s = base;
    let n = 2;
    while (usedSlugs.has(s)) s = `${base}-${n++}`;
    usedSlugs.add(s);
    return s;
  };

  const randomFitments = (
    count: number,
  ): Array<{ modelId: string; yearFrom: number; yearTo: number; engineId: string | null }> => {
    const rows: Array<{ modelId: string; yearFrom: number; yearTo: number; engineId: string | null }> = [];
    const seen = new Set<string>();
    let guard = 0;
    while (rows.length < count && guard++ < count * 5) {
      const m = allModels[ri(0, allModels.length - 1)];
      const yearFrom = ri(2008, 2018);
      const yearTo = Math.min(2026, yearFrom + ri(3, 8));
      const engineId = rnd() < 0.5 && m.engineIds.length > 0 ? m.engineIds[ri(0, m.engineIds.length - 1)] : null;
      const key = `${m.id}|${engineId ?? ""}|${yearFrom}|${yearTo}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({ modelId: m.id, yearFrom, yearTo, engineId });
    }
    return rows;
  };

  const partSeeds: PartSeed[] = [];

  // Generated catalog: ~11 parts per category.
  CATEGORIES.forEach((cat, catIdx) => {
    const names = PART_NAMES[cat.slug];
    names.forEach((base, i) => {
      const brandName = BRANDS[(catIdx * 5 + i) % BRANDS.length];
      const supplier = SUPPLIERS[(catIdx + i) % SUPPLIERS.length];
      const [pMin, pMax] = PRICE_RANGE[cat.slug];
      const priceCents = ri(pMin, pMax);
      const supplierCostCents = Math.round(priceCents * (0.55 + rnd() * 0.15));
      const [lMin, lMax] = LABOR_RANGE[cat.slug];
      const name = `${brandName} ${base}`;

      // Designated special parts:
      const universalFit =
        (cat.slug === "accessories" && i === 8) || (cat.slug === "lighting" && i === 9);
      const inStock = !((cat.slug === "brakes" && i === 9) || (cat.slug === "exhaust" && i === 9));
      const installEligible = !(cat.slug === "accessories" && (i === 0 || i === 10));

      partSeeds.push({
        sku: `PP-${cat.code}-${1000 + i}`,
        slug: uniqueSlug(slugify(name)),
        name,
        description: `${name} by ${brandName}. Direct-fit replacement engineered to OE specifications, supplied by ${supplier.name}.`,
        imageUrl: `/images/placeholders/${cat.slug}.svg`,
        categorySlug: cat.slug,
        brandName,
        supplierSlug: supplier.slug,
        priceCents,
        supplierCostCents,
        weightGrams: ri(400, 22000),
        installEligible,
        laborHoursTenths: ri(lMin, lMax),
        installFixedFeeCents: i % 11 === 5 ? ri(3900, 9900) : null,
        universalFit,
        inStock,
        fitments: universalFit ? [] : randomFitments(ri(3, 8)),
      });
    });
  });

  // Engine-split variants (engine-specific fitment pairs of the same product).
  partSeeds.push(
    {
      sku: "PP-ENG-9101",
      slug: uniqueSlug("gates-serpentine-belt-3-5l-v6"),
      name: "Gates Serpentine Belt — 3.5L V6",
      description:
        "Gates Micro-V serpentine belt for 3.5L V6 applications. EPDM construction rated for 100k miles.",
      imageUrl: "/images/placeholders/engine.svg",
      categorySlug: "engine",
      brandName: "Gates",
      supplierSlug: "southern-gear",
      priceCents: 2899,
      supplierCostCents: 1699,
      weightGrams: 500,
      installEligible: true,
      laborHoursTenths: 6,
      installFixedFeeCents: null,
      universalFit: false,
      inStock: true,
      fitments: [
        { modelId: model("Toyota Camry"), yearFrom: 2008, yearTo: 2017, engineId: engine("Toyota Camry|3.5L V6") },
        { modelId: model("Toyota Tacoma"), yearFrom: 2016, yearTo: 2023, engineId: engine("Toyota Tacoma|3.5L V6") },
      ],
    },
    {
      sku: "PP-ENG-9102",
      slug: uniqueSlug("gates-serpentine-belt-2-5l-i4"),
      name: "Gates Serpentine Belt — 2.5L I4",
      description:
        "Gates Micro-V serpentine belt for 2.5L I4 applications. EPDM construction rated for 100k miles.",
      imageUrl: "/images/placeholders/engine.svg",
      categorySlug: "engine",
      brandName: "Gates",
      supplierSlug: "southern-gear",
      priceCents: 2699,
      supplierCostCents: 1599,
      weightGrams: 480,
      installEligible: true,
      laborHoursTenths: 6,
      installFixedFeeCents: null,
      universalFit: false,
      inStock: true,
      fitments: [
        { modelId: model("Toyota Camry"), yearFrom: 2018, yearTo: 2024, engineId: engine("Toyota Camry|2.5L I4") },
        { modelId: model("Toyota RAV4"), yearFrom: 2019, yearTo: 2025, engineId: engine("Toyota RAV4|2.5L I4") },
      ],
    },
    {
      sku: "PP-IGN-9103",
      slug: uniqueSlug("ngk-iridium-spark-plug-set-5-0l-v8"),
      name: "NGK Iridium Spark Plug Set — 5.0L V8",
      description: "Set of 8 NGK laser iridium spark plugs, pre-gapped for 5.0L V8 engines.",
      imageUrl: "/images/placeholders/ignition.svg",
      categorySlug: "ignition",
      brandName: "NGK",
      supplierSlug: "automax",
      priceCents: 8999,
      supplierCostCents: 5399,
      weightGrams: 900,
      installEligible: true,
      laborHoursTenths: 12,
      installFixedFeeCents: null,
      universalFit: false,
      inStock: true,
      fitments: [
        { modelId: model("Ford Mustang"), yearFrom: 2011, yearTo: 2023, engineId: engine("Ford Mustang|5.0L V8") },
        { modelId: model("Ford F-150"), yearFrom: 2011, yearTo: 2023, engineId: engine("Ford F-150|5.0L V8") },
      ],
    },
    {
      sku: "PP-IGN-9104",
      slug: uniqueSlug("ngk-iridium-spark-plug-set-2-3l-ecoboost"),
      name: "NGK Iridium Spark Plug Set — 2.3L EcoBoost",
      description: "Set of 4 NGK laser iridium spark plugs, pre-gapped for 2.3L EcoBoost engines.",
      imageUrl: "/images/placeholders/ignition.svg",
      categorySlug: "ignition",
      brandName: "NGK",
      supplierSlug: "automax",
      priceCents: 4599,
      supplierCostCents: 2799,
      weightGrams: 450,
      installEligible: true,
      laborHoursTenths: 8,
      installFixedFeeCents: null,
      universalFit: false,
      inStock: true,
      fitments: [
        { modelId: model("Ford Mustang"), yearFrom: 2015, yearTo: 2023, engineId: engine("Ford Mustang|2.3L EcoBoost I4") },
        { modelId: model("Ford Explorer"), yearFrom: 2016, yearTo: 2024, engineId: engine("Ford Explorer|2.3L EcoBoost I4") },
      ],
    },
  );

  // Hero parts used by the historical orders (fitments match the demo garage).
  partSeeds.push(
    {
      sku: "PP-BRK-9001",
      slug: uniqueSlug("brembo-front-brake-pad-set-ceramic"),
      name: "Brembo Front Brake Pad Set — Ceramic",
      description:
        "Brembo premium ceramic front pads with shims and hardware. Low dust, quiet, OE stopping power.",
      imageUrl: "/images/placeholders/brakes.svg",
      categorySlug: "brakes",
      brandName: "Brembo",
      supplierSlug: "automax",
      priceCents: 8999,
      supplierCostCents: 5599,
      weightGrams: 3200,
      installEligible: true,
      laborHoursTenths: 15,
      installFixedFeeCents: null,
      universalFit: false,
      inStock: true,
      fitments: [
        { modelId: model("Toyota Camry"), yearFrom: 2018, yearTo: 2024, engineId: null },
        { modelId: model("Toyota Camry"), yearFrom: 2012, yearTo: 2017, engineId: null },
        { modelId: model("Ford F-150"), yearFrom: 2015, yearTo: 2023, engineId: null },
        { modelId: model("Honda Accord"), yearFrom: 2018, yearTo: 2022, engineId: null },
      ],
    },
    {
      sku: "PP-SUS-9002",
      slug: uniqueSlug("kyb-excel-g-front-strut-assembly-pair"),
      name: "KYB Excel-G Front Strut Assembly Pair",
      description:
        "Pair of KYB Excel-G complete front strut assemblies with springs and mounts — restore OE ride height and handling.",
      imageUrl: "/images/placeholders/suspension.svg",
      categorySlug: "suspension",
      brandName: "KYB",
      supplierSlug: "midwest-auto",
      priceCents: 18999,
      supplierCostCents: 11899,
      weightGrams: 18000,
      installEligible: true,
      laborHoursTenths: 30,
      installFixedFeeCents: null,
      universalFit: false,
      inStock: true,
      fitments: [
        { modelId: model("Toyota Camry"), yearFrom: 2012, yearTo: 2017, engineId: null },
        { modelId: model("Toyota Camry"), yearFrom: 2018, yearTo: 2024, engineId: engine("Toyota Camry|2.5L I4") },
        { modelId: model("Honda Civic"), yearFrom: 2016, yearTo: 2021, engineId: null },
      ],
    },
    {
      sku: "PP-COL-9003",
      slug: uniqueSlug("denso-radiator-assembly"),
      name: "Denso Radiator Assembly",
      description:
        "Denso first-time-fit aluminum-core radiator, drop-in replacement with OE-style quick connects.",
      imageUrl: "/images/placeholders/cooling.svg",
      categorySlug: "cooling",
      brandName: "Denso",
      supplierSlug: "precision-parts",
      priceCents: 15999,
      supplierCostCents: 9599,
      weightGrams: 9000,
      installEligible: true,
      laborHoursTenths: 25,
      installFixedFeeCents: null,
      universalFit: false,
      inStock: true,
      fitments: [
        { modelId: model("Toyota Camry"), yearFrom: 2018, yearTo: 2024, engineId: null },
        { modelId: model("Toyota RAV4"), yearFrom: 2019, yearTo: 2025, engineId: null },
        { modelId: model("Toyota Corolla"), yearFrom: 2014, yearTo: 2019, engineId: null },
      ],
    },
    {
      sku: "PP-ELC-9004",
      slug: uniqueSlug("acdelco-gold-48agm-battery"),
      name: "ACDelco Gold 48AGM Battery",
      description:
        "ACDelco Gold absorbed-glass-mat battery, group size 48. 760 CCA, 36-month free replacement.",
      imageUrl: "/images/placeholders/electrical.svg",
      categorySlug: "electrical",
      brandName: "ACDelco",
      supplierSlug: "southern-gear",
      priceCents: 17999,
      supplierCostCents: 10999,
      weightGrams: 20500,
      installEligible: true,
      laborHoursTenths: 5,
      installFixedFeeCents: null,
      universalFit: false,
      inStock: true,
      fitments: [
        { modelId: model("Toyota Camry"), yearFrom: 2012, yearTo: 2024, engineId: null },
        { modelId: model("Ford F-150"), yearFrom: 2015, yearTo: 2023, engineId: null },
        { modelId: model("BMW 3 Series"), yearFrom: 2012, yearTo: 2023, engineId: null },
        { modelId: model("Chevrolet Malibu"), yearFrom: 2016, yearTo: 2024, engineId: null },
      ],
    },
    {
      sku: "PP-FLT-9005",
      slug: uniqueSlug("kn-33-5017-engine-air-filter"),
      name: "K&N 33-5017 Engine Air Filter",
      description:
        "K&N washable high-flow drop-in air filter. Million-mile limited warranty; boosts throttle response.",
      imageUrl: "/images/placeholders/filters.svg",
      categorySlug: "filters",
      brandName: "K&N",
      supplierSlug: "pacific-rim",
      priceCents: 5999,
      supplierCostCents: 3599,
      weightGrams: 700,
      installEligible: true,
      laborHoursTenths: 5,
      installFixedFeeCents: null,
      universalFit: false,
      inStock: true,
      fitments: [
        { modelId: model("Ford F-150"), yearFrom: 2015, yearTo: 2023, engineId: null },
        { modelId: model("Ford Mustang"), yearFrom: 2015, yearTo: 2023, engineId: null },
      ],
    },
    {
      sku: "PP-ACC-9006",
      slug: uniqueSlug("bosch-icon-wiper-blade-pair"),
      name: "Bosch ICON Wiper Blade Pair — 26/18",
      description:
        "Bosch ICON beam wiper blades, 26in driver + 18in passenger. Fits most hook-arm vehicles.",
      imageUrl: "/images/placeholders/wipers.svg",
      categorySlug: "accessories",
      brandName: "Bosch",
      supplierSlug: "precision-parts",
      priceCents: 3899,
      supplierCostCents: 2299,
      weightGrams: 800,
      installEligible: false,
      laborHoursTenths: 5,
      installFixedFeeCents: null,
      universalFit: true,
      inStock: true,
      fitments: [],
    },
  );

  const partsBySku = new Map<string, Part>();
  for (const seed of partSeeds) {
    const categoryId = categoryIdBySlug.get(seed.categorySlug);
    const brandId = brandIdByName.get(seed.brandName);
    const supplier = suppliersBySlug.get(seed.supplierSlug);
    if (!categoryId || !brandId || !supplier) throw new Error(`Bad refs for ${seed.sku}`);
    const part = await db.part.create({
      data: {
        sku: seed.sku,
        slug: seed.slug,
        name: seed.name,
        description: seed.description,
        imageUrl: seed.imageUrl,
        categoryId,
        brandId,
        supplierId: supplier.id,
        priceCents: seed.priceCents,
        supplierCostCents: seed.supplierCostCents,
        weightGrams: seed.weightGrams,
        installEligible: seed.installEligible,
        laborHoursTenths: seed.laborHoursTenths,
        installFixedFeeCents: seed.installFixedFeeCents,
        universalFit: seed.universalFit,
        inStock: seed.inStock,
      },
    });
    if (seed.fitments.length > 0) {
      await db.fitment.createMany({
        data: seed.fitments.map((f) => ({ partId: part.id, ...f })),
      });
    }
    partsBySku.set(seed.sku, part);
  }
  const part = (sku: string): Part => {
    const p = partsBySku.get(sku);
    if (!p) throw new Error(`Missing part ${sku}`);
    return p;
  };

  // ---- users --------------------------------------------------------------
  const passwordHash = bcrypt.hashSync("password123", 10); // hash once, reuse

  const admin = await db.user.create({
    data: {
      email: "admin@demo.test",
      passwordHash,
      name: "Avery Admin",
      role: Role.ADMIN,
    },
  });

  const customer = await db.user.create({
    data: {
      email: "customer@demo.test",
      passwordHash,
      name: "Casey Customer",
      phone: "+1 512 555 0142",
      role: Role.CUSTOMER,
      addresses: {
        create: {
          label: "Home",
          line1: "2204 Barton Springs Rd",
          line2: "Apt 314",
          city: "Austin",
          state: "TX",
          zip: "78704",
          isDefault: true,
        },
      },
      vehicles: {
        create: [
          {
            modelId: model("Toyota Camry"),
            year: 2019,
            engineId: engine("Toyota Camry|2.5L I4"),
            nickname: "Daily driver",
          },
          {
            modelId: model("Ford F-150"),
            year: 2021,
            engineId: engine("Ford F-150|3.5L EcoBoost V6"),
            nickname: "Work truck",
          },
        ],
      },
    },
  });

  const jordan = await db.user.create({
    data: {
      email: "jordan@demo.test",
      passwordHash,
      name: "Jordan Rivera",
      phone: "+1 512 555 0177",
      role: Role.CUSTOMER,
      addresses: {
        create: {
          label: "Home",
          line1: "900 Congress Ave",
          city: "Austin",
          state: "TX",
          zip: "78701",
          isDefault: true,
        },
      },
    },
  });

  const supplierUserIdBySupplierId = new Map<string, string>();
  for (const s of SUPPLIERS) {
    const row = suppliersBySlug.get(s.slug);
    if (!row) continue;
    const u = await db.user.create({
      data: {
        email: `${s.slug}@supplier.test`,
        passwordHash,
        name: `${s.name} Ops`,
        role: Role.SUPPLIER,
        supplierId: row.id,
      },
    });
    supplierUserIdBySupplierId.set(row.id, u.id);
  }

  const installerUserIdByInstallerId = new Map<string, string>();
  for (const i of INSTALLERS) {
    const row = installersBySlug.get(i.slug);
    if (!row) continue;
    const u = await db.user.create({
      data: {
        email: `${i.slug}@installer.test`,
        passwordHash,
        name: `${i.name} Front Desk`,
        role: Role.INSTALLER,
        installerId: row.id,
      },
    });
    installerUserIdByInstallerId.set(row.id, u.id);
  }

  // ---- shortcuts ----------------------------------------------------------
  const sup = (slug: string): Supplier => {
    const s = suppliersBySlug.get(slug);
    if (!s) throw new Error(`Missing supplier ${slug}`);
    return s;
  };
  const shop = (slug: string): Installer => {
    const i = installersBySlug.get(slug);
    if (!i) throw new Error(`Missing installer ${slug}`);
    return i;
  };

  const customerAddress = {
    name: "Casey Customer",
    line1: "2204 Barton Springs Rd",
    line2: "Apt 314" as string | null,
    city: "Austin",
    state: "TX",
    zip: "78704",
  };
  const jordanAddress = {
    name: "Jordan Rivera",
    line1: "900 Congress Ave",
    line2: null as string | null,
    city: "Austin",
    state: "TX",
    zip: "78701",
  };
  const CAMRY_DESC = "2019 Toyota Camry 2.5L I4";
  const F150_DESC = "2021 Ford F-150 3.5L EcoBoost V6";

  // ---- order builder ------------------------------------------------------
  let orderSeq = 100001; // Counter "order" is seeded at 100050 — stay below.
  let poSeq = 100001; // Counter "po" is seeded at 100080 — stay below.
  let paySeq = 1;
  let refundSeq = 1;

  interface SeedLine {
    part: Part;
    supplier: Supplier;
    qty?: number;
    withInstall?: boolean;
    installer?: Installer;
    shipTo?: ShipTo;
  }
  interface POPlan {
    status: POStatus;
    carrier?: string;
    trackingNumber?: string;
    rejectReason?: string;
  }
  interface ApptPlan {
    installer: Installer;
    startAt: Date;
    status: AppointmentStatus;
    completedAt?: Date;
    cancelledAt?: Date;
    noShowAt?: Date;
    partsReadyAt?: Date;
  }
  interface SeedOrderOpts {
    user: User;
    address: typeof customerAddress;
    vehicleDesc: string | null;
    lines: SeedLine[];
    placedAt: Date;
    status: OrderStatus;
    paidAt?: Date;
    paymentStatus: PaymentStatus;
    paymentError?: string;
    poPlans?: POPlan[];
    appointment?: ApptPlan;
    cancel?: { at: Date; reason: string; byUserId: string };
    fullRefund?: boolean;
    installOnlyRefund?: { at: Date };
  }

  const PO_RANK: Record<string, number> = {
    [POStatus.PENDING_CONFIRMATION]: 0,
    [POStatus.CONFIRMED]: 1,
    [POStatus.REJECTED]: 1,
    [POStatus.SHIPPED]: 2,
    [POStatus.DELIVERED]: 3,
    [POStatus.RECEIVED]: 4,
    [POStatus.CANCELLED]: 0,
  };

  async function createSeedOrder(opts: SeedOrderOpts): Promise<{ id: string; orderNumber: string }> {
    const rate = taxRateBps();
    const inputs: QuoteItemInput[] = opts.lines.map((l) => ({
      partId: l.part.id,
      qty: l.qty ?? 1,
      priceCents: l.part.priceCents,
      supplierId: l.supplier.id,
      supplierCostCents: l.part.supplierCostCents,
      installEligible: l.part.installEligible,
      laborHoursTenths: l.part.laborHoursTenths,
      installFixedFeeCents: l.part.installFixedFeeCents,
      withInstall: l.withInstall ?? false,
      installerId: l.installer?.id ?? null,
      installerHourlyRateCents: l.installer?.hourlyRateCents ?? null,
      apptStartAt: opts.appointment?.startAt ?? null,
      shipTo: l.shipTo ?? ShipTo.HOME,
    }));
    const supplierCfg: Record<string, { shippingFlatCents: number; shippingPerItemCents: number }> = {};
    for (const l of opts.lines) {
      supplierCfg[l.supplier.id] = {
        shippingFlatCents: l.supplier.shippingFlatCents,
        shippingPerItemCents: l.supplier.shippingPerItemCents,
      };
    }
    const quote = priceQuote(inputs, supplierCfg, rate);

    const orderNumber = `ORD-${orderSeq++}`;
    const installLines = quote.lines.filter((l) => l.withInstall);
    const installSum = installLines.reduce((s, l) => s + l.installTotalCents, 0);
    const refundedTotalCents = opts.fullRefund
      ? quote.totalCents
      : opts.installOnlyRefund
        ? installSum
        : 0;

    const order = await db.order.create({
      data: {
        orderNumber,
        userId: opts.user.id,
        status: opts.status,
        partsSubtotalCents: quote.partsSubtotalCents,
        installSubtotalCents: quote.installSubtotalCents,
        shippingTotalCents: quote.shippingTotalCents,
        taxRateBps: quote.taxRateBps,
        taxCents: quote.taxCents,
        totalCents: quote.totalCents,
        refundedTotalCents,
        shipName: opts.address.name,
        shipLine1: opts.address.line1,
        shipLine2: opts.address.line2,
        shipCity: opts.address.city,
        shipState: opts.address.state,
        shipZip: opts.address.zip,
        contactEmail: opts.user.email,
        contactPhone: opts.user.phone,
        vehicleDesc: opts.vehicleDesc,
        shippingGroupsJson: JSON.stringify(
          quote.groups.map((g) => ({
            key: g.key,
            supplierId: g.supplierId,
            shipTo: g.shipTo,
            installerId: g.installerId,
            shippingCents: g.shippingCents,
            supplierCostTotalCents: g.supplierCostTotalCents,
          })),
        ),
        placedAt: opts.placedAt,
        paidAt: opts.paidAt ?? null,
        cancelledAt: opts.cancel?.at ?? null,
        cancelReason: opts.cancel?.reason ?? null,
        completedAt:
          opts.status === OrderStatus.COMPLETED
            ? opts.appointment?.completedAt ??
              opts.appointment?.cancelledAt ??
              (opts.paidAt ? plus(opts.paidAt, 3.5 * DAY) : opts.placedAt)
            : null,
        items: {
          create: quote.lines.map((line) => ({
            partId: line.partId,
            supplierId: line.supplierId,
            skuSnapshot: partsBySkuReverse(line.partId).sku,
            nameSnapshot: partsBySkuReverse(line.partId).name,
            imageUrlSnapshot: partsBySkuReverse(line.partId).imageUrl,
            unitPriceCents: line.unitPriceCents,
            supplierCostCentsSnapshot: line.supplierCostCents,
            qty: line.qty,
            lineTotalCents: line.lineTotalCents,
            withInstall: line.withInstall,
            laborHoursTenthsSnapshot: line.laborHoursTenths,
            shopRateCentsSnapshot: line.shopRateCents,
            installUnitCents: line.installUnitCents,
            installTotalCents: line.installTotalCents,
            installRefunded: Boolean(opts.installOnlyRefund && line.withInstall),
            shipTo: line.shipTo,
            installerIdSnapshot: line.installerId,
            requestedApptStartAt: line.apptStartAt,
            itemStatus: opts.fullRefund ? OrderItemStatus.REFUNDED : OrderItemStatus.PENDING,
          })),
        },
      },
    });

    const items = await db.orderItem.findMany({ where: { orderId: order.id } });
    const itemByPartId = new Map(items.map((i) => [i.partId, i]));

    // ---- payment + webhook ledger ----
    const payNo = String(paySeq++).padStart(3, "0");
    const intentId = `mock_pi_seed_${payNo}`;
    const paymentRow = await db.payment.create({
      data: {
        orderId: order.id,
        provider: PayProvider.MOCK,
        providerIntentId: intentId,
        clientSecret: `mock_cs_seed_${payNo}`,
        amountCents: quote.totalCents,
        currency: "usd",
        status: opts.paymentStatus,
        lastError: opts.paymentError ?? null,
        createdAt: opts.placedAt,
        succeededAt: opts.paymentStatus === PaymentStatus.SUCCEEDED ? opts.paidAt ?? opts.placedAt : null,
      },
    });
    if (opts.paymentStatus === PaymentStatus.SUCCEEDED && opts.paidAt) {
      await db.webhookEvent.create({
        data: {
          provider: PayProvider.MOCK,
          eventId: `mock:${intentId}:succeeded`,
          type: "payment.succeeded",
          payloadJson: JSON.stringify({ intentId }),
          processedAt: opts.paidAt,
        },
      });
    } else if (opts.paymentStatus === PaymentStatus.FAILED) {
      await db.webhookEvent.create({
        data: {
          provider: PayProvider.MOCK,
          eventId: `mock:${intentId}:failed`,
          type: "payment.failed",
          payloadJson: JSON.stringify({ intentId }),
          processedAt: plus(opts.placedAt, 2 * 60_000),
        },
      });
    }

    const events: Array<{
      entityType: string;
      entityId: string;
      action: string;
      fromStatus?: string | null;
      toStatus?: string | null;
      actorUserId?: string | null;
      actorRole?: string | null;
      internal?: boolean;
      message: string;
      createdAt: Date;
    }> = [];

    events.push({
      entityType: EntityType.ORDER,
      entityId: order.id,
      action: "created",
      toStatus: OrderStatus.PENDING_PAYMENT,
      actorUserId: opts.user.id,
      actorRole: Role.CUSTOMER,
      message: `Order ${orderNumber} placed — awaiting payment`,
      createdAt: opts.placedAt,
    });

    if (opts.paymentStatus === PaymentStatus.FAILED) {
      events.push({
        entityType: EntityType.PAYMENT,
        entityId: paymentRow.id,
        action: "status_change",
        fromStatus: OrderStatus.PENDING_PAYMENT,
        toStatus: OrderStatus.PAYMENT_FAILED,
        actorRole: "SYSTEM",
        message: `Payment failed: ${opts.paymentError ?? "declined"} — you can retry from the payment page`,
        createdAt: plus(opts.placedAt, 2 * 60_000),
      });
      await db.notification.create({
        data: {
          userId: opts.user.id,
          type: "payment_failed",
          title: "Payment failed",
          body: `Payment for ${orderNumber} did not go through. You can retry.`,
          href: `/checkout/pay/${order.id}`,
          createdAt: plus(opts.placedAt, 2 * 60_000),
        },
      });
    }

    // ---- POs + appointment (only for paid orders) ----
    if (opts.paidAt) {
      const paidAt = opts.paidAt;
      events.push({
        entityType: EntityType.ORDER,
        entityId: order.id,
        action: "status_change",
        fromStatus: OrderStatus.PENDING_PAYMENT,
        toStatus: OrderStatus.PAID,
        actorRole: "SYSTEM",
        message: `Payment received for ${orderNumber}`,
        createdAt: paidAt,
      });
      events.push({
        entityType: EntityType.ORDER,
        entityId: order.id,
        action: "status_change",
        fromStatus: OrderStatus.PAID,
        toStatus: OrderStatus.PROCESSING,
        actorRole: "SYSTEM",
        message: "Purchase orders sent to suppliers",
        createdAt: paidAt,
      });
      await db.notification.create({
        data: {
          userId: opts.user.id,
          type: "order_paid",
          title: `Order ${orderNumber} confirmed`,
          body: "Payment received. Your parts are on the way from our suppliers.",
          href: `/account/orders/${order.id}`,
          createdAt: paidAt,
        },
      });

      let lastTerminalAt = paidAt;
      for (let gi = 0; gi < quote.groups.length; gi++) {
        const group = quote.groups[gi];
        const plan: POPlan = opts.poPlans?.[gi] ?? { status: POStatus.PENDING_CONFIRMATION };
        const supplier = supplierList.find((s) => s.id === group.supplierId);
        if (!supplier) throw new Error("Supplier missing at seed PO fan-out");
        const poNumber = `PO-${poSeq++}`;
        const rank = PO_RANK[plan.status];
        const tConfirm = plus(paidAt, 8 * HOUR);
        const tShip = plus(paidAt, 36 * HOUR);
        const tDeliver = plus(paidAt, 3.5 * DAY);
        const tReceive = plus(paidAt, 4 * DAY);
        const carrier = plan.carrier ?? "UPS";
        const trackingNumber = plan.trackingNumber ?? `1Z999AA10${poSeq}${ri(100, 999)}`;
        const shipped = plan.status !== POStatus.CANCELLED && plan.status !== POStatus.REJECTED && rank >= 2;

        const installerShop =
          group.shipTo === ShipTo.INSTALLER && group.installerId
            ? Array.from(installersBySlug.values()).find((i) => i.id === group.installerId)
            : undefined;
        const dest = installerShop
          ? {
              destName: `${installerShop.name} (Attn: Order ${orderNumber})`,
              destLine1: installerShop.line1,
              destLine2: null as string | null,
              destCity: installerShop.city,
              destState: installerShop.state,
              destZip: installerShop.zip,
            }
          : {
              destName: opts.address.name,
              destLine1: opts.address.line1,
              destLine2: opts.address.line2,
              destCity: opts.address.city,
              destState: opts.address.state,
              destZip: opts.address.zip,
            };

        const po = await db.purchaseOrder.create({
          data: {
            poNumber,
            orderId: order.id,
            supplierId: group.supplierId,
            status: plan.status,
            shipTo: group.shipTo,
            installerId: group.installerId,
            ...dest,
            supplierCostTotalCents: group.supplierCostTotalCents,
            shippingFeeCents: group.shippingCents,
            rejectReason: plan.status === POStatus.REJECTED ? plan.rejectReason ?? "Rejected" : null,
            carrier: shipped ? carrier : null,
            trackingNumber: shipped ? trackingNumber : null,
            trackingUrl: shipped ? carrierTrackingUrl(carrier, trackingNumber) : null,
            dueAt: plus(paidAt, supplier.leadTimeDays * DAY),
            confirmedAt: plan.status !== POStatus.REJECTED && plan.status !== POStatus.CANCELLED && rank >= 1 ? tConfirm : null,
            shippedAt: shipped ? tShip : null,
            deliveredAt: shipped && rank >= 3 ? tDeliver : null,
            receivedAt: shipped && rank >= 4 ? tReceive : null,
            cancelledAt: plan.status === POStatus.CANCELLED ? opts.cancel?.at ?? paidAt : null,
            createdAt: paidAt,
          },
        });

        // Link the group's items to the PO.
        const groupItemIds = quote.lines
          .filter((l) => l.groupKey === group.key)
          .map((l) => itemByPartId.get(l.partId)?.id)
          .filter((x): x is string => Boolean(x));
        await db.orderItem.updateMany({
          where: { id: { in: groupItemIds } },
          data: { purchaseOrderId: po.id },
        });

        events.push({
          entityType: EntityType.PURCHASE_ORDER,
          entityId: po.id,
          action: "created",
          toStatus: POStatus.PENDING_CONFIRMATION,
          actorRole: "SYSTEM",
          message: `${poNumber} sent to ${supplier.name} (${groupItemIds.length} item${groupItemIds.length > 1 ? "s" : ""})`,
          createdAt: paidAt,
        });
        const supplierUserId = supplierUserIdBySupplierId.get(supplier.id);
        if (supplierUserId) {
          await db.notification.create({
            data: {
              userId: supplierUserId,
              type: "po_new",
              title: `New purchase order ${poNumber}`,
              body: `Order ${orderNumber}: ${groupItemIds.length} line(s) to fulfill.`,
              href: `/supplier/pos/${po.id}`,
              createdAt: paidAt,
            },
          });
        }

        const supplierUser = supplierUserIdBySupplierId.get(supplier.id) ?? null;
        if (plan.status !== POStatus.CANCELLED && plan.status !== POStatus.REJECTED && rank >= 1) {
          events.push({
            entityType: EntityType.PURCHASE_ORDER,
            entityId: po.id,
            action: "status_change",
            fromStatus: POStatus.PENDING_CONFIRMATION,
            toStatus: POStatus.CONFIRMED,
            actorUserId: supplierUser,
            actorRole: Role.SUPPLIER,
            message: `Supplier ${supplier.name} confirmed ${poNumber}`,
            createdAt: tConfirm,
          });
        }
        if (plan.status === POStatus.REJECTED) {
          events.push({
            entityType: EntityType.PURCHASE_ORDER,
            entityId: po.id,
            action: "status_change",
            fromStatus: POStatus.PENDING_CONFIRMATION,
            toStatus: POStatus.REJECTED,
            actorUserId: supplierUser,
            actorRole: Role.SUPPLIER,
            internal: true,
            message: `Supplier ${supplier.name} rejected ${poNumber}: ${plan.rejectReason ?? "Rejected"}`,
            createdAt: plus(paidAt, 10 * HOUR),
          });
          await db.notification.create({
            data: {
              userId: admin.id,
              type: "po_rejected",
              title: `PO rejected: ${poNumber}`,
              body: `${supplier.name} rejected ${poNumber} (${plan.rejectReason ?? "Rejected"}). Resolve with a refund.`,
              href: `/admin/orders/${order.id}`,
              createdAt: plus(paidAt, 10 * HOUR),
            },
          });
        }
        if (shipped) {
          events.push({
            entityType: EntityType.PURCHASE_ORDER,
            entityId: po.id,
            action: "status_change",
            fromStatus: POStatus.CONFIRMED,
            toStatus: POStatus.SHIPPED,
            actorUserId: supplierUser,
            actorRole: Role.SUPPLIER,
            message: `${poNumber} shipped via ${carrier} (${trackingNumber})`,
            createdAt: tShip,
          });
          await db.notification.create({
            data: {
              userId: opts.user.id,
              type: "po_shipped",
              title: "Parts shipped",
              body: `${poNumber} shipped via ${carrier}. Tracking: ${trackingNumber}`,
              href: `/account/orders/${order.id}`,
              createdAt: tShip,
            },
          });
        }
        if (shipped && rank >= 3) {
          events.push({
            entityType: EntityType.PURCHASE_ORDER,
            entityId: po.id,
            action: "status_change",
            fromStatus: POStatus.SHIPPED,
            toStatus: POStatus.DELIVERED,
            actorRole: "SYSTEM",
            message:
              group.shipTo === ShipTo.INSTALLER
                ? `${poNumber} delivered to ${dest.destName}`
                : `${poNumber} delivered`,
            createdAt: tDeliver,
          });
          lastTerminalAt = tDeliver > lastTerminalAt ? tDeliver : lastTerminalAt;
        }
        if (shipped && rank >= 4) {
          const installerUserId = group.installerId
            ? installerUserIdByInstallerId.get(group.installerId) ?? null
            : null;
          events.push({
            entityType: EntityType.PURCHASE_ORDER,
            entityId: po.id,
            action: "status_change",
            fromStatus: POStatus.DELIVERED,
            toStatus: POStatus.RECEIVED,
            actorUserId: installerUserId,
            actorRole: Role.INSTALLER,
            message: `${dest.destName} received parts from ${poNumber}`,
            createdAt: tReceive,
          });
          lastTerminalAt = tReceive > lastTerminalAt ? tReceive : lastTerminalAt;
        }
        if (plan.status === POStatus.CANCELLED) {
          events.push({
            entityType: EntityType.PURCHASE_ORDER,
            entityId: po.id,
            action: "status_change",
            fromStatus: POStatus.PENDING_CONFIRMATION,
            toStatus: POStatus.CANCELLED,
            actorRole: "SYSTEM",
            message: `${poNumber} cancelled`,
            createdAt: opts.cancel?.at ?? paidAt,
          });
        }
      }

      // ---- appointment ----
      if (opts.appointment) {
        const a = opts.appointment;
        const apptInstallLines = quote.lines.filter((l) => l.withInstall);
        const totalLaborTenths = apptInstallLines.reduce(
          (s, l) => s + (l.laborHoursTenths ?? 0) * l.qty,
          0,
        );
        const blocks = blocksNeeded(totalLaborTenths, a.installer.slotMinutes);
        const appt = await db.appointment.create({
          data: {
            orderId: order.id,
            installerId: a.installer.id,
            startAt: a.startAt,
            durationMinutes: blocks * a.installer.slotMinutes,
            status: a.status,
            totalLaborHoursTenths: totalLaborTenths,
            vehicleDesc: opts.vehicleDesc,
            customerName: opts.address.name,
            customerPhone: opts.user.phone,
            partsReadyAt: a.partsReadyAt ?? null,
            completedAt: a.completedAt ?? null,
            cancelledAt: a.cancelledAt ?? null,
            createdAt: paidAt,
          },
        });
        const apptItemIds = apptInstallLines
          .map((l) => itemByPartId.get(l.partId)?.id)
          .filter((x): x is string => Boolean(x));
        await db.orderItem.updateMany({
          where: { id: { in: apptItemIds } },
          data: { appointmentId: appt.id },
        });

        events.push({
          entityType: EntityType.APPOINTMENT,
          entityId: appt.id,
          action: "created",
          toStatus: AppointmentStatus.PENDING_PARTS,
          actorRole: "SYSTEM",
          message: `Installation booked at ${a.installer.name} for ${a.startAt.toISOString()} (awaiting parts)`,
          createdAt: paidAt,
        });
        const installerUserId = installerUserIdByInstallerId.get(a.installer.id);
        if (installerUserId) {
          await db.notification.create({
            data: {
              userId: installerUserId,
              type: "appt_new",
              title: "New installation booked",
              body: `Order ${orderNumber} booked an install at your shop.`,
              href: `/installer/appointments/${appt.id}`,
              createdAt: paidAt,
            },
          });
        }
        if (a.partsReadyAt) {
          events.push({
            entityType: EntityType.APPOINTMENT,
            entityId: appt.id,
            action: "status_change",
            fromStatus: AppointmentStatus.PENDING_PARTS,
            toStatus: AppointmentStatus.READY,
            actorRole: "SYSTEM",
            message: `All parts ready — appointment at ${a.installer.name} confirmed`,
            createdAt: a.partsReadyAt,
          });
          await db.notification.create({
            data: {
              userId: opts.user.id,
              type: "appt_ready",
              title: "Appointment confirmed",
              body: `Parts have arrived — your appointment at ${a.installer.name} is confirmed.`,
              href: "/account/appointments",
              createdAt: a.partsReadyAt,
            },
          });
        }
        if (a.status === AppointmentStatus.COMPLETED && a.completedAt) {
          events.push({
            entityType: EntityType.APPOINTMENT,
            entityId: appt.id,
            action: "status_change",
            fromStatus: AppointmentStatus.READY,
            toStatus: AppointmentStatus.COMPLETED,
            actorUserId: installerUserIdByInstallerId.get(a.installer.id) ?? null,
            actorRole: Role.INSTALLER,
            message: `Installation completed at ${a.installer.name}`,
            createdAt: a.completedAt,
          });
          await db.notification.create({
            data: {
              userId: opts.user.id,
              type: "install_done",
              title: "Installation complete",
              body: `Your installation at ${a.installer.name} is done. Thanks for choosing PartsPro!`,
              href: `/account/orders/${order.id}`,
              createdAt: a.completedAt,
            },
          });
        }
        if (a.status === AppointmentStatus.NO_SHOW && a.noShowAt) {
          events.push({
            entityType: EntityType.APPOINTMENT,
            entityId: appt.id,
            action: "status_change",
            fromStatus: AppointmentStatus.READY,
            toStatus: AppointmentStatus.NO_SHOW,
            actorUserId: installerUserIdByInstallerId.get(a.installer.id) ?? null,
            actorRole: Role.INSTALLER,
            message: `Customer did not show for the ${a.installer.name} appointment`,
            createdAt: a.noShowAt,
          });
        }
        if (a.status === AppointmentStatus.CANCELLED && a.cancelledAt) {
          events.push({
            entityType: EntityType.APPOINTMENT,
            entityId: appt.id,
            action: "status_change",
            fromStatus: AppointmentStatus.PENDING_PARTS,
            toStatus: AppointmentStatus.CANCELLED,
            actorUserId: opts.user.id,
            actorRole: Role.CUSTOMER,
            message: "Installation appointment cancelled",
            createdAt: a.cancelledAt,
          });
        }
      }

      // ---- derived order-status rollup trail ----
      if (
        opts.status === OrderStatus.PARTIALLY_FULFILLED ||
        opts.status === OrderStatus.FULFILLED ||
        opts.status === OrderStatus.COMPLETED
      ) {
        const fulfilledTarget =
          opts.status === OrderStatus.PARTIALLY_FULFILLED
            ? OrderStatus.PARTIALLY_FULFILLED
            : OrderStatus.FULFILLED;
        events.push({
          entityType: EntityType.ORDER,
          entityId: order.id,
          action: "status_change",
          fromStatus: OrderStatus.PROCESSING,
          toStatus: fulfilledTarget,
          actorRole: "SYSTEM",
          message:
            fulfilledTarget === OrderStatus.FULFILLED
              ? `All parts for ${orderNumber} have been delivered`
              : `Order ${orderNumber}: some parts delivered`,
          createdAt: lastTerminalAt,
        });
        if (opts.status === OrderStatus.COMPLETED) {
          const completedAt =
            opts.appointment?.completedAt ??
            opts.appointment?.cancelledAt ??
            plus(lastTerminalAt, 1 * HOUR);
          events.push({
            entityType: EntityType.ORDER,
            entityId: order.id,
            action: "status_change",
            fromStatus: OrderStatus.FULFILLED,
            toStatus: OrderStatus.COMPLETED,
            actorRole: "SYSTEM",
            message: `Order ${orderNumber} completed`,
            createdAt: completedAt,
          });
        }
      }

      // ---- cancellation + full refund ----
      if (opts.cancel) {
        events.push({
          entityType: EntityType.ORDER,
          entityId: order.id,
          action: "status_change",
          fromStatus: OrderStatus.PROCESSING,
          toStatus: OrderStatus.CANCELLED,
          actorUserId: opts.cancel.byUserId,
          actorRole: Role.CUSTOMER,
          message: `Order ${orderNumber} cancelled: ${opts.cancel.reason}`,
          createdAt: opts.cancel.at,
        });
      }
      if (opts.fullRefund) {
        {
          const refund = await db.refund.create({
            data: {
              orderId: order.id,
              paymentId: paymentRow.id,
              amountCents: quote.totalCents,
              reason: opts.cancel?.reason ?? "Order cancelled",
              providerRefundId: `mock_re_seed_${String(refundSeq++).padStart(3, "0")}`,
              status: RefundStatus.SUCCEEDED,
              createdByUserId: opts.cancel?.byUserId ?? null,
              createdAt: opts.cancel?.at ?? opts.placedAt,
            },
          });
          events.push({
            entityType: EntityType.REFUND,
            entityId: refund.id,
            action: "created",
            actorRole: "SYSTEM",
            message: `Full refund of $${(quote.totalCents / 100).toFixed(2)} issued for ${orderNumber}`,
            createdAt: opts.cancel?.at ?? opts.placedAt,
          });
          events.push({
            entityType: EntityType.ORDER,
            entityId: order.id,
            action: "status_change",
            fromStatus: OrderStatus.CANCELLED,
            toStatus: OrderStatus.REFUNDED,
            actorRole: "SYSTEM",
            message: `Order ${orderNumber} fully refunded`,
            createdAt: opts.cancel?.at ?? opts.placedAt,
          });
          await db.notification.create({
            data: {
              userId: opts.user.id,
              type: "refund_issued",
              title: "Refund issued",
              body: `Your refund for ${orderNumber} has been processed in full.`,
              href: `/account/orders/${order.id}`,
              createdAt: opts.cancel?.at ?? opts.placedAt,
            },
          });
        }
      }
      if (opts.installOnlyRefund) {
        if (installSum > 0) {
          const refund = await db.refund.create({
            data: {
              orderId: order.id,
              paymentId: paymentRow.id,
              amountCents: installSum,
              reason: "Install-only cancellation (>=24h before slot)",
              providerRefundId: `mock_re_seed_${String(refundSeq++).padStart(3, "0")}`,
              status: RefundStatus.SUCCEEDED,
              createdByUserId: opts.user.id,
              createdAt: opts.installOnlyRefund.at,
            },
          });
          events.push({
            entityType: EntityType.REFUND,
            entityId: refund.id,
            action: "created",
            actorRole: "SYSTEM",
            message: `Install labor refund of $${(installSum / 100).toFixed(2)} issued for ${orderNumber}`,
            createdAt: opts.installOnlyRefund.at,
          });
        }
      }
    }

    await db.eventLog.createMany({
      data: events.map((e) => ({
        orderId: order.id,
        entityType: e.entityType,
        entityId: e.entityId,
        action: e.action,
        fromStatus: e.fromStatus ?? null,
        toStatus: e.toStatus ?? null,
        actorUserId: e.actorUserId ?? null,
        actorRole: e.actorRole ?? null,
        internal: e.internal ?? false,
        message: e.message,
        metaJson: "{}",
        createdAt: e.createdAt,
      })),
    });

    return { id: order.id, orderNumber };
  }

  // Reverse lookup used inside createSeedOrder for item snapshots.
  const partById = new Map<string, Part>(Array.from(partsBySku.values()).map((p) => [p.id, p]));
  function partsBySkuReverse(partId: string): Part {
    const p = partById.get(partId);
    if (!p) throw new Error(`Unknown part id ${partId}`);
    return p;
  }

  // ---- historical orders --------------------------------------------------
  const loneStar = shop("lone-star");
  const hillCountry = shop("hill-country");
  const empire = shop("empire-auto");
  const goldenGate = shop("golden-gate");

  const brakePads = part("PP-BRK-9001");
  const struts = part("PP-SUS-9002");
  const radiator = part("PP-COL-9003");
  const battery = part("PP-ELC-9004");
  const airFilter = part("PP-FLT-9005");
  const beltI4 = part("PP-ENG-9102");
  const beltV6 = part("PP-ENG-9101");
  const plugsV8 = part("PP-IGN-9103");

  // (a) COMPLETED order with install — appointment COMPLETED 20 days ago.
  {
    const startAt = blockStartNear(loneStar, daysAgo(20), -1, 1);
    const paidAt = plus(daysAgo(30), 10 * 60_000);
    await createSeedOrder({
      user: customer,
      address: customerAddress,
      vehicleDesc: CAMRY_DESC,
      lines: [
        {
          part: brakePads,
          supplier: sup("automax"),
          qty: 1,
          withInstall: true,
          installer: loneStar,
          shipTo: ShipTo.INSTALLER,
        },
      ],
      placedAt: daysAgo(30),
      paidAt,
      status: OrderStatus.COMPLETED,
      paymentStatus: PaymentStatus.SUCCEEDED,
      poPlans: [{ status: POStatus.RECEIVED }],
      appointment: {
        installer: loneStar,
        startAt,
        status: AppointmentStatus.COMPLETED,
        partsReadyAt: plus(paidAt, 4 * DAY),
        completedAt: plus(startAt, 3 * HOUR),
      },
    });
  }

  // (b) PROCESSING multi-supplier — one PO CONFIRMED, one PENDING_CONFIRMATION.
  await createSeedOrder({
    user: customer,
    address: customerAddress,
    vehicleDesc: F150_DESC,
    lines: [
      { part: airFilter, supplier: sup("pacific-rim"), qty: 1 },
      { part: beltI4, supplier: sup("southern-gear"), qty: 2 },
    ],
    placedAt: daysAgo(3),
    paidAt: plus(daysAgo(3), 12 * 60_000),
    status: OrderStatus.PROCESSING,
    paymentStatus: PaymentStatus.SUCCEEDED,
    poPlans: [{ status: POStatus.CONFIRMED }, { status: POStatus.PENDING_CONFIRMATION }],
  });

  // (c) PARTIALLY_FULFILLED — one PO DELIVERED home, one SHIPPED w/ UPS tracking.
  await createSeedOrder({
    user: customer,
    address: customerAddress,
    vehicleDesc: CAMRY_DESC,
    lines: [
      { part: radiator, supplier: sup("precision-parts"), qty: 1 },
      { part: struts, supplier: sup("midwest-auto"), qty: 1 },
    ],
    placedAt: daysAgo(8),
    paidAt: plus(daysAgo(8), 15 * 60_000),
    status: OrderStatus.PARTIALLY_FULFILLED,
    paymentStatus: PaymentStatus.SUCCEEDED,
    poPlans: [
      { status: POStatus.DELIVERED },
      { status: POStatus.SHIPPED, carrier: "UPS", trackingNumber: "1Z999AA10123456784" },
    ],
  });

  // (d) FULFILLED with appointment READY 3 days from now (ship-to-shop, PO RECEIVED).
  {
    const paidAt = plus(daysAgo(6), 20 * 60_000);
    await createSeedOrder({
      user: customer,
      address: customerAddress,
      vehicleDesc: CAMRY_DESC,
      lines: [
        {
          part: radiator,
          supplier: sup("precision-parts"),
          qty: 1,
          withInstall: true,
          installer: loneStar,
          shipTo: ShipTo.INSTALLER,
        },
      ],
      placedAt: daysAgo(6),
      paidAt,
      status: OrderStatus.FULFILLED,
      paymentStatus: PaymentStatus.SUCCEEDED,
      poPlans: [{ status: POStatus.RECEIVED }],
      appointment: {
        installer: loneStar,
        startAt: blockStartNear(loneStar, daysFromNow(3), 1, 1),
        status: AppointmentStatus.READY,
        partsReadyAt: plus(paidAt, 4 * DAY),
      },
    });
  }

  // (e) PENDING_PAYMENT placed 2h ago.
  await createSeedOrder({
    user: customer,
    address: customerAddress,
    vehicleDesc: CAMRY_DESC,
    lines: [{ part: beltI4, supplier: sup("southern-gear"), qty: 1 }],
    placedAt: hoursAgo(2),
    status: OrderStatus.PENDING_PAYMENT,
    paymentStatus: PaymentStatus.REQUIRES_PAYMENT,
  });

  // (f) PAYMENT_FAILED placed 1h ago.
  await createSeedOrder({
    user: customer,
    address: customerAddress,
    vehicleDesc: F150_DESC,
    lines: [{ part: plugsV8, supplier: sup("automax"), qty: 1 }],
    placedAt: hoursAgo(1),
    status: OrderStatus.PAYMENT_FAILED,
    paymentStatus: PaymentStatus.FAILED,
    paymentError: "Card declined (simulated)",
  });

  // (g) Cancelled pre-confirmation, fully REFUNDED.
  await createSeedOrder({
    user: customer,
    address: customerAddress,
    vehicleDesc: CAMRY_DESC,
    lines: [{ part: battery, supplier: sup("southern-gear"), qty: 1 }],
    placedAt: daysAgo(15),
    paidAt: plus(daysAgo(15), 8 * 60_000),
    status: OrderStatus.REFUNDED,
    paymentStatus: PaymentStatus.SUCCEEDED,
    poPlans: [{ status: POStatus.CANCELLED }],
    cancel: { at: daysAgo(14), reason: "Ordered the wrong part", byUserId: customer.id },
    fullRefund: true,
  });

  // (h) Order with a REJECTED PO — feeds the admin attention queue.
  await createSeedOrder({
    user: customer,
    address: customerAddress,
    vehicleDesc: F150_DESC,
    lines: [
      { part: brakePads, supplier: sup("automax"), qty: 2 },
      { part: airFilter, supplier: sup("pacific-rim"), qty: 1 },
    ],
    placedAt: daysAgo(4),
    paidAt: plus(daysAgo(4), 9 * 60_000),
    status: OrderStatus.PROCESSING,
    paymentStatus: PaymentStatus.SUCCEEDED,
    poPlans: [
      { status: POStatus.CONFIRMED },
      { status: POStatus.REJECTED, rejectReason: "Item discontinued" },
    ],
  });

  // (i) LATE PO — still PENDING_CONFIRMATION with dueAt 2 days ago (lead 3d, paid 5d ago).
  await createSeedOrder({
    user: customer,
    address: customerAddress,
    vehicleDesc: CAMRY_DESC,
    lines: [{ part: brakePads, supplier: sup("automax"), qty: 1 }],
    placedAt: daysAgo(5),
    paidAt: plus(daysAgo(5), 6 * 60_000),
    status: OrderStatus.PROCESSING,
    paymentStatus: PaymentStatus.SUCCEEDED,
    poPlans: [{ status: POStatus.PENDING_CONFIRMATION }],
  });

  // (j) NO_SHOW appointment yesterday — order FULFILLED, blocked from completing.
  {
    const paidAt = plus(daysAgo(9), 11 * 60_000);
    const startAt = blockStartNear(empire, daysAgo(1), -1, 1);
    await createSeedOrder({
      user: customer,
      address: customerAddress,
      vehicleDesc: CAMRY_DESC,
      lines: [
        {
          part: battery,
          supplier: sup("southern-gear"),
          qty: 1,
          withInstall: true,
          installer: empire,
          shipTo: ShipTo.INSTALLER,
        },
      ],
      placedAt: daysAgo(9),
      paidAt,
      status: OrderStatus.FULFILLED,
      paymentStatus: PaymentStatus.SUCCEEDED,
      poPlans: [{ status: POStatus.RECEIVED }],
      appointment: {
        installer: empire,
        startAt,
        status: AppointmentStatus.NO_SHOW,
        partsReadyAt: plus(paidAt, 4 * DAY),
        noShowAt: plus(startAt, 6 * HOUR),
      },
    });
  }

  // (k) NEEDS_RESCHEDULE — appointment tomorrow but the PO is only CONFIRMED.
  await createSeedOrder({
    user: customer,
    address: customerAddress,
    vehicleDesc: CAMRY_DESC,
    lines: [
      {
        part: struts,
        supplier: sup("midwest-auto"),
        qty: 1,
        withInstall: true,
        installer: hillCountry,
        shipTo: ShipTo.INSTALLER,
      },
    ],
    placedAt: daysAgo(2),
    paidAt: plus(daysAgo(2), 7 * 60_000),
    status: OrderStatus.PROCESSING,
    paymentStatus: PaymentStatus.SUCCEEDED,
    poPlans: [{ status: POStatus.CONFIRMED }],
    appointment: {
      installer: hillCountry,
      startAt: blockStartNear(hillCountry, daysFromNow(1), 1, 1),
      status: AppointmentStatus.PENDING_PARTS,
    },
  });

  // Jordan: PROCESSING multi-supplier order (varies the supplier portals).
  await createSeedOrder({
    user: jordan,
    address: jordanAddress,
    vehicleDesc: null,
    lines: [
      { part: radiator, supplier: sup("precision-parts"), qty: 1 },
      { part: beltV6, supplier: sup("southern-gear"), qty: 1 },
    ],
    placedAt: daysAgo(1),
    paidAt: plus(daysAgo(1), 5 * 60_000),
    status: OrderStatus.PROCESSING,
    paymentStatus: PaymentStatus.SUCCEEDED,
    poPlans: [{ status: POStatus.PENDING_CONFIRMATION }, { status: POStatus.CONFIRMED }],
  });

  // Jordan: FULFILLED with a READY appointment in 2 days at Empire Auto.
  {
    const paidAt = plus(daysAgo(6), 14 * 60_000);
    await createSeedOrder({
      user: jordan,
      address: jordanAddress,
      vehicleDesc: null,
      lines: [
        {
          part: plugsV8,
          supplier: sup("automax"),
          qty: 1,
          withInstall: true,
          installer: empire,
          shipTo: ShipTo.INSTALLER,
        },
      ],
      placedAt: daysAgo(6),
      paidAt,
      status: OrderStatus.FULFILLED,
      paymentStatus: PaymentStatus.SUCCEEDED,
      poPlans: [{ status: POStatus.RECEIVED }],
      appointment: {
        installer: empire,
        startAt: blockStartNear(empire, daysFromNow(2), 1, 2),
        status: AppointmentStatus.READY,
        partsReadyAt: plus(paidAt, 4 * DAY),
      },
    });
  }

  // Customer: PENDING_PARTS appointment in 5 days at Golden Gate (PO SHIPPED).
  await createSeedOrder({
    user: customer,
    address: customerAddress,
    vehicleDesc: F150_DESC,
    lines: [
      {
        part: airFilter,
        supplier: sup("pacific-rim"),
        qty: 1,
        withInstall: true,
        installer: goldenGate,
        shipTo: ShipTo.INSTALLER,
      },
    ],
    placedAt: daysAgo(3),
    paidAt: plus(daysAgo(3), 18 * 60_000),
    status: OrderStatus.PROCESSING,
    paymentStatus: PaymentStatus.SUCCEEDED,
    poPlans: [{ status: POStatus.SHIPPED }],
    appointment: {
      installer: goldenGate,
      startAt: blockStartNear(goldenGate, daysFromNow(5), 1, 1),
      status: AppointmentStatus.PENDING_PARTS,
    },
  });

  // Jordan: COMPLETED bring-your-own-part order whose install was cancelled
  // (>=24h rule) with an install-only labor refund.
  {
    const paidAt = plus(daysAgo(12), 10 * 60_000);
    await createSeedOrder({
      user: jordan,
      address: jordanAddress,
      vehicleDesc: null,
      lines: [
        {
          part: battery,
          supplier: sup("southern-gear"),
          qty: 1,
          withInstall: true,
          installer: hillCountry,
          shipTo: ShipTo.HOME,
        },
      ],
      placedAt: daysAgo(12),
      paidAt,
      status: OrderStatus.COMPLETED,
      paymentStatus: PaymentStatus.SUCCEEDED,
      poPlans: [{ status: POStatus.DELIVERED }],
      appointment: {
        installer: hillCountry,
        startAt: blockStartNear(hillCountry, daysFromNow(4), 1, 1),
        status: AppointmentStatus.CANCELLED,
        cancelledAt: daysAgo(2),
      },
      installOnlyRefund: { at: daysAgo(2) },
    });
  }

  // ---- counters (seeded numbers stay below these) --------------------------
  await db.counter.create({ data: { key: "order", value: 100050 } });
  await db.counter.create({ data: { key: "po", value: 100080 } });

  // ---- a few extra unread notifications -----------------------------------
  await db.notification.create({
    data: {
      userId: customer.id,
      type: "welcome",
      title: "Welcome to PartsPro",
      body: "Add your vehicle to see guaranteed-fit parts and book installation in one checkout.",
      href: "/account/vehicles",
      createdAt: daysAgo(45),
    },
  });
  const hillUserId = installerUserIdByInstallerId.get(hillCountry.id);
  if (hillUserId) {
    await db.notification.create({
      data: {
        userId: hillUserId,
        type: "appt_reminder",
        title: "Tomorrow's schedule",
        body: "You have upcoming installations — check the appointments board.",
        href: "/installer/appointments",
        createdAt: hoursAgo(5),
      },
    });
  }

  // ---- summary ------------------------------------------------------------
  const counts = {
    makes: await db.make.count(),
    models: await db.vehicleModel.count(),
    engines: await db.engine.count(),
    categories: await db.category.count(),
    brands: await db.brand.count(),
    suppliers: await db.supplier.count(),
    installers: await db.installer.count(),
    parts: await db.part.count(),
    fitments: await db.fitment.count(),
    users: await db.user.count(),
    orders: await db.order.count(),
    purchaseOrders: await db.purchaseOrder.count(),
    appointments: await db.appointment.count(),
    payments: await db.payment.count(),
    refunds: await db.refund.count(),
    events: await db.eventLog.count(),
    notifications: await db.notification.count(),
  };
  console.log("Seed complete:", counts);
  console.log("\nDemo accounts (password: password123)");
  console.log("  admin@demo.test           (ADMIN)");
  console.log("  customer@demo.test        (CUSTOMER — historical orders in every state)");
  console.log("  jordan@demo.test          (CUSTOMER)");
  for (const s of SUPPLIERS) console.log(`  ${s.slug}@supplier.test`.padEnd(28) + `(SUPPLIER — ${s.name})`);
  for (const i of INSTALLERS) console.log(`  ${i.slug}@installer.test`.padEnd(28) + `(INSTALLER — ${i.name})`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
