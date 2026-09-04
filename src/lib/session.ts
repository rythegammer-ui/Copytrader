import { cookies } from "next/headers";
import crypto from "crypto";
import { db } from "@/lib/db";
import type { User } from "@prisma/client";

const COOKIE_NAME = "pp_session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 14; // 14 days

/**
 * HMAC key for session/cart/reset cookies. Fails closed in deployed
 * environments: a placeholder secret would make every cookie forgeable.
 */
export function secret(): string {
  const configured = process.env.SESSION_SECRET;
  if (configured) return configured;
  if (process.env.VERCEL || process.env.NODE_ENV === "production") {
    throw new Error("SESSION_SECRET must be set in deployed environments");
  }
  return "dev-only-insecure-session-secret";
}

function sign(payload: string): string {
  return crypto.createHmac("sha256", secret()).update(payload).digest("base64url");
}

export type SessionPayload = {
  userId: string;
  exp: number; // unix seconds
};

export function encodeSession(userId: string): string {
  const payload: SessionPayload = {
    userId,
    exp: Math.floor(Date.now() / 1000) + MAX_AGE_SECONDS,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body)}`;
}

export function decodeSession(token: string | undefined): SessionPayload | null {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot < 0) return null;
  const body = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  const expected = sign(body);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as SessionPayload;
    if (typeof payload.userId !== "string" || typeof payload.exp !== "number") return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Set the session cookie for a user. Call from a route handler or server action. */
export function createSessionCookie(userId: string): void {
  cookies().set(COOKIE_NAME, encodeSession(userId), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export function clearSessionCookie(): void {
  cookies().set(COOKIE_NAME, "", { httpOnly: true, path: "/", maxAge: 0 });
}

/** Current logged-in user, or null. Safe to call from server components and route handlers. */
export async function getCurrentUser(): Promise<User | null> {
  const payload = decodeSession(cookies().get(COOKIE_NAME)?.value);
  if (!payload) return null;
  return db.user.findUnique({ where: { id: payload.userId } });
}

/** Require a logged-in user with one of the given roles; throws AuthError otherwise. */
export class AuthError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function requireUser(roles?: string[]): Promise<User> {
  const user = await getCurrentUser();
  if (!user) throw new AuthError("Not signed in", 401);
  if (roles && roles.length > 0 && !roles.includes(user.role)) {
    throw new AuthError("Forbidden", 403);
  }
  return user;
}

// ---------------------------------------------------------------------------
// Password reset tokens (HMAC-signed, 30 min, no DB table).
// ---------------------------------------------------------------------------

const RESET_MAX_AGE_SECONDS = 30 * 60;

export function encodeResetToken(userId: string): string {
  const payload = {
    p: "reset",
    userId,
    exp: Math.floor(Date.now() / 1000) + RESET_MAX_AGE_SECONDS,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(`reset:${body}`)}`;
}

export function decodeResetToken(token: string): { userId: string } | null {
  const dot = token.lastIndexOf(".");
  if (dot < 0) return null;
  const body = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  const expected = sign(`reset:${body}`);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as {
      p?: string;
      userId?: string;
      exp?: number;
    };
    if (payload.p !== "reset" || typeof payload.userId !== "string" || typeof payload.exp !== "number")
      return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return { userId: payload.userId };
  } catch {
    return null;
  }
}
