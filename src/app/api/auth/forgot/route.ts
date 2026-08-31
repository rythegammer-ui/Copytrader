import { z } from "zod";
import { api, jsonOk, parseBody } from "@/lib/api";
import { db } from "@/lib/db";
import { encodeResetToken } from "@/lib/session";
import { notify } from "@/lib/events";

export const dynamic = "force-dynamic";

const zForgot = z.object({
  email: z.string().trim().email().max(200),
});

export const POST = api(async (req) => {
  const body = await parseBody(req, zForgot);
  const email = body.email.toLowerCase();

  const user = await db.user.findUnique({ where: { email } });
  if (user) {
    const token = encodeResetToken(user.id);
    console.log(`[MAIL-STUB] reset link: /reset/${token}`);
    await notify(db, {
      userId: user.id,
      type: "password_reset",
      title: "Password reset requested",
      body: "A password reset link was issued for your account. It expires in 30 minutes.",
      href: `/reset/${token}`,
    });
  }

  // Always OK — never reveal whether the email has an account.
  return jsonOk({ ok: true });
});
