#!/usr/bin/env bash
# Vercel build for PartsPro.
#  1. derive the Postgres schema from the canonical SQLite one
#  2. generate the Prisma client for Postgres
#  3. PRODUCTION builds only: push the schema and seed an empty database
#  4. next build
# Local `npm run build` stays on SQLite; this script is only for Vercel.
set -euo pipefail

echo "▶ PartsPro build — VERCEL_ENV=${VERCEL_ENV:-local}"
# A deployment-provided .env (for hosts/API deploys that cannot set project
# environment variables) is loaded here so the whole build sees it.
# Values already in the environment WIN. The host's own environment variables
# (Vercel → Settings → Environment Variables) are the place secrets belong, so
# a deployment-provided .env acts only as a fallback for hosts that cannot set
# them. Without this, a baked .env would silently clobber a key the owner had
# just rotated in the dashboard.
if [ -f .env ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in ''|'#'*) continue;; *=*) ;; *) continue;; esac
    key=${line%%=*}
    case "$key" in *[!A-Za-z0-9_]*) continue;; esac
    if [ -z "$(eval "printf '%s' \"\${$key:-}\"")" ]; then
      export "$key=${line#*=}"
    else
      echo "  · $key already set in the environment — keeping it, ignoring .env"
    fi
  done < .env
  echo "▶ loaded .env (host environment takes precedence)"
fi
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
  echo "▶ Importing the Principe Performance & Parts inventory (idempotent)"
  DATABASE_URL="$DATABASE_URL_UNPOOLED" npx tsx scripts/import-inventory.ts
elif [ -n "${DATABASE_URL:-}" ]; then
  echo "▶ ${VERCEL_ENV:-non-production} build — schema push and seed run for production builds only."
else
  echo "⚠ DATABASE_URL is not set — skipping schema push and seed."
  echo "  The site will not work until a Postgres database is connected (Vercel → Storage → Create Database)."
fi

# Inline runtime config into the server bundle when the host has no env vars.
if [ "${BAKE_RUNTIME_ENV:-}" = "1" ]; then node scripts/bake-runtime-env.js; fi

npx next build
