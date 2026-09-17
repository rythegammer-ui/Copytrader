import { z } from "zod";
import { api, clientIp, jsonOk, parseBody, rateLimitHit, rateLimited } from "@/lib/api";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/errors";
import { Role } from "@/lib/enums";
import { hashPassword } from "@/lib/password";
import { createSessionCookie } from "@/lib/session";
import { mergeGuestCartIntoUser } from "@/lib/cart";

export const dynamic = "force-dynamic";

const zRegister = z.object({
  email: z.string().trim().email().max(200),
  password: z.string().min(8).max(200),
  name: z.string().trim().min(1).max(120),
  phone: z.string().trim().min(1).max(40).optional(),
});

export const POST = api(async (req) => {
  const body = await parseBody(req, zRegister);
  const email = body.email.toLowerCase();

  // The EMAIL_TAKEN response is standard registration UX but doubles as an
  // account-existence oracle — throttle per IP to keep bulk enumeration slow.
  const ipKey = `register:${clientIp(req)}`;
  if (await rateLimited(ipKey, 10)) {
    throw new ApiError("RATE_LIMITED", "Too many registration attempts. Try again later.", 429);
  }
  await rateLimitHit(ipKey);

  const passwordHash = await hashPassword(body.password);

  const existing = await db.user.findUnique({ where: { email } });
  if (existing && !existing.isGuest) {
    throw new ApiError("EMAIL_TAKEN", "An account with that email already exists", 409);
  }

  // A guest row is a placeholder someone created by typing this address at
  // checkout — possibly this very person, possibly not. It holds no password
  // and nobody can sign in as it, but it does own the email, so without this
  // the address would be locked out of registration forever. Claiming it
  // turns it into a real account and keeps any orders placed with it.
  const user = existing
    ? await db.user.update({
        where: { id: existing.id },
        data: {
          passwordHash,
          name: body.name,
          phone: body.phone ?? existing.phone,
          isGuest: false,
        },
      })
    : await db.user.create({
        data: {
          email,
          passwordHash,
          name: body.name,
          phone: body.phone ?? null,
          role: Role.CUSTOMER,
        },
      });

  createSessionCookie(user.id);
  await mergeGuestCartIntoUser(user.id);

  return jsonOk(
    { user: { id: user.id, name: user.name, email: user.email, role: user.role } },
    201,
  );
});
