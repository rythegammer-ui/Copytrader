#!/usr/bin/env bash
# Vercel build for PartsPro.
#  1. derive the Postgres schema from the canonical SQLite one
#  2. generate the Prisma client for Postgres
#  3. push the schema and seed demo data (only if the database is empty)
#  4. next build
# Locally, `npm run build` stays on SQLite; this script is only for Vercel.
set -euo pipefail

echo "▶ PartsPro build — VERCEL_ENV=${VERCEL_ENV:-local}"
node scripts/make-postgres-schema.js

if [ "${VERCEL_ENV:-}" = "production" ] && [ -z "${SESSION_SECRET:-}" ]; then
  echo "✗ SESSION_SECRET is not set. Sessions would be forgeable — refusing to build production." >&2
  echo "  Add it under Vercel → Project → Settings → Environment Variables (any long random string)." >&2
  exit 1
fi

npx prisma generate --schema prisma/schema.postgres.prisma

if [ -n "${DATABASE_URL:-}" ]; then
  # Neon/Vercel Postgres expose an unpooled URL under one of these names; fall
  # back to DATABASE_URL itself for providers that hand out a single direct URL.
  export DATABASE_URL_UNPOOLED="${DATABASE_URL_UNPOOLED:-${POSTGRES_URL_NON_POOLING:-${DIRECT_URL:-$DATABASE_URL}}}"
  echo "▶ Pushing schema to Postgres"
  npx prisma db push --schema prisma/schema.postgres.prisma --accept-data-loss --skip-generate
  echo "▶ Seeding demo data (skipped automatically if the database already has users)"
  SEED_IF_EMPTY=1 npx tsx prisma/seed.ts
else
  echo "⚠ DATABASE_URL is not set — skipping schema push and seed."
  echo "  The site will not work until a Postgres database is connected (Vercel → Storage → Create Database)."
fi

npx next build
