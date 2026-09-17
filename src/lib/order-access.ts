import type { User } from "@prisma/client";
import { Role } from "@/lib/enums";
import { requirePageUser } from "@/lib/page-auth";
import { getCurrentUser, tokenOpensOrder } from "@/lib/session";

/**
 * Who is allowed to look at one order.
 *
 * Two ways in, and only two:
 *
 * 1. A signed-in customer who owns it (or an admin).
 * 2. An order-scoped token, handed out once at guest checkout.
 *
 * The token opens exactly the order it names. It is not a login: it grants no
 * account access, no order history, and no ability to act on anything else.
 * That is what makes it safe to put in a URL a guest can bookmark or paste.
 */
export interface OrderViewer {
  /** True when access came from a token rather than a session. */
  viaToken: boolean;
  /** The signed-in user, if any. Null for a pure guest. */
  user: User | null;
  /** The token that got them in, to thread through links on the page. */
  token?: string;
}

/**
 * Resolve the viewer for `orderId`, sending anonymous visitors to sign in
 * unless they carry a valid token for this exact order.
 *
 * Redirects (via `requirePageUser`) when there is neither. Callers must still
 * check ownership themselves when `viaToken` is false — this function proves
 * identity, not entitlement.
 */
export async function resolveOrderViewer(
  orderId: string,
  token: string | undefined,
  returnTo: string,
): Promise<OrderViewer> {
  if (tokenOpensOrder(orderId, token)) {
    // A signed-in person holding a token is still signed in; keep the session
    // so the page can show account navigation.
    return { viaToken: true, user: await getCurrentUser(), token };
  }
  const user = await requirePageUser([Role.CUSTOMER], returnTo);
  return { viaToken: false, user };
}

/** Pull `?t=` out of a page's searchParams. */
export function tokenParam(
  searchParams: Record<string, string | string[] | undefined> | undefined,
): string | undefined {
  const t = searchParams?.t;
  return typeof t === "string" ? t : undefined;
}

/**
 * True when this viewer may not see the order.
 * Admins see everything; owners see their own; token holders see that order.
 */
export function deniedOrder(viewer: OrderViewer, orderUserId: string): boolean {
  if (viewer.viaToken) return false;
  const user = viewer.user;
  if (!user) return true;
  return user.role !== Role.ADMIN && orderUserId !== user.id;
}

/** Append the access token to an in-page link, when the viewer needs it. */
export function withToken(href: string, viewer: OrderViewer): string {
  if (!viewer.viaToken || !viewer.token) return href;
  return `${href}${href.includes("?") ? "&" : "?"}t=${encodeURIComponent(viewer.token)}`;
}
