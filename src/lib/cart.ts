import { cookies } from "next/headers";
import crypto from "crypto";
import { db } from "@/lib/db";
import type { CartWithItems } from "@/lib/checkout";
import { getCurrentUser } from "@/lib/session";

const CART_COOKIE = "pp_cart";

function secret(): string {
  return process.env.SESSION_SECRET || "dev-only-insecure-session-secret";
}

function signCartId(cartId: string): string {
  const mac = crypto.createHmac("sha256", secret()).update(`cart:${cartId}`).digest("base64url");
  return `${cartId}.${mac}`;
}

function verifyCartCookie(value: string | undefined): string | null {
  if (!value) return null;
  const dot = value.lastIndexOf(".");
  if (dot < 0) return null;
  const cartId = value.slice(0, dot);
  const mac = value.slice(dot + 1);
  const expected = crypto.createHmac("sha256", secret()).update(`cart:${cartId}`).digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return cartId;
}

const CART_INCLUDE = {
  items: { include: { part: { include: { supplier: true } } } },
} as const;

/** Current cart (user's, or guest cookie cart). Null when none exists. Read-only safe. */
export async function getCart(): Promise<CartWithItems | null> {
  const user = await getCurrentUser();
  if (user) {
    return db.cart.findFirst({ where: { userId: user.id }, include: CART_INCLUDE });
  }
  const guestId = verifyCartCookie(cookies().get(CART_COOKIE)?.value);
  if (!guestId) return null;
  const cart = await db.cart.findUnique({ where: { id: guestId }, include: CART_INCLUDE });
  return cart && cart.userId === null ? cart : null;
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002"
  );
}

/**
 * Get or create the current cart. Sets the guest cookie when creating a guest
 * cart — call from route handlers or server actions only.
 */
export async function getOrCreateCart(): Promise<CartWithItems> {
  const existing = await getCart();
  if (existing) return existing;
  const user = await getCurrentUser();
  let cart: CartWithItems;
  try {
    cart = await db.cart.create({
      data: { userId: user?.id ?? null },
      include: CART_INCLUDE,
    });
  } catch (err) {
    // Concurrent request won the race on Cart.userId's unique — use its cart.
    if (isUniqueViolation(err) && user) {
      const raced = await db.cart.findFirst({ where: { userId: user.id }, include: CART_INCLUDE });
      if (raced) return raced;
    }
    throw err;
  }
  if (!user) {
    cookies().set(CART_COOKIE, signCartId(cart.id), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
  }
  return cart;
}

/**
 * Merge the guest cookie cart into the (just logged-in) user's cart:
 * same-part rows combine quantities and the guest's install config wins.
 * Call from login/register route handlers after the session cookie is set.
 */
export async function mergeGuestCartIntoUser(userId: string): Promise<void> {
  const guestId = verifyCartCookie(cookies().get(CART_COOKIE)?.value);
  if (!guestId) return;
  const guest = await db.cart.findUnique({ where: { id: guestId }, include: { items: true } });
  if (!guest || guest.userId !== null) return;

  let userCart = await db.cart.findFirst({ where: { userId }, include: { items: true } });
  if (!userCart) {
    try {
      await db.cart.update({ where: { id: guest.id }, data: { userId } });
    } catch (err) {
      // A concurrent request claimed the user's cart slot — merge into it.
      if (!isUniqueViolation(err)) throw err;
      userCart = await db.cart.findFirst({ where: { userId }, include: { items: true } });
    }
  }
  if (userCart) {
    const target = userCart;
    await db.$transaction(async (tx) => {
      for (const gi of guest.items) {
        const existing = target.items.find((ui) => ui.partId === gi.partId);
        if (existing) {
          await tx.cartItem.update({
            where: { id: existing.id },
            data: {
              qty: Math.min(10, existing.qty + gi.qty),
              withInstall: gi.withInstall,
              installerId: gi.installerId,
              apptStartAt: gi.apptStartAt,
              shipTo: gi.shipTo,
            },
          });
        } else {
          await tx.cartItem.update({ where: { id: gi.id }, data: { cartId: target.id } });
        }
      }
      // Carry the guest's vehicle context if the user cart has none.
      if (!target.ctxModelId && guest.ctxModelId) {
        await tx.cart.update({
          where: { id: target.id },
          data: {
            ctxModelId: guest.ctxModelId,
            ctxYear: guest.ctxYear,
            ctxEngineId: guest.ctxEngineId,
          },
        });
      }
      await tx.cart.delete({ where: { id: guest.id } });
    });
  }
  cookies().set(CART_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
}
