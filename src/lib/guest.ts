import crypto from "crypto";
import { db } from "@/lib/db";
import { Role } from "@/lib/enums";
import { ApiError } from "@/lib/errors";
import { hashPassword } from "@/lib/password";
import type { User } from "@prisma/client";

/**
 * Guest checkout identities.
 *
 * An order has to belong to a user: notifications, purchase orders, refunds
 * and appointments all read `order.userId`, and making it nullable would mean
 * touching every one of those paths. So a guest gets a real User row with no
 * usable password instead, and the rest of the system never knows the
 * difference.
 *
 * What a guest does NOT get is a session. Access to the order is granted by an
 * order-scoped token (see `encodeOrderToken`). The distinction matters: a
 * session would open the whole account behind that email address, including
 * orders someone else placed with it. A token opens one order.
 *
 * The hard rule below is the other half of that boundary: an unauthenticated
 * request must NEVER resolve to a registered account. The email field is typed
 * by a stranger and verified by nobody, so treating it as proof of identity
 * would let anyone attach an order to — and act on — somebody else's account.
 */

/**
 * A password hash that cannot be produced by any input.
 *
 * `passwordHash` is non-null in the schema and the login route compares
 * against whatever is stored, so a guest row needs something there. Hashing
 * 32 random bytes means no password anyone can type will ever match, and the
 * account stays unusable for sign-in until its owner claims it by registering.
 */
async function unusablePasswordHash(): Promise<string> {
  return hashPassword(crypto.randomBytes(32).toString("hex"));
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002";
}

export interface GuestContact {
  email: string;
  name: string;
  phone?: string | null;
}

/**
 * Find or create the guest user an anonymous order should belong to.
 *
 * - No account for this email: create a guest row.
 * - A guest row exists: reuse it untouched. Its name and phone are NOT
 *   refreshed — anyone can type anyone's address here, and the details that
 *   matter are snapshotted onto the Order anyway.
 * - A REGISTERED account owns the email: refuse. Binding an unauthenticated
 *   order to a real account would let a stranger plant a payable order in it,
 *   and hand them that account's stored phone number. Ask them to sign in.
 */
export async function resolveGuestUser(contact: GuestContact): Promise<User> {
  const email = contact.email.trim().toLowerCase();
  const name = contact.name.trim() || "Guest";
  const phone = contact.phone?.trim() || null;

  const existing = await db.user.findUnique({ where: { email } });
  if (existing) {
    if (!existing.isGuest) {
      throw new ApiError(
        "SIGN_IN_REQUIRED",
        "That email already has an account. Sign in to place this order.",
        409,
      );
    }
    return existing;
  }

  try {
    return await db.user.create({
      data: {
        email,
        name,
        phone,
        role: Role.CUSTOMER,
        isGuest: true,
        passwordHash: await unusablePasswordHash(),
      },
    });
  } catch (err) {
    // Two checkouts with the same new email raced. Whoever lost re-reads the
    // winner's row rather than failing the order with a 500.
    if (isUniqueViolation(err)) {
      const raced = await db.user.findUnique({ where: { email } });
      if (raced?.isGuest) return raced;
      throw new ApiError(
        "SIGN_IN_REQUIRED",
        "That email already has an account. Sign in to place this order.",
        409,
      );
    }
    throw err;
  }
}

/**
 * Hand a guest's cookie cart to the guest user row created for their order.
 *
 * The cart clean-up that runs when a payment succeeds looks a cart up by user,
 * and a guest cart carries `userId: null`, so without this the buyer's cart
 * would still be full after they paid.
 *
 * Only ever call this for a row where `isGuest` is true. `Cart.userId` is
 * unique, so this deletes any cart the user already owns — harmless for a
 * guest's own stale cart from a previous order, destructive for anybody else.
 */
export async function attachCartToUser(cartId: string, user: User): Promise<void> {
  if (!user.isGuest) return;
  await db.$transaction(async (tx) => {
    const cart = await tx.cart.findUnique({ where: { id: cartId }, select: { userId: true } });
    if (!cart || cart.userId === user.id) return;
    // A stale cart from an earlier guest order by the same person.
    await tx.cart.deleteMany({ where: { userId: user.id, NOT: { id: cartId } } });
    await tx.cart.update({ where: { id: cartId }, data: { userId: user.id } });
  });
}
