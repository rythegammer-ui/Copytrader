# PartsPro — Dropship Car Parts + Installation Platform

A Next.js 14 (App Router) + TypeScript monolith backed by Prisma/SQLite. Customers pick
their vehicle, buy compatible parts, and optionally add professional installation —
parts, shipping, install labor, and tax are paid in **one** payment. Parts are
**dropshipped**: on payment, per-supplier purchase orders fan out automatically;
suppliers fulfill via a portal; installer shops receive parts and complete installs.

Demo accounts (all password `password123`): `admin@demo.test`, `customer@demo.test`,
one `*@supplier.test` per supplier, one `*@installer.test` per shop.

## Core principles

1. **All money is integer US cents.** Labor is integer tenths of an hour. Never floats.
2. **Order = immutable financial snapshot.** All prices/rates/tax/address copied onto
   Order/OrderItem/PurchaseOrder at checkout. Post-checkout code only reads snapshots.
3. **Fulfillment truth lives in PurchaseOrders and Appointments**, whose transitions
   roll up into `Order.status`. OrderItem has only PENDING/CANCELLED/REFUNDED; item
   display progress derives from its PO.
4. **Every state change goes through `src/lib/transitions.ts`**, inside a Prisma
   `$transaction`, writing an append-only `EventLog` row (with `internal` flag) and
   `Notification`s. Illegal transitions → 409. No `status:` writes anywhere else.
5. **SQLite has no enums**: all enum-like columns are `String`; canonical values live
   in `src/lib/enums.ts` (const objects + zod validators). Always import from there.
6. **One PaymentIntent per attempt** via a `PaymentProvider` interface: `stripe` when
   `STRIPE_SECRET_KEY` is set, otherwise a built-in `mock` provider with full parity.
   The success handler is idempotent (WebhookEvent ledger + in-tx status guard) and
   **must assert `intent.amount === order.totalCents` and currency** before flipping.

## Fitment model

`Make → VehicleModel → Engine` hierarchy. A part carries `Fitment` rows =
`(modelId, yearFrom..yearTo, engineId?)`; `engineId NULL` = all engines.
`Part.universalFit` bypasses fitment entirely. Compatibility for `(modelId M, year Y,
engineId E?)`: `part.universalFit OR EXISTS fitment(modelId=M AND yearFrom<=Y<=yearTo
AND (engineId IS NULL OR engineId=E))`. If the customer picked no engine, engine-specific
matches still show but badge **"⚠ Verify engine"**; exact matches badge **"✓ Fits"**.

## Pricing (src/lib/pricing.ts — the ONLY place these formulas live)

- `mulBps(cents, bps) = Math.round(cents * bps / 10000)`; `ceilDiv(a,b)=Math.ceil(a/b)`.
- Line: `lineTotalCents = unitPriceCents * qty`.
- Install (only if `withInstall && part.installEligible`):
  `installUnitCents = part.installFixedFeeCents ?? ceilDiv(laborHoursTenths * installer.hourlyRateCents, 10)`;
  `installTotalCents = installUnitCents * qty`.
- Shipping per **shipment group** keyed `(supplierId, shipTo, installerId ?? "")` —
  the SAME `destinationKey()` function is used for pricing groups AND PO fan-out:
  `groupShippingCents = groupPartsCents >= FREE_SHIP_THRESHOLD(15000) ? 0 :
   supplier.shippingFlatCents + supplier.shippingPerItemCents * groupQty`.
- Tax (labor exempt): `taxCents = mulBps(partsSubtotal + shippingTotal, taxRateBps)`
  — ONE rounding on the whole base. `taxRateBps` from env `TAX_RATE_BPS` (default 825),
  snapshotted on Order.
- `totalCents = partsSubtotal + installSubtotal + shippingTotal + taxCents`; must be ≥ 50.

### Refunds (src/lib/refunds.ts)
Whole-line-only (no partial quantities — stated in UI). For a refund of items I:
- `refundParts = Σ lineTotalCents`, `refundInstall = Σ installTotalCents` (if install cancelled),
- `refundShipping = PO.shippingFeeCents` iff every other item on that PO is already cancelled/refunded,
- **Tax by recompute-and-diff**: `taxBack = taxAlreadyCollectedRemaining - mulBps(remainingTaxableBaseAfterRefund, taxRateBps)`
  where remaining base = order parts+shipping minus everything refunded so far and now.
