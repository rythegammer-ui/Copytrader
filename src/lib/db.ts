import { Prisma, PrismaClient } from "@prisma/client";

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

/**
 * Errors that mean "the connection was not there", not "the query was wrong".
 *
 *   P1001 cannot reach the database server
 *   P1002 the server timed out accepting the connection
 *   P1008 the operation timed out
 *   P1017 the server closed the connection
 *   P2024 timed out taking a connection from the pool
 *
 * A serverless function that wakes a scale-to-zero Postgres, or that runs while
 * a deploy is pushing schema to the same database, hits these and nothing else.
 * Every other Prisma error is a real answer and must propagate untouched.
 */
const TRANSIENT = new Set(["P1001", "P1002", "P1008", "P1017", "P2024"]);

function isTransient(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientInitializationError) return true;
  return err instanceof Prisma.PrismaClientKnownRequestError && TRANSIENT.has(err.code);
}

/** Reads are the only operations that may be replayed safely. */
const READS = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
]);

const RETRY_DELAYS_MS = [150, 600];

/**
 * Ceiling on the total extra wall-clock a single operation may spend retrying.
 *
 * The failures worth retrying are fast ones: a closed connection, a pool
 * timeout, a Neon endpoint resuming from idle. Those come back in well under a
 * second, so a small budget catches all of them.
 *
 * The case this exists to prevent is the opposite one. `connect_timeout=15`
 * means an unroutable database — packets dropped rather than refused — hangs
 * each attempt for the full 15 seconds. Retrying that blindly turns one 15s
 * failure into 45s for a single query, and a page issues several. It would
 * overrun the serverless function's maxDuration and hand the customer a
 * platform 504 instead of the error page this change exists to show them,
 * which is strictly worse than failing fast.
 *
 * So: if an attempt already burned the budget, there is no retry, and the page
 * fails exactly as quickly as it did before retries existed.
 */
const RETRY_BUDGET_MS = 2_500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
    ...(datasourceUrl() ? { datasourceUrl: datasourceUrl() } : {}),
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;

/**
 * Retry reads that failed because the connection dropped.
 *
 * This is what stops a database that was merely asleep from turning the parts
 * catalog into an error page. Writes are deliberately excluded: a write that
 * times out may still have landed, and replaying it could take money twice.
 *
 * Deliberately `$use` rather than a `$extends` query extension. An extension
 * returns a differently-typed client that is not assignable to `PrismaClient`,
 * which every helper here takes, so it would force a signature change through
 * the whole app to add behaviour that no caller should have to know about.
 * Middleware is deprecated but fully supported in the Prisma 5 line this
 * project pins; revisit when upgrading to 6.
 *
 * Middleware also runs for queries issued inside `$transaction`, where `next`
 * stays bound to that transaction's client. A retry therefore runs on the same
 * connection as the original and can never read around an open transaction's
 * snapshot — it either succeeds there or fails again and propagates.
 */
export async function retryTransientReads<T>(
  action: string,
  run: () => Promise<T>,
  delays: readonly number[] = RETRY_DELAYS_MS,
  budgetMs: number = RETRY_BUDGET_MS,
  now: () => number = Date.now,
): Promise<T> {
  if (!READS.has(action)) return run();
  const startedAt = now();
  let lastErr: unknown;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      return await run();
    } catch (err) {
      if (!isTransient(err)) throw err;
      lastErr = err;
      if (attempt >= delays.length) break;
      // Both the time already spent and the wait still to come count against
      // the budget, so a slow attempt cannot sneak one more slow attempt in.
      if (now() - startedAt + delays[attempt] > budgetMs) break;
      await sleep(delays[attempt]);
    }
  }
  throw lastErr;
}

// Registered once per client, with the marker on the client itself rather than
// on globalThis. In development the module re-evaluates on every hot reload
// while the client stays cached, so an unguarded call would stack another copy
// of this middleware on each save; in production the client is NOT cached, so a
// module-level or global flag would instead skip installation on a second
// evaluation and silently leave that client with no retries at all.
const RETRY_INSTALLED = Symbol.for("partspro.prisma.retryInstalled");
type Marked = { [RETRY_INSTALLED]?: true };

if (!(db as Marked)[RETRY_INSTALLED]) {
  (db as Marked)[RETRY_INSTALLED] = true;
  db.$use((params, next) => retryTransientReads(params.action, () => next(params)));
}
