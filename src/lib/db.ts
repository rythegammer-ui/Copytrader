import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * Postgres connection tuning for serverless. Transaction-mode poolers (Neon's
 * "-pooler" host, Supabase :6543, PgBouncer) need Prisma's pgbouncer mode; the
 * per-instance pool must be > 1 because Vercel Fluid compute serves concurrent
 * requests from one process; connect_timeout covers Neon scale-to-zero resume.
 * SQLite URLs pass through untouched.
 */
function datasourceUrl(): string | undefined {
  const url = process.env.DATABASE_URL;
  if (!url || !/^postgres(ql)?:/.test(url)) return undefined;
  let host = "";
  let port = "";
  try {
    const u = new URL(url.replace(/^postgres(ql)?:/, "http:"));
    host = u.hostname;
    port = u.port;
  } catch {
    // leave the URL alone if it does not parse
  }
  const pooled = process.env.PRISMA_PGBOUNCER === "1" || /pooler/i.test(host) || port === "6543";
  const params: string[] = [];
  if (pooled && !/[?&]pgbouncer=true/.test(url)) params.push("pgbouncer=true");
  if (!/[?&]connection_limit=/.test(url)) params.push("connection_limit=5");
  if (!/[?&]connect_timeout=/.test(url)) params.push("connect_timeout=15");
  if (params.length === 0) return url;
  return `${url}${url.includes("?") ? "&" : "?"}${params.join("&")}`;
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
    ...(datasourceUrl() ? { datasourceUrl: datasourceUrl() } : {}),
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