- Clamp to `payment.amountCents - order.refundedTotalCents`; when the last outstanding
  value is refunded, force the exact remaining balance (absorbs rounding drift).
- Update `refundedTotalCents` in-tx; `== totalCents` → Order status REFUNDED.
- Install-only cancellation ≥24h before slot: auto-refund `installTotalCents` (no tax — labor untaxed).

## State machines (src/lib/transitions.ts)

**Order**: PENDING_PAYMENT → PAID (payment handler; same tx: fan out POs split by
destinationKey, create Appointments deduped by (installerId,startAt) with in-tx capacity
re-check — on conflict book next free feasible slot and notify; set paidAt; → PROCESSING).
PENDING_PAYMENT → PAYMENT_FAILED (retry → new Payment+intent → PENDING_PAYMENT).
PENDING_PAYMENT|PAYMENT_FAILED → CANCELLED (customer or lazy 24h TTL).
PROCESSING → PARTIALLY_FULFILLED (≥1 PO terminal-delivered, ≥1 not) → FULFILLED (all
non-cancelled POs terminal: DELIVERED for HOME, RECEIVED for INSTALLER) → COMPLETED
(no appointments, or all appointments COMPLETED/CANCELLED). PAID|PROCESSING → CANCELLED:
customer self-serve ONLY while every PO is PENDING_CONFIRMATION (re-checked in-tx) →
full auto-refund; admin anytime pre-FULFILLED with chosen refund. Full refund ⇒ REFUNDED.
Rollup (`rollUpOrderStatus`) never moves backwards, never overrides CANCELLED/REFUNDED.

**PurchaseOrder**: PENDING_CONFIRMATION → CONFIRMED | REJECTED(reason → notifies admin;
admin refunds affected items → PO CANCELLED, items REFUNDED) ; CONFIRMED → SHIPPED
(carrier+tracking required) → DELIVERED (admin/supplier/demo button) → RECEIVED
(installer, INSTALLER-dest only; SHIPPED → RECEIVED shortcut allowed, implies DELIVERED);
PENDING_CONFIRMATION|CONFIRMED → CANCELLED (admin or order cancellation). SHIPPED POs
are never cancelled (handled as manual refunds). `dueAt = paidAt + supplier.leadTimeDays`
(SLA clock for the admin attention queue). After every PO transition:
`recomputeAppointmentReadiness` then `rollUpOrderStatus`.

**Appointment**: PENDING_PARTS ⇄ READY (readiness: every non-cancelled item — INSTALLER
ship → its PO RECEIVED; HOME ship → its PO DELIVERED). Readiness after `startAt` passed
→ auto-rebook next free slot ≥ tomorrow (EventLog `auto_rescheduled`). READY → COMPLETED
(that shop's installer only) | NO_SHOW (after slot passes; admin may rebook or refund
labor minus no-show policy). PENDING_PARTS|READY → CANCELLED (customer ≥24h rule →
install refund; order cancellation). Reschedule keeps status, capacity-checked in-tx.

**Payment**: REQUIRES_PAYMENT → SUCCEEDED | FAILED | CANCELLED. Retry = new row (audit).
Exactly one SUCCEEDED per order (guard: order already PAID → no-op 200).

## Appointments & slots (src/lib/slots.ts)

Slots are computed, not stored. Shops have `openMinutes/closeMinutes/slotMinutes/
bays/daysOpenMask/tzOffsetMinutes` (fixed UTC offset — DST intentionally out of scope,
documented). A booking occupies `blocks = max(1, ceilDiv(totalLaborTenths * 6, slotMinutes))`
consecutive blocks; a slot is available iff every needed block has
`count(active appointments overlapping block) < bays`. **Feasibility gating**: the slot
picker disables chips before `today + supplier.leadTimeDays + TRANSIT_BUFFER_DAYS(2)`
("part won't arrive by then").

## Security

- HMAC-signed session cookie (`src/lib/session.ts`), SameSite=Lax, httpOnly.
- **CSRF**: every mutating API route rejects requests whose `Origin` (or `Referer`)
  host differs from the request host (helper in `src/lib/api.ts`). 403 on mismatch.
- **Login throttle**: in-memory 5 failures per email+IP → 15 min lockout.
- Password reset: `/api/auth/forgot` issues an HMAC-signed, 30-min token, logged to
  console (mail stub) + notification; `/reset/[token]` sets a new password.
