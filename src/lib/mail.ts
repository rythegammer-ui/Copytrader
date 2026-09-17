/**
 * Outbound email.
 *
 * The app ran for a long time on a console stub, which is fine for a demo and
 * useless for real customers: somebody who registers, forgets their password
 * and clicks reset is locked out permanently, because the reset link is
 * delivered to an in-app notification they can only see once signed in.
 *
 * Sending is enabled by setting RESEND_API_KEY. With no key, every call falls
 * back to the stub and logs — the app keeps working, nothing throws, and the
 * in-app notification is still written by the caller.
 *
 * Mail is never allowed to break the thing that triggered it. Every failure is
 * swallowed and logged: a payment must not fail because a receipt bounced.
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export function mailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

/** Sender address. Resend's shared sender works before a domain is verified. */
export function mailFrom(): string {
  return process.env.MAIL_FROM || "onboarding@resend.dev";
}

/**
 * Absolute base URL for links in emails.
 *
 * A reset link has to work in somebody else's mail client, so it cannot be
 * relative. PUBLIC_BASE_URL wins; otherwise Vercel's own production hostname.
 */
export function siteUrl(): string {
  const explicit = process.env.PUBLIC_BASE_URL;
  if (explicit) return explicit.replace(/\/+$/, "");
  const vercel =
    process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  if (vercel) return `https://${vercel.replace(/\/+$/, "")}`;
  return "http://localhost:3000";
}

export interface MailInput {
  to: string;
  subject: string;
  /** Plain text is required; HTML is optional and derived from it if absent. */
  text: string;
  html?: string;
}

/** Minimal HTML wrapper so the message is readable in clients that prefer it. */
function asHtml(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const linked = escaped.replace(
    /(https?:\/\/[^\s]+)/g,
    '<a href="$1" style="color:#1d4ed8">$1</a>',
  );
  return `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.6;color:#0f172a;white-space:pre-wrap">${linked}</div>`;
}

/**
 * Send one email. Returns true only when the provider accepted it.
 * Never throws.
 */
export async function sendMail(input: MailInput): Promise<boolean> {
  if (!mailConfigured()) {
    console.log(
      `[MAIL-STUB] to=${input.to} subject="${input.subject}" — set RESEND_API_KEY to send for real`,
    );
    return false;
  }
  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: mailFrom(),
        to: [input.to],
        subject: input.subject,
        text: input.text,
        html: input.html ?? asHtml(input.text),
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(`[MAIL] ${res.status} sending "${input.subject}" to ${input.to}: ${detail.slice(0, 300)}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(
      `[MAIL] could not send "${input.subject}" to ${input.to}:`,
      err instanceof Error ? err.message : err,
    );
    return false;
  }
}
