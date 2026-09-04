import { NextRequest, NextResponse } from "next/server";
import { ZodError, type ZodSchema } from "zod";
import type { User } from "@prisma/client";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/errors";
import { AuthError, requireUser } from "@/lib/session";
import { TransitionError, type Actor } from "@/lib/transitions";

/** JSON error shape used by every API route: {error:{code,message,details?}}. */
export function jsonError(code: string, message: string, status: number, details?: unknown) {
  return NextResponse.json({ error: { code, message, ...(details ? { details } : {}) } }, { status });
}

export function jsonOk(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

/**
 * CSRF defense for cookie-authenticated mutations: the Origin (or Referer)
 * host must match the request host. Browsers always send Origin on cross-site
 * POSTs; same-origin fetches send it too. Requests with neither header (curl,
 * tests) are allowed — cookies don't leak there.
 */
export function assertSameOrigin(req: NextRequest): void {
  const origin = req.headers.get("origin") ?? req.headers.get("referer");
  if (!origin) return;
  try {
    const originHost = new URL(origin).host;
    const host = req.headers.get("host");
    if (host && originHost !== host) {
      throw new ApiError("CSRF", "Cross-origin request rejected", 403);
    }
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError("CSRF", "Invalid origin header", 403);
  }
}

/** Map any thrown error to the standard JSON error response. */
export function toErrorResponse(err: unknown): NextResponse {
  if (err instanceof ApiError) {
    return jsonError(err.code, err.message, err.status, err.details);
  }
  if (err instanceof TransitionError) {
    return jsonError("TRANSITION", err.message, err.status);
  }
  if (err instanceof AuthError) {
    return jsonError(err.status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN", err.message, err.status);
  }
  if (err instanceof ZodError) {
    return jsonError("VALIDATION", err.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join("; "), 400);
  }
  console.error("[api] unhandled error:", err);
  return jsonError("INTERNAL", "Something went wrong", 500);
}

type RouteContext = { params: Record<string, string> };
type Handler = (req: NextRequest, ctx: RouteContext) => Promise<NextResponse>;

export interface ApiOptions {
  /** Roles allowed (omit = no auth required). */
  roles?: string[];
  /** Skip the same-origin check (webhooks with their own signature auth). */
  skipCsrf?: boolean;
}

/**
 * Wrap a route handler: CSRF on mutating methods, optional role guard, and
 * uniform error mapping. The authed user (when roles given) is attached via
 * the second argument of the inner handler.
 */
export function api(
  handler: (req: NextRequest, ctx: RouteContext, user: User) => Promise<NextResponse>,
  opts: ApiOptions & { roles: string[] },
): Handler;
export function api(
  handler: (req: NextRequest, ctx: RouteContext, user: User | null) => Promise<NextResponse>,
  opts?: ApiOptions,
): Handler;
export function api(
  handler: (req: NextRequest, ctx: RouteContext, user: never) => Promise<NextResponse>,
  opts: ApiOptions = {},
): Handler {
  return async (req: NextRequest, ctx: RouteContext) => {
    try {
      if (!opts.skipCsrf && req.method !== "GET" && req.method !== "HEAD") {
        assertSameOrigin(req);
      }
      let user: User | null = null;
      if (opts.roles) {
        user = await requireUser(opts.roles);
      } else {
        const { getCurrentUser } = await import("@/lib/session");
        user = await getCurrentUser();
      }
      return await handler(req, ctx, user as never);
    } catch (err) {
      return toErrorResponse(err);
    }
  };
}

/** Parse + validate a JSON body against a zod schema. Throws on invalid. */
export async function parseBody<T>(req: NextRequest, schema: ZodSchema<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new ApiError("BAD_JSON", "Request body must be JSON", 400);
  }
  return schema.parse(raw);
}

/** Actor for the transition/fulfillment layer from a session user. */
export function actorFor(user: User): Actor {
  return {
    userId: user.id,
    role: user.role,
    supplierId: user.supplierId,
    installerId: user.installerId,
  };
}

// ---------------------------------------------------------------------------
// Rate limiter (login brute-force / registration enumeration protection).
// Persisted in the database: serverless instances share no memory, so an
// in-process Map would reset on every cold start and per concurrent instance.
// ---------------------------------------------------------------------------

/**
 * Is `key` currently blocked? `limit` failures within the window lock it.
 * Call `rateLimitHit` on each FAILURE only, `rateLimitClear` on success.
 */
export async function rateLimited(key: string, limit = 5): Promise<boolean> {
  const row = await db.rateLimit.findUnique({ where: { key } });
  if (!row || row.resetAt.getTime() < Date.now()) return false;
  return row.count >= limit;
}

export async function rateLimitHit(key: string, windowMs = 15 * 60_000): Promise<void> {
  const now = Date.now();
  const row = await db.rateLimit.findUnique({ where: { key } });
  if (!row || row.resetAt.getTime() < now) {
    const fresh = { count: 1, resetAt: new Date(now + windowMs) };
    await db.rateLimit.upsert({ where: { key }, create: { key, ...fresh }, update: fresh });
  } else {
    await db.rateLimit.update({ where: { key }, data: { count: { increment: 1 } } });
  }
}

export async function rateLimitClear(key: string): Promise<void> {
  await db.rateLimit.deleteMany({ where: { key } });
}

export function clientIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
}
