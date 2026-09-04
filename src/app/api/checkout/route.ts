import { z } from "zod";
import { api, jsonOk, parseBody } from "@/lib/api";
import { getCart } from "@/lib/cart";
import { createOrderFromCart, type CheckoutAddress } from "@/lib/checkout";
import { db } from "@/lib/db";
import { Role } from "@/lib/enums";
import { ApiError } from "@/lib/errors";

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

const zCheckout = z.object({
  addressId: z.string().min(1).optional(),
  address: zInlineAddress.optional(),
  contactPhone: z.string().trim().min(7).max(25).optional(),
  idempotencyKey: z.string().uuid(),
});

/**
 * POST /api/checkout — CUSTOMER.
 * Places the order from the user's current cart: resolves the shipping
 * address (a saved address they own, or an inline one), then creates the
 * immutable order snapshot + payment intent. Idempotent per idempotencyKey —
 * replays return the existing order.
 */
export const POST = api(
  async (req, _ctx, user) => {
    const body = await parseBody(req, zCheckout);

    let address: CheckoutAddress;
    if (body.addressId) {
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

    const result = await createOrderFromCart(
      user.id,
      cart,
      address,
      user.email,
      body.contactPhone ?? user.phone ?? null,
      body.idempotencyKey,
    );
    return jsonOk(result, result.replayed ? 200 : 201);
  },
  { roles: [Role.CUSTOMER] },
);
