import { describe, expect, it } from "vitest";
import { redactAnalyticsUrl } from "@/components/shell/SiteAnalytics";

const ORIGIN = "https://shop.example.com";

/**
 * These URLs carry live bearer credentials. Vercel's ingest reports
 * location.href verbatim, so anything not stripped here is recorded in the
 * analytics dashboard and its export.
 */
describe("redactAnalyticsUrl", () => {
  it("strips the password-reset token from the path", () => {
    const token = "eyJwIjoicmVzZXQiLCJ1c2VySWQiOiJ1c3JfOTkifQ.abc123signature";
    const out = redactAnalyticsUrl(`${ORIGIN}/reset/${token}`);
    expect(out).not.toContain(token);
    expect(out).not.toContain("abc123signature");
    expect(out).toBe(`${ORIGIN}/reset/[redacted]`);
  });

  it("strips a URL-encoded reset token too", () => {
    const out = redactAnalyticsUrl(`${ORIGIN}/reset/abc%2Fdef.sig`);
    expect(out).not.toContain("abc");
    expect(out).not.toContain("sig");
  });

  it("strips the guest order-access token from the query", () => {
    const token = "b3JkZXI6b3JkXzQy.9f8e7d6c5b4a";
    const out = redactAnalyticsUrl(`${ORIGIN}/checkout/success/ord_42?t=${token}`);
    expect(out).not.toContain(token);
    expect(out).not.toContain("9f8e7d6c5b4a");
    expect(out).toContain("/checkout/success/ord_42");
  });

  it("strips the token from the pay page as well", () => {
    const out = redactAnalyticsUrl(`${ORIGIN}/checkout/pay/ord_42?t=secrettoken`);
    expect(out).not.toContain("secrettoken");
  });

  it("strips a ?token= spelling", () => {
    expect(redactAnalyticsUrl(`${ORIGIN}/anything?token=secrettoken`)).not.toContain("secrettoken");
  });

  it("strips the credential but keeps harmless params, so analytics stays useful", () => {
    const out = redactAnalyticsUrl(`${ORIGIN}/parts?category=brakes&t=secrettoken&sort=price_asc`);
    expect(out).not.toContain("secrettoken");
    expect(out).toContain("category=brakes");
    expect(out).toContain("sort=price_asc");
  });

  it("leaves ordinary catalogue URLs untouched", () => {
    const url = `${ORIGIN}/parts?category=brakes&page=2`;
    expect(redactAnalyticsUrl(url)).toBe(url);
  });

  it("does not mistake a lookalike path for the reset route", () => {
    const url = `${ORIGIN}/parts/reset-spring-kit`;
    expect(redactAnalyticsUrl(url)).toBe(url);
  });

  // Reporting a URL we could not parse means reporting it unscrubbed.
  it("refuses to report a URL it cannot parse", () => {
    expect(redactAnalyticsUrl("/reset/sometoken")).toBe("/");
    expect(redactAnalyticsUrl("not a url at all")).toBe("/");
  });
});
