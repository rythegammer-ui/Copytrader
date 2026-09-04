#!/usr/bin/env bash
# Vercel build for PartsPro.
#  1. derive the Postgres schema from the canonical SQLite one
#  2. generate the Prisma client for Postgres
#  3. PRODUCTION builds only: push the schema and seed an empty database
#  4. next build
# Local `npm run build` stays on SQLite; this script is only for Vercel.
set -euo pipefail

echo "▶ PartsPro build — VERCEL_ENV=${VERCEL_ENV:-local}"
node scripts/make-postgres-schema.js

if [ -n "${VERCEL:-}" ] && [ -z "${SESSION_SECRET:-}" ]; then
  echo "✗ SESSION_SECRET is not set. Sessions would be forgeable — refusing to build." >&2
  echo "  Add it under Vercel → Project → Settings → Environment Variables (all environments)." >&2
  exit 1
fi

npx prisma generate --schema prisma/schema.postgres.prisma

with_timeout() { # append connect_timeout for Neon scale-to-zero resume
  case "$1" in *connect_timeout=*) echo "$1";; *\?*) echo "$1&connect_timeout=15";; *) echo "$1?connect_timeout=15";; esac
}

if { [ "${VERCEL_ENV:-}" = "production" ] || [ "${RUN_DB_PUSH:-}" = "1" ]; } && [ -n "${DATABASE_URL:-}" ]; then
  # Neon/Vercel Postgres expose an unpooled URL under one of these names; fall
  # back to DATABASE_URL itself for providers that hand out a single direct URL.
  export DATABASE_URL_UNPOOLED="$(with_timeout "${DATABASE_URL_UNPOOLED:-${POSTGRES_URL_NON_POOLING:-${DIRECT_URL:-$DATABASE_URL}}}")"
  echo "▶ Pushing schema to Postgres (destructive changes fail the build — review them, then run with a migration)"
  npx prisma db push --schema prisma/schema.postgres.prisma --skip-generate
  echo "▶ Seeding demo data (skipped automatically if the database already has users)"
  DATABASE_URL="$DATABASE_URL_UNPOOLED" SEED_IF_EMPTY=1 npx tsx prisma/seed.ts
elif [ -n "${DATABASE_URL:-}" ]; then
  echo "▶ ${VERCEL_ENV:-non-production} build — schema push and seed run for production builds only."
else
  echo "⚠ DATABASE_URL is not set — skipping schema push and seed."
  echo "  The site will not work until a Postgres database is connected (Vercel → Storage → Create Database)."
fi

npx next build
