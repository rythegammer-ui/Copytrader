import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { EntityType, OrderStatus, PaymentStatus, ShipTo } from "@/lib/enums";
import { ApiError } from "@/lib/errors";
import { logEvent } from "@/lib/events";
import {
  MIN_ORDER_TOTAL_CENTS,
  priceQuote,
  taxRateBps,
  type Quote,
  type QuoteItemInput,
} from "@/lib/pricing";
import { activeProviderName, getProvider, nextNumber } from "@/lib/payments";
import { blocksNeeded, earliestFeasible, isSlotAvailable } from "@/lib/slots";

export type CartWithItems = Prisma.CartGetPayload<{
  include: {
    items: { include: { part: { include: { supplier: true } } } };
  };
}>;

export interface CheckoutAddress {
  name: string;
  line1: string;
  line2?: string | null;
  city: string;
  state: string;
  zip: string;
}

/**
 * Build QuoteItemInputs from cart rows + fetch installer rates.
 * Shared by /api/cart (display quote), /api/checkout/quote, and /api/checkout.
 */
export async function quoteCart(cart: CartWithItems): Promise<Quote> {
  const installerIds = Array.from(
    new Set(cart.items.map((i) => i.installerId).filter((x): x is string => Boolean(x))),
  );
  const installers = await db.installer.findMany({ where: { id: { in: installerIds } } });
  const installerById = new Map(installers.map((i) => [i.id, i]));

  const inputs: QuoteItemInput[] = cart.items.map((item) => {
    const shop = item.installerId ? installerById.get(item.installerId) : undefined;
    return {
      cartItemId: item.id,
      partId: item.partId,
      qty: item.qty,
      priceCents: item.part.priceCents,
      supplierId: item.part.supplierId,
      supplierCostCents: item.part.supplierCostCents,
      installEligible: item.part.installEligible,
      laborHoursTenths: item.part.laborHoursTenths,
      installFixedFeeCents: item.part.installFixedFeeCents,
      withInstall: item.withInstall,
      installerId: item.installerId,
      installerHourlyRateCents: shop?.hourlyRateCents ?? null,
      apptStartAt: item.apptStartAt,
      shipTo: item.shipTo,
    };
  });

  const supplierCfg: Record<string, { shippingFlatCents: number; shippingPerItemCents: number }> = {};
  for (const item of cart.items) {
    supplierCfg[item.part.supplierId] = {
      shippingFlatCents: item.part.supplier.shippingFlatCents,
      shippingPerItemCents: item.part.supplier.shippingPerItemCents,
    };
  }

  return priceQuote(inputs, supplierCfg, taxRateBps());
}

/** Validation shared by quote display and order creation. Throws ApiError. */
export async function validateCartForCheckout(cart: CartWithItems): Promise<void> {
  if (cart.items.length === 0) throw new ApiError("EMPTY_CART", "Your cart is empty", 400);

  for (const item of cart.items) {
    if (!item.part.active) {
      throw new ApiError("PART_UNAVAILABLE", `${item.part.name} is no longer available`, 409, {
        cartItemId: item.id,
      });
    }
    if (!item.part.inStock) {
      throw new ApiError("OUT_OF_STOCK", `${item.part.name} is out of stock at the supplier`, 409, {
        cartItemId: item.id,
      });
    }
    if (item.qty < 1 || item.qty > 10) {
      throw new ApiError("BAD_QTY", "Quantity must be between 1 and 10", 400, { cartItemId: item.id });
    }
    if (item.withInstall) {
      if (!item.part.installEligible) {
        throw new ApiError("NOT_INSTALLABLE", `${item.part.name} is not eligible for installation`, 409, {
          cartItemId: item.id,
        });
      }
      if (!item.installerId || !item.apptStartAt) {
        throw new ApiError(
          "INSTALL_INCOMPLETE",
          `Pick a shop and appointment time for ${item.part.name}`,
          400,
          { cartItemId: item.id },
        );
      }
    }
    if (item.shipTo === ShipTo.INSTALLER && !item.withInstall) {
      throw new ApiError("SHIP_TO_SHOP_NEEDS_INSTALL", "Ship-to-shop requires installation", 400, {
        cartItemId: item.id,
      });
    }
  }

  // Slot availability + feasibility per (shop, slot) group.
  const installGroups = new Map<string, typeof cart.items>();
  for (const item of cart.items) {
    if (!item.withInstall || !item.installerId || !item.apptStartAt) continue;
    const key = `${item.installerId}|${item.apptStartAt.toISOString()}`;
    const list = installGroups.get(key) ?? [];
    list.push(item);
    installGroups.set(key, list);
  }
  for (const [, items] of installGroups) {
    const shop = await db.installer.findUnique({ where: { id: items[0].installerId! } });
    if (!shop || !shop.active) {
      throw new ApiError("SHOP_UNAVAILABLE", "That installer shop is no longer available", 409);
    }
    const laborTenths = items.reduce((s, i) => s + i.part.laborHoursTenths * i.qty, 0);
    const blocks = blocksNeeded(laborTenths, shop.slotMinutes);
    const startAt = items[0].apptStartAt!;
    const maxLead = Math.max(...items.map((i) => i.part.supplier.leadTimeDays));
    if (startAt < earliestFeasible(maxLead)) {
      throw new ApiError(
        "SLOT_INFEASIBLE",
        "Parts can't arrive before that appointment — pick a later time",
        409,
        { installerId: shop.id, startAt: startAt.toISOString() },
      );
    }
    const ok = await isSlotAvailable(db, shop, startAt, blocks);
    if (!ok) {
      throw new ApiError("SLOT_TAKEN", "That appointment time just filled up — pick another", 409, {
        installerId: shop.id,
        startAt: startAt.toISOString(),
      });
    }
  }
}

