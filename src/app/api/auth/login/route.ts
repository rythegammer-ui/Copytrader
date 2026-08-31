import { z } from "zod";
import {
  api,
  clientIp,
  jsonOk,
  parseBody,
  rateLimitClear,
  rateLimitHit,
  rateLimited,
} from "@/lib/api";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/errors";
import { verifyPassword } from "@/lib/password";
import { createSessionCookie } from "@/lib/session";
import { mergeGuestCartIntoUser } from "@/lib/cart";
import { roleHome } from "@/lib/page-auth";

export const dynamic = "force-dynamic";

const zLogin = z.object({
  email: z.string().trim().email().max(200),
  password: z.string().min(1).max(200),
});

export const POST = api(async (req) => {
  const body = await parseBody(req, zLogin);
  const email = body.email.toLowerCase();
  // Two buckets: a tight per-(email, IP) lockout for the normal case, plus a
  // wider IP-INDEPENDENT per-email bucket so spoofing X-Forwarded-For across
  // requests cannot bypass the account lockout entirely.
  const key = `login:${email}:${clientIp(req)}`;
  const emailKey = `login-email:${email}`;

  if (rateLimited(key) || rateLimited(emailKey, 20)) {
    throw new ApiError(
      "RATE_LIMITED",
      "Too many failed sign-in attempts. Try again in 15 minutes.",
      429,
    );
  }

  const user = await db.user.findUnique({ where: { email } });
  const valid = user ? await verifyPassword(body.password, user.passwordHash) : false;
  if (!user || !valid) {
    rateLimitHit(key);
    rateLimitHit(emailKey);
    throw new ApiError("INVALID_CREDENTIALS", "Invalid email or password", 401);
  }

  rateLimitClear(key);
  rateLimitClear(emailKey);
  createSessionCookie(user.id);
  await mergeGuestCartIntoUser(user.id);

  return jsonOk({
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
    home: roleHome(user.role),
  });
});
