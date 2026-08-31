import crypto from "crypto";
import { describe, expect, it } from "vitest";

// session.ts transitively imports @/lib/db (PrismaClient singleton) and
// next/headers. Neither is exercised by the pure token helpers under test, but
// both env vars must exist before the module loads, so set them first and
// import dynamically. No queries are ever issued.
process.env.DATABASE_URL = process.env.DATABASE_URL ?? "file:./prisma/dev.db";
process.env.SESSION_SECRET = "test-session-secret";

const { encodeSession, decodeSession, encodeResetToken, decodeResetToken } = await import(
  "@/lib/session"
);

/** Mirror of session.ts's HMAC signing, for crafting adversarial tokens. */
function sign(payload: string): string {
  return crypto.createHmac("sha256", "test-session-secret").update(payload).digest("base64url");
}

describe("session tokens", () => {
  it("round-trips a userId with a future expiry", () => {
    const token = encodeSession("user_123");
    const payload = decodeSession(token);
    expect(payload?.userId).toBe("user_123");
    expect(payload && payload.exp > Math.floor(Date.now() / 1000)).toBe(true);
  });

  it("rejects garbage and malformed tokens", () => {
    expect(decodeSession(undefined)).toBeNull();
    expect(decodeSession("")).toBeNull();
    expect(decodeSession("garbage")).toBeNull();
    expect(decodeSession("a.b")).toBeNull();
    expect(decodeSession("no-dot-here!!")).toBeNull();
  });

  it("rejects a tampered signature", () => {
    const token = encodeSession("user_123");
    const dot = token.lastIndexOf(".");
    const body = token.slice(0, dot);
    const mac = token.slice(dot + 1);
    const flipped = (mac[0] === "A" ? "B" : "A") + mac.slice(1);
    expect(decodeSession(`${body}.${flipped}`)).toBeNull();
  });

  it("rejects a tampered body (userId swap) even with a well-formed shape", () => {
    const token = encodeSession("user_123");
    const dot = token.lastIndexOf(".");
    const mac = token.slice(dot + 1);
    const forgedBody = Buffer.from(
      JSON.stringify({ userId: "user_admin", exp: Math.floor(Date.now() / 1000) + 9999 }),
    ).toString("base64url");
    expect(decodeSession(`${forgedBody}.${mac}`)).toBeNull();
  });

  it("rejects an expired token (validly signed, past exp)", () => {
    const body = Buffer.from(
      JSON.stringify({ userId: "user_123", exp: Math.floor(Date.now() / 1000) - 60 }),
    ).toString("base64url");
    const token = `${body}.${sign(body)}`;
    expect(decodeSession(token)).toBeNull();
  });
});

describe("password reset tokens", () => {
  it("round-trips a userId", () => {
    const token = encodeResetToken("user_456");
    expect(decodeResetToken(token)?.userId).toBe("user_456");
  });

  it("rejects garbage", () => {
    expect(decodeResetToken("garbage")).toBeNull();
    expect(decodeResetToken("a.b")).toBeNull();
  });

  it("rejects cross-purpose tokens (session token is NOT a reset token and vice versa)", () => {
    // The reset MAC is keyed over "reset:<body>", so a session token can never
    // pass reset validation even though both share the signing secret.
    expect(decodeResetToken(encodeSession("user_123"))).toBeNull();
    expect(decodeSession(encodeResetToken("user_123"))).toBeNull();
  });

  it("rejects an expired reset token", () => {
    const body = Buffer.from(
      JSON.stringify({ p: "reset", userId: "user_123", exp: Math.floor(Date.now() / 1000) - 60 }),
    ).toString("base64url");
    const token = `${body}.${sign(`reset:${body}`)}`;
    expect(decodeResetToken(token)).toBeNull();
  });
});