- Portal scoping: every supplier/installer query filters by `user.supplierId /
  user.installerId` server-side. Admin CRUD is ADMIN-only. Ownership checks on orders.
- Ship-to-shop POs expose ONLY the shop address to suppliers — never the customer's
  home address. Mock payment endpoints return 404 whenever `STRIPE_SECRET_KEY` is set.
- Checkout idempotency: client sends a generated `idempotencyKey`; stored unique on
  Order; replay returns the existing order.

## Route & page map (ownership for implementation agents)

**M1 Auth+Account**: /api/auth/* (register, login, logout, me, forgot, reset),
/api/account/vehicles*, /api/account/addresses*, /api/account/profile,
/api/notifications*; pages /login, /register, /reset/[token], /account (overview),
/account/vehicles, /account/notifications, /account/settings.

**M2 Catalog**: /api/vehicles/* (makes, models, engines, years), /api/parts,
/api/parts/[slug], /api/categories, /api/brands, /api/installers,
/api/installers/[id]/slots; pages / (home + vehicle picker), /parts, /categories/[slug],
/parts/[slug] (fitment table + install widget + slot grid); components under
src/components/catalog/.

**M3 Cart+Checkout**: /api/cart* (incl. /api/cart/vehicle, apply-install-defaults),
/api/checkout/quote, /api/checkout, /api/payments/mock/confirm, /api/webhooks/stripe;
pages /cart, /checkout, /checkout/pay/[orderId], /checkout/success/[orderId];
components under src/components/checkout/.

**M4 Customer orders**: /api/orders*, /api/appointments*; pages /account/orders,
/account/orders/[id] (timeline, shipment cards, appointment cards, cancel/refund
visibility), /account/appointments; components under src/components/orders/.

**M5 Supplier+Installer portals**: /api/supplier/*, /api/installer/*; pages
/supplier, /supplier/pos, /supplier/pos/[id] (+ print packing slip), /installer,
/installer/appointments, /installer/appointments/[id]; supplier can toggle
`Part.inStock`; components under src/components/portal/.

**M6 Admin ops**: /api/admin/kpis, /api/admin/attention, /api/admin/orders*,
/api/admin/orders/[id]/refunds, /api/admin/pos/[id]/transition; pages /admin,
/admin/attention, /admin/orders, /admin/orders/[id] (refund composer + audit log),
/admin/refunds; components under src/components/admin/.

**M7 Admin catalog CRUD**: /api/admin/parts* (+fitments), /api/admin/suppliers*,
/api/admin/installers*, /api/admin/taxonomy* (categories/brands/makes/models/engines),
/api/admin/users*; pages /admin/parts, /admin/parts/new, /admin/parts/[id],
/admin/suppliers(+/[id]), /admin/installers(+/[id]), /admin/taxonomy, /admin/users;
components under src/components/admin-crud/.

**M8 Seed+Tests**: prisma/seed.ts (8 makes, ~25 models, ~60 engines, 10 categories,
12 brands, 5 suppliers, 4 shops, ~120 parts incl. engine-split and universal parts;
orders frozen in EVERY state incl. late PO, rejected PO, needs-reschedule, no-show;
future appointments in every state); tests/ (pricing worked examples, refund
item-by-item Σ==total invariant, transition legality matrix, fitment matcher edges,
slot capacity/feasibility, payment handler idempotency).

Shared foundation (already written, do not modify): prisma/schema.prisma, middleware.ts,
src/lib/* (db, enums, money, pricing, refunds, slots, fitment, transitions, checkout,
events, session, password, api, payments/*), src/app/layout.tsx, src/components/shell/*.

## Explicit policies (customer-facing where relevant)

- Login required to check out (no guest checkout; carts work as guest, merge on login).
- Whole-line cancellations/refunds only. Customer self-cancel only before any supplier
  confirmation; afterwards contact support (admin refund tools).
- Bring-your-own-part installs (ship HOME + install): readiness waits on home delivery;
  customer brings the part.
- Install-only cancellation ≥24h before the slot: full labor refund.
- v2 (recorded, not built): supplier settlement/installer payout ledger (computable from
  `supplierCostCentsSnapshot`), real carrier webhooks, DST-aware scheduling.
