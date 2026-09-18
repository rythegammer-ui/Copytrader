"use client";

import { Analytics } from "@vercel/analytics/next";

/**
 * Vercel Web Analytics, with credential-bearing URLs scrubbed before anything
 * leaves the browser.
 *
 * This wrapper is not optional decoration. The analytics SDK passes the route
 * pattern AND the raw pathname, and the ingest script reports `location.href`
 * verbatim — full path, full query string. Two of this app's URLs carry live
 * bearer credentials in exactly those positions:
 *
 *   /reset/<token>  a 30-minute password-reset token, as a PATH SEGMENT.
 *                   It is stateless and HMAC-signed with no server-side
 *                   record, so possession of it is enough to set a new
 *                   password on that account — the shop admin's included.
 *   ?t=<token>      the 120-day guest order-access token, on the checkout
 *                   success and pay pages.
 *
 * Unscrubbed, both would be recorded in the analytics dashboard and its data
 * export, readable by anyone with project access for far longer than the
 * credentials stay valid.
 *
 * `beforeSend` is a function, so it cannot be handed to <Analytics/> from a
 * server layout — hence this client component. Everything sensitive is
 * redacted here, in one place, so a new sensitive URL has exactly one file to
 * be added to.
 *
 * Note this is defence in depth, not a substitute for keeping credentials out
 * of URLs: a token in a path or query also reaches Referer headers, CDN access
 * logs and shared browser history, none of which this touches.
 */

/** Query parameters that carry a credential and must never be reported. */
const SECRET_PARAMS = ["t", "token"];

/** Path prefixes whose next segment is a credential. */
const SECRET_PATH_PREFIXES = ["/reset/"];

export function redactAnalyticsUrl(rawUrl: string): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    // Never report a URL we could not parse and therefore could not scrub.
    return "/";
  }
  for (const prefix of SECRET_PATH_PREFIXES) {
    if (url.pathname.startsWith(prefix)) {
      url.pathname = `${prefix}[redacted]`;
      break;
    }
  }
  for (const param of SECRET_PARAMS) url.searchParams.delete(param);
  return url.toString();
}

export function SiteAnalytics() {
  return (
    <Analytics beforeSend={(event) => ({ ...event, url: redactAnalyticsUrl(event.url) })} />
  );
}
