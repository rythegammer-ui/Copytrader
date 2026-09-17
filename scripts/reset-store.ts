/**
 * Wipe everything that is not the shop's own inventory.
 *
 *   RESET_STORE=1 npx tsx scripts/reset-store.ts
 *
 * Deliberately destructive and deliberately guarded: it only runs when
 * RESET_STORE=1 is set, so a normal deploy can never trip it.
 *
 * KEEPS
 *   - the Principe Performance & Parts supplier and every part imported from
 *     the Master Inventory workbook
 *   - the admin account (deleting it would lock the owner out of their store)
 *   - the supplier portal login for their own supplier record
 *   - the vehicle taxonomy (makes, models, engines), which the fitment data
 *     on the kept parts points at
 *
 * DELETES
 *   - every order and everything hanging off one
 *   - the demo suppliers, installers and parts that shipped with the seed
 *   - every customer account, all of which are test data at this point
 *   - carts, notifications, the event log and the webhook ledger
 */
import { PrismaClient } from "@prisma/client";
import { Role } from "../src/lib/enums";

const db = new PrismaClient();

const OWN_SUPPLIER_SLUG = "principe-performance-parts";

function requireFlag(): void {
  if (process.env.RESET_STORE !== "1") {
    console.error("reset-store: refusing to run without RESET_STORE=1");
    process.exit(1);
  }
}

async function main(): Promise<void> {
  requireFlag();
  const supplier = await db.supplier.findUnique({ where: { slug: OWN_SUPPLIER_SLUG } });
  if (!supplier) {
    console.error(`reset-store: supplier "${OWN_SUPPLIER_SLUG}" not found — refusing to wipe a store whose own inventory is missing`);
    process.exit(1);
  }

  const before = {
    orders: await db.order.count(),
    parts: await db.part.count(),
    users: await db.user.count(),
    suppliers: await db.supplier.count(),
    installers: await db.installer.count(),
  };

  // --- orders and everything that hangs off one -----------------------------
  // Order children have no cascade, so they go first, deepest last.
  await db.refund.deleteMany({});
  await db.payment.deleteMany({});
  await db.appointment.deleteMany({});
  await db.purchaseOrder.deleteMany({});
  await db.orderItem.deleteMany({});
  await db.eventLog.deleteMany({});
  const orders = await db.order.deleteMany({});

  // --- carts ---------------------------------------------------------------
  // CartItem cascades from Cart; clear both anyway so nothing is orphaned.
  await db.cartItem.deleteMany({});
  await db.cart.deleteMany({});

  // --- everything the store no longer sells --------------------------------
  // Parts from any other supplier are the demo catalog. Fitments and kit links
  // cascade from Part.
  const demoParts = await db.part.deleteMany({
    where: { supplierId: { not: supplier.id } },
  });

  // --- demo installers and suppliers ---------------------------------------
  // Named explicitly rather than "everything that isn't ours". The owner has
  // already added a real garage of their own through the admin, and a blanket
  // delete would take it with the fiction. Anything not on these lists is
  // assumed to be theirs and left alone.
  const DEMO_INSTALLERS = ["lone-star", "hill-country", "empire-auto", "golden-gate"];
  const DEMO_SUPPLIERS = [
    "automax",
    "precision-parts",
    "midwest-auto",
    "pacific-rim",
    "southern-gear",
  ];

  // Portal logins reference their shop, so the users go first.
  const demoInstallerIds = (
    await db.installer.findMany({ where: { slug: { in: DEMO_INSTALLERS } }, select: { id: true } })
  ).map((i) => i.id);
  await db.user.deleteMany({ where: { installerId: { in: demoInstallerIds } } });
  const installers = await db.installer.deleteMany({ where: { slug: { in: DEMO_INSTALLERS } } });

  const demoSupplierIds = (
    await db.supplier.findMany({ where: { slug: { in: DEMO_SUPPLIERS } }, select: { id: true } })
  ).map((s) => s.id);
  await db.user.deleteMany({ where: { supplierId: { in: demoSupplierIds } } });
  const suppliers = await db.supplier.deleteMany({ where: { slug: { in: DEMO_SUPPLIERS } } });

  // --- customers -----------------------------------------------------------
  // Every customer account is test data: no order was ever paid. Admins and
  // the shop's own supplier login stay, or nobody can get back in.
  await db.address.deleteMany({});
  await db.customerVehicle.deleteMany({});
  await db.notification.deleteMany({});
  const customers = await db.user.deleteMany({ where: { role: Role.CUSTOMER } });

  // --- transient ledgers ---------------------------------------------------
  await db.webhookEvent.deleteMany({});
  await db.rateLimit.deleteMany({});
  // Order numbers restart from the beginning on a clean store.
  await db.counter.deleteMany({});

  const after = {
    orders: await db.order.count(),
    parts: await db.part.count(),
    listed: await db.part.count({ where: { active: true } }),
    users: await db.user.count(),
    suppliers: await db.supplier.count(),
    installers: await db.installer.count(),
  };

  console.log("reset-store: done");
  console.log(`  orders     ${before.orders} -> ${after.orders}   (${orders.count} removed)`);
  console.log(`  parts      ${before.parts} -> ${after.parts}   (${demoParts.count} demo parts removed, ${after.listed} listed)`);
  console.log(`  users      ${before.users} -> ${after.users}   (${customers.count} customers removed)`);
  console.log(`  suppliers  ${before.suppliers} -> ${after.suppliers}   (${suppliers.count} removed)`);
  console.log(`  installers ${before.installers} -> ${after.installers}  (${installers.count} removed)`);

  const left = await db.user.findMany({ select: { email: true, role: true } });
  console.log("  accounts kept:");
  for (const u of left) console.log(`    ${u.email} (${u.role})`);
}

main()
  .catch((err) => {
    console.error("reset-store failed:", err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
