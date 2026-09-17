import { z } from "zod";
import { api, clientIp, jsonOk, parseBody, rateLimited, rateLimitHit } from "@/lib/api";
import { getCart } from "@/lib/cart";
import { createOrderFromCart, type CheckoutAddress } from "@/lib/checkout";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/errors";
import { attachCartToUser, resolveGuestUser } from "@/lib/guest";
import { encodeOrderToken, getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";
// Multi-step transactions + payment-provider calls: allow more than the 10s serverless default.
export const maxDuration = 30;

const zInlineAddress = z.object({
  name: z.string().trim().min(1).max(80),
  line1: z.string().trim().min(1).max(120),
  line2: z.string().trim().max(120).optional(),
  city: z.string().trim().min(1).max(80),
  state: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{2}$/, "must be a 2-letter state code")
    .transform((s) => s.toUpperCase()),
  zip: z
    .string()
    .trim()
    .regex(/^\d{5}(-\d{4})?$/, "must be a valid ZIP code"),
});

/** Who to send the receipt to when nobody is signed in. */
const zGuest = z.object({
  email: z.string().trim().email().max(200),
  name: z.string().trim().min(1).max(80),
});

const zCheckout = z.object({
  addressId: z.string().min(1).optional(),
  address: zInlineAddress.optional(),
  contactPhone: z.string().trim().min(7).max(25).optional(),
  guest: zGuest.optional(),
  idempotencyKey: z.string().uuid(),
});

/**
 * POST /api/checkout — public; a signed-in customer or a guest.
 *
 * Places the order from the current cart: resolves the shipping address (a
 * saved address they own, or an inline one), then creates the immutable order
 * snapshot + payment intent. Idempotent per idempotencyKey — replays return
 * the existing order.
 *
 * Guests get a passwordless user row so the order has an owner, and an
 * order-scoped `accessToken` in the response so they can watch it without an
 * account. They are deliberately NOT signed in: issuing a session would open
 * the whole account behind that email address to whoever typed it.
 */
export const POST = api(async (req) => {
  const body = await parseBody(req, zCheckout);
  const user = await getCurrentUser();

  if (!user && !body.guest) {
    throw new ApiError("CONTACT_REQUIRED", "Tell us your name and email so we can reach you", 400);
  }

  // Anonymous checkout creates a user row, so it needs a ceiling. Without one,
  // a script could mint accounts for every address it can think of.
  if (!user) {
    const ipKey = `guest-checkout:${clientIp(req)}`;
    if (await rateLimited(ipKey, 10)) {
      throw new ApiError("RATE_LIMITED", "Too many attempts — try again shortly", 429);
    }
    await rateLimitHit(ipKey);
  }

  let address: CheckoutAddress;
  if (body.addressId) {
    // Saved addresses belong to accounts, so this branch needs a real session.
    if (!user) throw new ApiError("ADDRESS_NOT_FOUND", "Saved address not found", 404);
    const saved = await db.address.findUnique({ where: { id: body.addressId } });
    if (!saved || saved.userId !== user.id) {
      throw new ApiError("ADDRESS_NOT_FOUND", "Saved address not found", 404);
    }
    address = {
      name: user.name,
      line1: saved.line1,
      line2: saved.line2,
      city: saved.city,
      state: saved.state,
      zip: saved.zip,
    };
  } else if (body.address) {
    address = {
      name: body.address.name,
      line1: body.address.line1,
      line2: body.address.line2 ?? null,
      city: body.address.city,
      state: body.address.state,
      zip: body.address.zip,
    };
  } else {
    throw new ApiError("ADDRESS_REQUIRED", "Provide a saved addressId or a new address", 400);
  }

  const cart = await getCart();
  if (!cart) throw new ApiError("EMPTY_CART", "Your cart is empty", 400);

  const buyer = user ?? (await resolveGuestUser({ ...body.guest!, phone: body.contactPhone }));

  const result = await createOrderFromCart(
    buyer.id,
    cart,
    address,
    buyer.email,
    // Never fall back to a stored phone for an anonymous buyer: the row was
    // found by an unverified email, so its phone is not theirs to reuse.
    body.contactPhone ?? (user ? user.phone : null),
    body.idempotencyKey,
  );

  if (!user) {
    // Only once the order exists. Attaching first would orphan the cart under
    // a user the buyer cannot sign in as if checkout then failed.
    // The post-payment cart clean-up finds carts by user, which is why a guest
    // cart has to stop being anonymous at all.
    await attachCartToUser(cart.id, buyer);
  }

  // Signed-in customers reach the order through their account; guests need the
  // token. Handing it out only when there is no session keeps it out of logs
  // and referrers for everyone who does not need it.
  return jsonOk(
    user ? result : { ...result, accessToken: encodeOrderToken(result.orderId) },
    result.replayed ? 200 : 201,
  );
});
