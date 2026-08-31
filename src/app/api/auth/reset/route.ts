import { z } from "zod";
import { api, jsonOk, parseBody } from "@/lib/api";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/errors";
import { hashPassword } from "@/lib/password";
import { decodeResetToken } from "@/lib/session";

export const dynamic = "force-dynamic";

const zReset = z.object({
  token: z.string().min(1),
  password: z.string().min(8).max(200),
});

export const POST = api(async (req) => {
  const body = await parseBody(req, zReset);

  const payload = decodeResetToken(body.token);
  if (!payload) {
    throw new ApiError("INVALID_TOKEN", "This reset link is invalid or has expired", 400);
  }

  const user = await db.user.findUnique({ where: { id: payload.userId } });
  if (!user) {
    throw new ApiError("INVALID_TOKEN", "This reset link is invalid or has expired", 400);
  }

  const passwordHash = await hashPassword(body.password);
  await db.user.update({ where: { id: user.id }, data: { passwordHash } });

  return jsonOk({ ok: true });
});
