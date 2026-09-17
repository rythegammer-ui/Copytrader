import { z } from "zod";
import { api, jsonOk, parseBody } from "@/lib/api";
import { db } from "@/lib/db";
import { encodeResetToken } from "@/lib/session";
import { notify } from "@/lib/events";
import { sendMail, siteUrl } from "@/lib/mail";

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
    const link = `${siteUrl()}/reset/${token}`;
    // The in-app notification is useless to somebody who cannot sign in, so
    // the email is the one that matters here.
    await notify(db, {
      userId: user.id,
      type: "password_reset",
      title: "Password reset requested",
      body: "A password reset link was issued for your account. It expires in 30 minutes.",
      href: `/reset/${token}`,
    });
    await sendMail({
      to: email,
      subject: "Reset your password",
      text:
        `Someone asked to reset the password for your account at Principe Performance & Parts.\n\n` +
        `Open this link within 30 minutes to choose a new one:\n\n${link}\n\n` +
        `If that wasn't you, ignore this email — nothing has changed.`,
    });
  }

  // Always OK — never reveal whether the email has an account.
  return jsonOk({ ok: true });
});
