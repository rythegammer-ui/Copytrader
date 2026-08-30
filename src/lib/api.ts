import { NextRequest, NextResponse } from "next/server";
import { ZodError, type ZodSchema } from "zod";
import type { User } from "@prisma/client";
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
// Simple in-memory rate limiter (login brute-force protection).
// ---------------------------------------------------------------------------

const buckets = new Map<string, { count: number; resetAt: number }>();

/**
 * Sliding-window-ish limiter: `limit` failures per `windowMs`, keyed by
 * caller-provided string (e.g. `login:<email>:<ip>`). Returns true if the
 * action is currently blocked. Call `rateLimitHit` on each FAILURE only.
 */
export function rateLimited(key: string, limit = 5, windowMs = 15 * 60_000): boolean {
  const bucket = buckets.get(key);
  if (!bucket) return false;
  if (Date.now() > bucket.resetAt) {
    buckets.delete(key);
    return false;
  }
  return bucket.count >= limit;
}

export function rateLimitHit(key: string, windowMs = 15 * 60_000): void {
  const bucket = buckets.get(key);
  if (!bucket || Date.now() > bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: Date.now() + windowMs });
  } else {
    bucket.count += 1;
  }
}

export function rateLimitClear(key: string): void {
  buckets.delete(key);
}

export function clientIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
}