export interface CheckoutResult {
  orderId: string;
  orderNumber: string;
  provider: string;
  clientSecret: string;
  totalCents: number;
  replayed: boolean;
}

/**
 * Create the order (immutable snapshots) + payment intent from a validated cart.
 * Idempotent per (user, idempotencyKey): replays return the existing order.
 */
export async function createOrderFromCart(
  userId: string,
  cart: CartWithItems,
  address: CheckoutAddress,
  contactEmail: string,
  contactPhone: string | null,
  idempotencyKey: string,
): Promise<CheckoutResult> {
  const existing = await db.order.findUnique({
    where: { idempotencyKey },
    include: { payments: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  if (existing) {
    if (existing.userId !== userId) throw new ApiError("FORBIDDEN", "Not your order", 403);
    const payment = existing.payments[0];
    return {
      orderId: existing.id,
      orderNumber: existing.orderNumber,
      provider: payment?.provider ?? activeProviderName(),
      clientSecret: payment?.clientSecret ?? "",
      totalCents: existing.totalCents,
      replayed: true,
    };
  }

  await validateCartForCheckout(cart);
  const quote = await quoteCart(cart);
  if (quote.totalCents < MIN_ORDER_TOTAL_CENTS) {
    throw new ApiError("ORDER_TOO_SMALL", "Order total is below the payment minimum", 400);
  }

  // Vehicle description snapshot from the cart's fitment context.
  let vehicleDesc: string | null = null;
  if (cart.ctxModelId && cart.ctxYear) {
    const model = await db.vehicleModel.findUnique({
      where: { id: cart.ctxModelId },
      include: { make: true },
    });
    const engine = cart.ctxEngineId
      ? await db.engine.findUnique({ where: { id: cart.ctxEngineId } })
      : null;
    if (model) {
      vehicleDesc = `${cart.ctxYear} ${model.make.name} ${model.name}${engine ? ` ${engine.name}` : ""}`;
    }
  }

  // Create the provider intent BEFORE the DB transaction (network call);
  // cancel best-effort if the transaction fails.
  const providerName = activeProviderName();
  const provider = getProvider(providerName);
  const intent = await provider.createIntent(quote.totalCents, "usd", { idempotencyKey });

  try {
    const result = await db.$transaction(async (tx) => {
      const orderNum = await nextNumber(tx, "order");
      const linesByCartItem = new Map(quote.lines.map((l) => [l.cartItemId!, l]));

      const order = await tx.order.create({
        data: {
          orderNumber: `ORD-${orderNum}`,
          idempotencyKey,
          userId,
          status: OrderStatus.PENDING_PAYMENT,
          partsSubtotalCents: quote.partsSubtotalCents,
          installSubtotalCents: quote.installSubtotalCents,
          shippingTotalCents: quote.shippingTotalCents,
          taxRateBps: quote.taxRateBps,
          taxCents: quote.taxCents,
          totalCents: quote.totalCents,
          shipName: address.name,
          shipLine1: address.line1,
          shipLine2: address.line2 ?? null,
          shipCity: address.city,
          shipState: address.state,
          shipZip: address.zip,
          contactEmail,
          contactPhone,
          vehicleDesc,
          shippingGroupsJson: JSON.stringify(
            quote.groups.map((g) => ({
              key: g.key,
              supplierId: g.supplierId,
              shipTo: g.shipTo,
              installerId: g.installerId,
              shippingCents: g.shippingCents,
              supplierCostTotalCents: g.supplierCostTotalCents,
            })),
          ),
          items: {
            create: cart.items.map((item) => {
              const line = linesByCartItem.get(item.id);
              if (!line) throw new ApiError("QUOTE_MISMATCH", "Cart changed during checkout", 409);
              return {
                partId: item.partId,
                supplierId: item.part.supplierId,
                skuSnapshot: item.part.sku,
                nameSnapshot: item.part.name,
                imageUrlSnapshot: item.part.imageUrl,
                unitPriceCents: line.unitPriceCents,
                supplierCostCentsSnapshot: item.part.supplierCostCents,
                qty: item.qty,
                lineTotalCents: line.lineTotalCents,
                withInstall: line.withInstall,
                laborHoursTenthsSnapshot: line.laborHoursTenths,
                shopRateCentsSnapshot: line.shopRateCents,
                installUnitCents: line.installUnitCents,
                installTotalCents: line.installTotalCents,
                shipTo: line.shipTo,
                installerIdSnapshot: line.installerId,
                requestedApptStartAt: line.apptStartAt,
              };
            }),
          },
        },
      });

      await tx.payment.create({
        data: {
          orderId: order.id,
          provider: providerName,
          providerIntentId: intent.intentId,
          clientSecret: intent.clientSecret,
          amountCents: quote.totalCents,
          currency: "usd",
          status: PaymentStatus.REQUIRES_PAYMENT,
        },
      });

      await logEvent(tx, {
        orderId: order.id,
        entityType: EntityType.ORDER,
        entityId: order.id,
        action: "created",
        toStatus: OrderStatus.PENDING_PAYMENT,
        actorUserId: userId,
        actorRole: "CUSTOMER",
        message: `Order ${order.orderNumber} placed — awaiting payment`,
      });

      return { orderId: order.id, orderNumber: order.orderNumber };
    });

    return {
      ...result,
      provider: providerName,
      clientSecret: intent.clientSecret,
      totalCents: quote.totalCents,
      replayed: false,
    };
  } catch (err) {
    await provider.cancelIntent(intent.intentId);
    throw err;
  }
}

/** New payment attempt for a PENDING_PAYMENT / PAYMENT_FAILED order. */
export async function createRetryPayment(orderId: string, userId: string): Promise<CheckoutResult> {
  const order = await db.order.findUnique({
    where: { id: orderId },
    include: { payments: true },
  });
  if (!order || order.userId !== userId) throw new ApiError("NOT_FOUND", "Order not found", 404);
  if (order.status !== OrderStatus.PAYMENT_FAILED && order.status !== OrderStatus.PENDING_PAYMENT) {
    throw new ApiError("NOT_RETRYABLE", "This order is not awaiting payment", 409);
  }
  if (order.payments.some((p) => p.status === PaymentStatus.SUCCEEDED)) {
    throw new ApiError("ALREADY_PAID", "This order is already paid", 409);
  }

  // Cancel every stale attempt at the provider BEFORE issuing a new intent —
  // an old intent left confirmable in another tab is a double-charge waiting
  // to happen. (FAILED Stripe intents remain confirmable until cancelled.)
  const staleStatuses: string[] = [PaymentStatus.REQUIRES_PAYMENT, PaymentStatus.FAILED];
  for (const p of order.payments.filter((p) => staleStatuses.includes(p.status))) {
    await getProvider(p.provider).cancelIntent(p.providerIntentId);
  }
  await db.payment.updateMany({
    where: { orderId, status: PaymentStatus.REQUIRES_PAYMENT },
    data: { status: PaymentStatus.CANCELLED },
  });

  const providerName = activeProviderName();
  const provider = getProvider(providerName);
  const intent = await provider.createIntent(order.totalCents, order.currency, { orderId });

  await db.$transaction(async (tx) => {
    await tx.payment.create({
      data: {
        orderId: order.id,
        provider: providerName,
        providerIntentId: intent.intentId,
        clientSecret: intent.clientSecret,
        amountCents: order.totalCents,
        currency: order.currency,
        status: PaymentStatus.REQUIRES_PAYMENT,
      },
    });
    if (order.status === OrderStatus.PAYMENT_FAILED) {
      await tx.order.update({
        where: { id: order.id },
        data: { status: OrderStatus.PENDING_PAYMENT },
      });
      await logEvent(tx, {
        orderId: order.id,
        entityType: EntityType.ORDER,
        entityId: order.id,
        action: "status_change",
        fromStatus: OrderStatus.PAYMENT_FAILED,
        toStatus: OrderStatus.PENDING_PAYMENT,
        actorUserId: userId,
        actorRole: "CUSTOMER",
        message: "Payment retry started",
      });
    }
  });

  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    provider: providerName,
    clientSecret: intent.clientSecret,
    totalCents: order.totalCents,
    replayed: false,
  };
}
