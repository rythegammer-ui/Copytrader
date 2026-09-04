# PartsPro — Car Parts, Dropshipped & Installed

A complete dropshipping platform for car parts where customers order parts **and book
professional installation in the same checkout** — parts, shipping, labor, and tax in
one payment. Suppliers fulfill purchase orders from their own portal (we hold no
inventory), installer shops receive parts and complete appointments, and admins run
the whole operation from a dashboard with an exception queue.

Built with **Next.js 14 (App Router) · TypeScript · Prisma + SQLite · Tailwind CSS**.
No external services required — payments run on a built-in mock provider until you
add Stripe keys.

## Quick start

```bash
npm install
cp .env.example .env      # defaults work out of the box
npm run db:reset          # create + seed the SQLite database
npm run dev               # http://localhost:3000
```

### Demo accounts (password: `password123`)

| Account | Role |
| --- | --- |
| `customer@demo.test` | Customer with historical orders in every lifecycle state |
| `admin@demo.test` | Admin dashboard, attention queue, refunds, CRUD |
| `automax@supplier.test` (one per supplier) | Supplier portal — confirm / ship POs |
| `lone-star@installer.test` (one per shop) | Installer portal — receive parts, complete installs |

## What's inside

**Customer storefront** — pick your vehicle (year/make/model/engine) and browse only
parts that fit (year-range fitment rules with engine wildcards and "verify engine"
badges); part pages quote installation per shop and offer a feasibility-gated
appointment slot grid (slots the parts can't arrive in time for are disabled); parts
ship to your door or straight to the shop; one-page checkout with idempotent order
creation; live order page with per-supplier shipment tracking, appointment readiness,
and an event timeline.

**Dropship engine** — on payment (idempotent webhook/mock confirm with amount
verification), the order fans out into per-supplier, per-destination purchase orders
inside one transaction, with SLA due dates. Ship-to-shop POs only ever expose the
shop's address to suppliers.

**Installation flow** — appointments are gated on parts arrival (shop-received for
ship-to-shop, home-delivered for bring-your-own-part), auto-rebook when parts arrive
late, and roll the order to COMPLETED when the wrench work is done.

**Money** — integer cents everywhere; immutable order snapshots; single-rounding tax
(labor exempt); per-supplier shipping with free-shipping threshold; telescoping
refund math whose item-by-item refunds sum exactly to the order total (58 unit tests
cover pricing, refunds, fitment, slots, sessions, transitions: `npm test`).

**Operations** — append-only event log behind every state change; admin attention
queue (late POs, rejections, needs-reschedule, no-shows, failed refunds); refund
composer with live preview; full catalog/taxonomy/user CRUD.

## Stripe (optional)

The mock provider is used whenever `STRIPE_SECRET_KEY` is unset (mock endpoints are
disabled when it is set). To use Stripe test mode, fill in `.env`:

```
STRIPE_SECRET_KEY=sk_test_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...   # stripe listen --forward-to localhost:3000/api/webhooks/stripe
```

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` / `build` / `start` | Next.js dev / production build / serve |
| `npm run db:reset` | Drop, push schema, and reseed the demo database |
| `npm test` | Vitest unit suite |
| `npm run typecheck` | Strict TypeScript check |

See **SPEC.md** for the full system design: data model, state machines, pricing and
refund formulas, route map, and security policies.

## Deploying (Vercel + Postgres)

SQLite is for local development only — a deployed app needs Postgres. The
repo already contains everything Vercel needs (`vercel.json` runs
`scripts/vercel-build.sh`, which derives the Postgres Prisma schema, pushes it,
seeds demo data into an empty database, and builds).

1. **Import the repo** in Vercel (Add New → Project → this repository). The
   framework is auto-detected; leave the build command as configured.
2. **Add a database**: Project → Storage → Create Database → **Neon (Postgres)**,
   free tier is fine. Connecting it sets `DATABASE_URL` and
   `DATABASE_URL_UNPOOLED` on the project automatically. (Any Postgres works —
   set `DATABASE_URL`, and `DATABASE_URL_UNPOOLED` if your provider pools.)
3. **Set secrets** under Settings → Environment Variables (Production):
   - `SESSION_SECRET` — any long random string (the build refuses to run
     production without it)
   - `DEMO_PASSWORD` — the password for the seeded demo accounts (the seed
     refuses the default `password123` in production)
   - optionally `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`,
     `STRIPE_WEBHOOK_SECRET` (webhook endpoint: `/api/webhooks/stripe`)
4. **Redeploy.** The first build creates the tables and seeds the catalog,
   shops, suppliers, and demo accounts; later builds leave data alone.

Notes for production: the schema is applied with `prisma db push` (fine to
launch; switch to `prisma migrate` once you have real data), the login
throttle is per serverless instance, and shop timezones are fixed offsets.
