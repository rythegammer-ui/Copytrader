import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * On Postgres via a pooled (pgbouncer-style) connection string — e.g. Neon's
 * "-pooler" host from the Vercel integration — Prisma needs pgbouncer mode
 * and a small per-function connection limit. SQLite URLs pass through untouched.
 */
function datasourceUrl(): string | undefined {
  const url = process.env.DATABASE_URL;
  if (!url || !/^postgres(ql)?:/.test(url)) return undefined;
  if (/-pooler\./.test(url) && !/[?&]pgbouncer=true/.test(url)) {
    return `${url}${url.includes("?") ? "&" : "?"}pgbouncer=true&connection_limit=1`;
  }
  return url;
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
    ...(datasourceUrl() ? { datasourceUrl: datasourceUrl() } : {}),
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
