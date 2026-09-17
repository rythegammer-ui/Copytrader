import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  AppointmentStatus,
  EntityType,
  OrderItemStatus,
  OrderStatus,
  PaymentStatus,
  PayProvider,
  RefundStatus,
  Role,
  ShipTo,
} from "@/lib/enums";
import { logEvent, notify, notifyMany } from "@/lib/events";
import { formatShopTime } from "@/lib/format";
import { blocksNeeded, isSlotAvailable, lockShop, nextFreeSlot } from "@/lib/slots";
import type { PaymentProviderApi } from "@/lib/payments/provider";
import { mockProvider } from "@/lib/payments/mock";
import { stripeProvider } from "@/lib/payments/stripe";
import { drawDownPart } from "@/lib/inventory";
import { sendMail, siteUrl } from "@/lib/mail";

/**
 * Stripe is usable only when the app can BOTH charge and confirm.
 *
 * The secret key alone is not enough. Without a webhook signing secret every
 * delivery fails signature verification, so `payment_intent.succeeded` never
 * lands, the order sits in PENDING_PAYMENT, and 24 hours later the stale-order
 * sweep cancels an order whose card was actually charged. Requiring both means
 * a half-finished setup falls back to the clearly-labelled demo provider
 * instead of taking money it cannot account for.
 */
export function stripeConfigured(): boolean {
  const secret = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (secret && !webhookSecret) {
    console.warn(
      "[payments] STRIPE_SECRET_KEY is set but STRIPE_WEBHOOK_SECRET is not — " +
        "staying on the demo provider rather than taking card payments that " +
        "cannot be confirmed. Set the signing secret from your Stripe webhook " +
        "endpoint and redeploy.",
    );
  }
  return Boolean(secret && webhookSecret);
}

/** True when a secret key exists, whatever else is missing. */
export function stripeKeyPresent(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

/** Provider used for NEW intents. */
export function activeProviderName(): string {
  return stripeConfigured() ? PayProvider.STRIPE : PayProvider.MOCK;
}

export function getProvider(name: string): PaymentProviderApi {
  return name === PayProvider.STRIPE ? stripeProvider : mockProvider;
}

/** Increment a human-readable number counter inside a transaction. */
export async function nextNumber(tx: Prisma.TransactionClient, key: string): Promise<number> {
  const counter = await tx.counter.upsert({
    where: { key },
    create: { key, value: 100001 },
    update: { value: { increment: 1 } },
  });
  return counter.value;
}

interface ShippingGroupSnapshot {
  key: string;
  supplierId: string;
  shipTo: string;
  installerId: string | null;
  shippingCents: number;
  supplierCostTotalCents: number;
}

export interface PaymentEventInput {
  provider: string; // PayProvider
  intentId: string;
  eventId: string; // stripe event id or "mock:<intentId>:<outcome>"
  eventType: string;
  /** Amount/currency as reported BY THE PROVIDER (verification input). */
  providerAmountCents?: number;
  providerCurrency?: string;
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

interface StrayCapture {
  paymentId: string;
  provider: string;
  intentId: string;
  amountCents: number;
  orderId: string;
  orderNumber: string;
}

type SucceededResult = { ok: boolean; duplicate?: boolean; error?: string; strayCapture?: StrayCapture };

/**
 * The single idempotent entry point that flips an order to PAID and fans out
 * dropship POs + install appointments. Called by the Stripe webhook AND the
 * mock confirm endpoint. Replays are no-ops (WebhookEvent ledger + status
 * guard). A REAL capture on an order that can no longer accept it (paid via
 * another intent, cancelled, refunded) is never swallowed: it is recorded and
 * automatically refunded, with admins alerted.
 */
export async function handlePaymentSucceeded(input: PaymentEventInput): Promise<{ ok: boolean; duplicate?: boolean; error?: string }> {
  let result: SucceededResult;
  try {
    result = await runPaymentSucceededTx(input);
  } catch (err) {
    // Two concurrent confirms of the same event: the loser's ledger insert
    // hits the unique constraint — that's a duplicate, not an error.
    if (isUniqueViolation(err)) return { ok: true, duplicate: true };
    throw err;
  }

  if (result.strayCapture) {
    const stray = result.strayCapture;
    // Money genuinely moved on a dead order — refund it in full. This charge
    // was never part of the order's books, so refundedTotalCents is untouched.
    try {
      // A stray capture is uniquely identified by the intent that produced
      // it, so the intent id is a naturally stable idempotency key: this
      // auto-refund can be retried any number of times and still move the
      // money exactly once.
      const providerRefund = await getProvider(stray.provider).createRefund(
        stray.intentId,
        stray.amountCents,
        `stray-capture:${stray.intentId}`,
      );
      await db.$transaction(async (tx) => {
        const refund = await tx.refund.create({
          data: {
            orderId: stray.orderId,
            paymentId: stray.paymentId,
            amountCents: stray.amountCents,
            reason: "Automatic refund — payment captured after the order was closed",
            providerRefundId: providerRefund.refundId,
            status: providerRefund.status,
          },
        });
        await logEvent(tx, {
          orderId: stray.orderId,
          entityType: EntityType.REFUND,
          entityId: refund.id,
          action: "created",
          actorRole: "SYSTEM",
          message: `Automatic refund of a payment captured after ${stray.orderNumber} was closed`,
        });
      });
    } catch (refundErr) {
      await db.$transaction(async (tx) => {
        await tx.refund.create({
          data: {
            orderId: stray.orderId,
            paymentId: stray.paymentId,
            amountCents: stray.amountCents,
            reason: "Automatic refund — payment captured after the order was closed",
            status: RefundStatus.FAILED,
          },
        });
        const admins = await tx.user.findMany({ where: { role: Role.ADMIN }, select: { id: true } });
        await notifyMany(tx, admins.map((u) => u.id), {
          type: "refund_failed",
          title: "Stray capture refund FAILED",
          body: `Order ${stray.orderNumber}: a late capture could not be auto-refunded (${refundErr instanceof Error ? refundErr.message : "unknown error"}). Refund manually.`,
          href: `/admin/orders/${stray.orderId}`,
        });
      });
    }
    return {
      ok: false,
      error: "This order can no longer accept payment — the charge was automatically refunded",
    };
  }

  // Receipt. Outside the transaction on purpose — a network call has no place
  // holding one open — and only on the first confirm, so Stripe's retries do
  // not email the customer repeatedly. Failure here never fails the payment.
  if (result.ok && !result.duplicate) {
    await sendOrderReceipt(input.intentId).catch((err) => {
      console.error("[MAIL] receipt failed:", err instanceof Error ? err.message : err);
    });
  }

  return { ok: result.ok, duplicate: result.duplicate, error: result.error };
}

/**
 * Email the buyer that their money went through and what happens next.
 *
 * This matters most for guests: they have no account to look the order up in,
 * so this and the link they were given at checkout are all they have.
 */
async function sendOrderReceipt(intentId: string): Promise<void> {
  const payment = await db.payment.findUnique({
    where: { providerIntentId: intentId },
    include: { order: { include: { items: true } } },
  });
  const order = payment?.order;
  if (!order?.contactEmail) return;

  const lines = order.items.map((i) => {
    const install = i.installTotalCents > 0 ? ` (+ ${money(i.installTotalCents)} fitting)` : "";
    return `  ${i.qty} x ${i.nameSnapshot} — ${money(i.lineTotalCents)}${install}`;
  });
  await sendMail({
    to: order.contactEmail,
    subject: `Order ${order.orderNumber} confirmed`,
    text:
      `Thanks — we've got your payment for order ${order.orderNumber}.\n\n` +
      `${lines.join("\n")}\n\n` +
      `Total paid: ${money(order.totalCents)}\n\n` +
      `Shipping to:\n${order.shipName}\n${order.shipLine1}\n` +
      `${order.shipCity}, ${order.shipState} ${order.shipZip}\n\n` +
      `We're pulling and packing your parts now and will be in touch if anything needs confirming. ` +
      `Questions about this order? Reply to this email or call the shop.\n\n` +
      `${siteUrl()}`,
  });
}

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * A REAL capture landed on an order that can no longer accept it (paid via
 * another intent, cancelled, refunded, or lost the PAID compare-and-set).
 * Record the truth (money was captured) and hand back a stray-capture marker;
 * the caller auto-refunds outside the transaction.
 */
async function recordStrayCapture(
  tx: Prisma.TransactionClient,
  payment: { id: string; provider: string; amountCents: number },
  order: { id: string; status: string; orderNumber: string },
  intentId: string,
): Promise<SucceededResult> {
  await tx.payment.update({
    where: { id: payment.id },
    data: {
      status: PaymentStatus.SUCCEEDED,
      succeededAt: new Date(),
      lastError: `Captured while order was ${order.status} — auto-refunding`,
    },
  });
  await logEvent(tx, {
    orderId: order.id,
    entityType: EntityType.PAYMENT,
    entityId: payment.id,
    action: "orphaned_capture",
    internal: true,
    actorRole: "SYSTEM",
    message: `Payment captured on ${order.orderNumber} while it was ${order.status}; issuing automatic refund`,
  });
  const admins = await tx.user.findMany({ where: { role: Role.ADMIN }, select: { id: true } });
  await notifyMany(tx, admins.map((u) => u.id), {
    type: "orphaned_capture",
    title: `Late capture on ${order.orderNumber}`,
    body: `A payment was captured while the order was ${order.status}. An automatic refund is being issued — verify it landed.`,
    href: `/admin/orders/${order.id}`,
  });
  return {
    ok: false,
    error: "Order not payable",
    strayCapture: {
      paymentId: payment.id,
      provider: payment.provider,
      intentId,
      amountCents: payment.amountCents,
      orderId: order.id,
      orderNumber: order.orderNumber,
    },
  };
}

function runPaymentSucceededTx(input: PaymentEventInput): Promise<SucceededResult> {
  return db.$transaction(
    async (tx): Promise<SucceededResult> => {
      const seen = await tx.webhookEvent.findUnique({
        where: { provider_eventId: { provider: input.provider, eventId: input.eventId } },
      });
      if (seen) return { ok: true, duplicate: true };
      await tx.webhookEvent.create({
        data: {
          provider: input.provider,
          eventId: input.eventId,
          type: input.eventType,
          payloadJson: JSON.stringify({ intentId: input.intentId }),
        },
      });

      const payment = await tx.payment.findUnique({
        where: { providerIntentId: input.intentId },
        include: { order: { include: { items: true, user: true } } },
      });
      if (!payment) return { ok: false, error: "Unknown payment intent" };
      const order = payment.order;

      if (payment.status === PaymentStatus.SUCCEEDED) {
        return { ok: true, duplicate: true }; // true replay of this same capture
      }
      const payable =
        order.status === OrderStatus.PENDING_PAYMENT || order.status === OrderStatus.PAYMENT_FAILED;
      if (order.paidAt || !payable) {
        return recordStrayCapture(tx, payment, order, input.intentId);
      }

      // AMOUNT VERIFICATION — never mark an order paid for the wrong amount.
      const amountOk =
        payment.amountCents === order.totalCents &&
        (input.providerAmountCents === undefined || input.providerAmountCents === order.totalCents) &&
        (input.providerCurrency === undefined ||
          input.providerCurrency.toLowerCase() === order.currency.toLowerCase());
      if (!amountOk) {
        await tx.payment.update({
          where: { id: payment.id },
          data: { status: PaymentStatus.FAILED, lastError: "Amount/currency mismatch on confirmation" },
        });
        await logEvent(tx, {
          orderId: order.id,
          entityType: EntityType.PAYMENT,
          entityId: payment.id,
          action: "amount_mismatch",
          internal: true,
          actorRole: "SYSTEM",
          message: `Payment amount mismatch on ${order.orderNumber}: intent=${input.providerAmountCents ?? payment.amountCents} order=${order.totalCents}`,
        });
        const admins = await tx.user.findMany({ where: { role: Role.ADMIN }, select: { id: true } });
        await notifyMany(tx, admins.map((u) => u.id), {
          type: "payment_mismatch",
          title: `Payment mismatch on ${order.orderNumber}`,
          body: "A payment confirmation did not match the order total. Order NOT marked paid.",
          href: `/admin/orders/${order.id}`,
        });
        return { ok: false, error: "Amount mismatch" };
      }

      const now = new Date();
      await tx.payment.update({
        where: { id: payment.id },
        data: { status: PaymentStatus.SUCCEEDED, succeededAt: now },
      });
      // Compare-and-set: under Postgres READ COMMITTED a concurrent capture on a
      // different intent could flip this order between our read and this write.
      // Losing that race means THIS capture is the stray one.
      const flipped = await tx.order.updateMany({
        where: {
          id: order.id,
          paidAt: null,
          status: { in: [OrderStatus.PENDING_PAYMENT, OrderStatus.PAYMENT_FAILED] },
        },
        data: { status: OrderStatus.PAID, paidAt: now },
      });
      if (flipped.count === 0) {
        const current = await tx.order.findUniqueOrThrow({ where: { id: order.id } });
        return recordStrayCapture(tx, payment, current, input.intentId);
      }
      await logEvent(tx, {
        orderId: order.id,
        entityType: EntityType.ORDER,
        entityId: order.id,
        action: "status_change",
        fromStatus: order.status,
        toStatus: OrderStatus.PAID,
        actorRole: "SYSTEM",
        message: `Payment received for ${order.orderNumber}`,
      });

      // ------- PO FAN-OUT (from the checkout shipping-group snapshot) -------
      const groups = JSON.parse(order.shippingGroupsJson) as ShippingGroupSnapshot[];
      const liveItems = order.items.filter((i) => i.itemStatus === OrderItemStatus.PENDING);

      // ------- FINITE INVENTORY DRAW-DOWN -------
      // A part pulled from one car exists once. Checkout already validated
      // availability; this is the authoritative decrement.
      for (const item of liveItems) {
        const drawn = await drawDownPart(tx, item.partId, item.qty);
        if (!drawn.ok) {
          // Two carts raced the last unit. The payment stands — flag it so a
          // human sorts out the physical part rather than failing the charge.
          const part = { name: drawn.name };
          await logEvent(tx, {
            orderId: order.id,
            entityType: EntityType.PART,
            entityId: item.partId,
            action: "oversold",
            internal: true,
            actorRole: "SYSTEM",
            message: `${part.name} sold beyond available stock on ${order.orderNumber} — confirm the physical part or refund the line`,
          });
          const admins = await tx.user.findMany({ where: { role: Role.ADMIN }, select: { id: true } });
          await notifyMany(tx, admins.map((u) => u.id), {
            type: "oversold",
            title: `Oversold: ${part.name}`,
            body: `Order ${order.orderNumber} claimed more of this part than was on hand. Confirm stock or refund the line.`,
            href: `/admin/orders/${order.id}`,
          });
        }
      }

      const supplierIds = Array.from(new Set(groups.map((g) => g.supplierId)));
      const suppliers = await tx.supplier.findMany({ where: { id: { in: supplierIds } } });
      const supplierById = new Map(suppliers.map((s) => [s.id, s]));
      const installerIds = Array.from(
        new Set(groups.map((g) => g.installerId).filter((x): x is string => Boolean(x))),
      );
      const installers = await tx.installer.findMany({ where: { id: { in: installerIds } } });
      const installerById = new Map(installers.map((s) => [s.id, s]));

      for (const group of groups) {
        const supplier = supplierById.get(group.supplierId);
        if (!supplier) throw new Error(`Supplier ${group.supplierId} missing at fan-out`);
        const matched = liveItems.filter(
          (i) =>
            i.supplierId === group.supplierId &&
            i.shipTo === group.shipTo &&
            (group.shipTo !== ShipTo.INSTALLER || i.installerIdSnapshot === group.installerId),
        );
        if (matched.length === 0) continue;

        const poNum = await nextNumber(tx, "po");
        // Destination: SHOP address for installer-destined POs (privacy: the
        // supplier never sees the customer's home address on these).
        let dest;
        if (group.shipTo === ShipTo.INSTALLER && group.installerId) {
          const shop = installerById.get(group.installerId);
          if (!shop) throw new Error(`Installer ${group.installerId} missing at fan-out`);
          dest = {
            destName: `${shop.name} (Attn: Order ${order.orderNumber})`,
            destLine1: shop.line1,
            destLine2: null as string | null,
            destCity: shop.city,
            destState: shop.state,
            destZip: shop.zip,
          };
        } else {
          dest = {
            destName: order.shipName,
            destLine1: order.shipLine1,
            destLine2: order.shipLine2,
            destCity: order.shipCity,
            destState: order.shipState,
            destZip: order.shipZip,
          };
        }

        const po = await tx.purchaseOrder.create({
          data: {
            poNumber: `PO-${poNum}`,
            orderId: order.id,
            supplierId: group.supplierId,
            shipTo: group.shipTo,
            installerId: group.installerId,
            ...dest,
            supplierCostTotalCents: matched.reduce(
              (s, i) => s + i.supplierCostCentsSnapshot * i.qty,
              0,
            ),
            shippingFeeCents: group.shippingCents,
            dueAt: new Date(now.getTime() + supplier.leadTimeDays * 24 * 60 * 60_000),
          },
        });
        await tx.orderItem.updateMany({
          where: { id: { in: matched.map((i) => i.id) } },
          data: { purchaseOrderId: po.id },
        });
        await logEvent(tx, {
          orderId: order.id,
          entityType: EntityType.PURCHASE_ORDER,
          entityId: po.id,
          action: "created",
          toStatus: po.status,
          actorRole: "SYSTEM",
          message: `${po.poNumber} sent to ${supplier.name} (${matched.length} item${matched.length > 1 ? "s" : ""})`,
        });
        const supplierUsers = await tx.user.findMany({
          where: { supplierId: supplier.id, role: Role.SUPPLIER },
          select: { id: true },
        });
        await notifyMany(tx, supplierUsers.map((u) => u.id), {
          type: "po_new",
          title: `New purchase order ${po.poNumber}`,
          body: `Order ${order.orderNumber}: ${matched.length} line(s) to fulfill.`,
          href: `/supplier/pos/${po.id}`,
        });
      }

      // ------- APPOINTMENT FAN-OUT (dedupe by shop + slot) -------
      const installItems = liveItems.filter(
        (i) => i.withInstall && i.installerIdSnapshot && i.requestedApptStartAt,
      );
      const apptGroups = new Map<string, typeof installItems>();
      for (const item of installItems) {
        const key = `${item.installerIdSnapshot}|${item.requestedApptStartAt!.toISOString()}`;
        const list = apptGroups.get(key) ?? [];
        list.push(item);
        apptGroups.set(key, list);
      }

      // Lock shops in a consistent order (keys start with installerId) so two
      // multi-shop orders can never deadlock, and capacity checks are serialized.
      const apptEntries = [...apptGroups.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      for (const [, groupItemList] of apptEntries) {
        const installerId = groupItemList[0].installerIdSnapshot!;
        await lockShop(tx, installerId);
        let shop = installerById.get(installerId);
        if (!shop) {
          shop = (await tx.installer.findUnique({ where: { id: installerId } })) ?? undefined;
          if (shop) installerById.set(installerId, shop);
        }
        if (!shop) continue;

        const totalLaborTenths = groupItemList.reduce(
          (s, i) => s + (i.laborHoursTenthsSnapshot ?? 0) * i.qty,
          0,
        );
        const blocks = blocksNeeded(totalLaborTenths, shop.slotMinutes);
        let startAt = groupItemList[0].requestedApptStartAt!;
        let rescheduled = false;
        let overbooked = false;
        const available = await isSlotAvailable(tx, shop, startAt, blocks);
        if (!available) {
          // Documented behavior: never fail a successful payment over a slot
          // race — book the next free slot and tell everyone.
          const fallback = await nextFreeSlot(
            tx,
            shop,
            new Date(now.getTime() + 24 * 60 * 60_000),
            blocks,
          );
          if (fallback) {
            startAt = fallback;
            rescheduled = true;
          } else {
            // No free slot for 30 days: keep the requested time (payment must
            // not fail) but flag the deliberate overbook loudly.
            overbooked = true;
          }
        }

        const appt = await tx.appointment.create({
          data: {
            orderId: order.id,
            installerId,
            startAt,
            durationMinutes: blocks * shop.slotMinutes,
            totalLaborHoursTenths: totalLaborTenths,
            vehicleDesc: order.vehicleDesc,
            customerName: order.shipName,
            customerPhone: order.contactPhone,
          },
        });
        await tx.orderItem.updateMany({
          where: { id: { in: groupItemList.map((i) => i.id) } },
          data: { appointmentId: appt.id },
        });
        await logEvent(tx, {
          orderId: order.id,
          entityType: EntityType.APPOINTMENT,
          entityId: appt.id,
          action: rescheduled ? "auto_rescheduled" : "created",
          toStatus: AppointmentStatus.PENDING_PARTS,
          actorRole: "SYSTEM",
          message: rescheduled
            ? `Requested time was taken — appointment booked at ${shop.name} for ${formatShopTime(startAt, shop.tzOffsetMinutes)} instead`
            : `Installation booked at ${shop.name} for ${formatShopTime(startAt, shop.tzOffsetMinutes)} (awaiting parts)`,
        });
        if (rescheduled) {
          await notify(tx, {
            userId: order.userId,
            type: "appt_rescheduled",
            title: "Appointment time adjusted",
            body: `Your requested slot filled up during checkout. We booked the next available time at ${shop.name} — you can reschedule anytime.`,
            href: `/account/appointments`,
          });
        }
        const installerUsers = await tx.user.findMany({
          where: { installerId, role: Role.INSTALLER },
          select: { id: true },
        });
        if (overbooked) {
          await logEvent(tx, {
            orderId: order.id,
            entityType: EntityType.APPOINTMENT,
            entityId: appt.id,
            action: "overbooked",
            internal: true,
            actorRole: "SYSTEM",
            message: `Appointment for ${order.orderNumber} exceeds bay capacity at ${shop.name} (no free slot within 30 days) — needs manual rescheduling`,
          });
          const admins = await tx.user.findMany({ where: { role: Role.ADMIN }, select: { id: true } });
          await notifyMany(tx, [...admins.map((u) => u.id), ...installerUsers.map((u) => u.id)], {
            type: "appt_overbooked",
            title: "Overbooked appointment needs rescheduling",
            body: `Order ${order.orderNumber} booked over capacity at ${shop.name} — reschedule it manually.`,
            href: `/admin/orders/${order.id}`,
          });
        }
        await notifyMany(tx, installerUsers.map((u) => u.id), {
          type: "appt_new",
          title: "New installation booked",
          body: `Order ${order.orderNumber} booked an install (parts shipping to ${groupItemList.some((i) => i.shipTo === ShipTo.INSTALLER) ? "your shop" : "the customer"}).`,
          href: `/installer/appointments/${appt.id}`,
        });
      }

      // PAID -> PROCESSING (kept distinct so PAID shows in the timeline).
      await tx.order.update({ where: { id: order.id }, data: { status: OrderStatus.PROCESSING } });
      await logEvent(tx, {
        orderId: order.id,
        entityType: EntityType.ORDER,
        entityId: order.id,
        action: "status_change",
        fromStatus: OrderStatus.PAID,
        toStatus: OrderStatus.PROCESSING,
        actorRole: "SYSTEM",
        message: `Purchase orders sent to suppliers`,
      });
      await notify(tx, {
        userId: order.userId,
        type: "order_paid",
        title: `Order ${order.orderNumber} confirmed`,
        body: `Payment received. Your parts are on the way from our suppliers.`,
        href: `/account/orders/${order.id}`,
      });

      // Clear the ORDERED items from the customer's cart (anything they added
      // after checkout stays in the cart).
      const cart = await tx.cart.findFirst({ where: { userId: order.userId } });
      if (cart) {
        await tx.cartItem.deleteMany({
          where: { cartId: cart.id, partId: { in: order.items.map((i) => i.partId) } },
        });
      }

      return { ok: true };
    },
    { timeout: 30_000, maxWait: 10_000 },
  );
}

export async function handlePaymentFailed(input: PaymentEventInput & { errorMessage?: string }): Promise<{ ok: boolean; duplicate?: boolean }> {
  try {
    return await runPaymentFailedTx(input);
  } catch (err) {
    if (isUniqueViolation(err)) return { ok: true, duplicate: true };
    throw err;
  }
}

function runPaymentFailedTx(input: PaymentEventInput & { errorMessage?: string }): Promise<{ ok: boolean; duplicate?: boolean }> {
  return db.$transaction(async (tx) => {
    const seen = await tx.webhookEvent.findUnique({
      where: { provider_eventId: { provider: input.provider, eventId: input.eventId } },
    });
    if (seen) return { ok: true, duplicate: true };
    await tx.webhookEvent.create({
      data: {
        provider: input.provider,
        eventId: input.eventId,
        type: input.eventType,
        payloadJson: JSON.stringify({ intentId: input.intentId }),
      },
    });

    const payment = await tx.payment.findUnique({
      where: { providerIntentId: input.intentId },
      include: { order: true },
    });
    if (!payment) return { ok: false };
    if (payment.status !== PaymentStatus.REQUIRES_PAYMENT) return { ok: true, duplicate: true };

    await tx.payment.update({
      where: { id: payment.id },
      data: { status: PaymentStatus.FAILED, lastError: input.errorMessage ?? "Payment failed" },
    });
    if (payment.order.status === OrderStatus.PENDING_PAYMENT) {
      await tx.order.update({
        where: { id: payment.orderId },
        data: { status: OrderStatus.PAYMENT_FAILED },
      });
      await logEvent(tx, {
        orderId: payment.orderId,
        entityType: EntityType.PAYMENT,
        entityId: payment.id,
        action: "status_change",
        fromStatus: OrderStatus.PENDING_PAYMENT,
        toStatus: OrderStatus.PAYMENT_FAILED,
        actorRole: "SYSTEM",
        message: `Payment failed: ${input.errorMessage ?? "declined"} — you can retry from the payment page`,
      });
      await notify(tx, {
        userId: payment.order.userId,
        type: "payment_failed",
        title: "Payment failed",
        body: `Payment for ${payment.order.orderNumber} did not go through. You can retry.`,
        href: `/checkout/pay/${payment.orderId}`,
      });
    }
    return { ok: true };
  });
}

/**
 * What the provider says actually happened to an order's payment intents.
 *
 * "paid" — money is captured; the order has now been applied.
 * "in_flight" — an async method (bank debit, wallet redirect) is still
 *   resolving. Not paid, but absolutely not safe to cancel.
 * "unpaid" — nothing was taken.
 */
export type ReconcileResult = "paid" | "in_flight" | "unpaid";

/** Stripe returns lowercase intent statuses; the mock returns PaymentStatus. */
export function intentSaysPaid(status: string): boolean {
  const s = status.toLowerCase();
  return s === "succeeded";
}

export function intentInFlight(status: string): boolean {
  const s = status.toLowerCase();
  return s === "processing" || s === "requires_action" || s === "requires_capture";
}

/**
 * Ask the payment provider what really happened, and apply it.
 *
 * Webhooks are the normal path, but they are not guaranteed: an endpoint can
 * be unregistered during cutover, carry the wrong signing secret, or be down
 * past Stripe's three-day retry window. Without this the app would believe an
 * order was never paid while the customer's card had in fact been charged —
 * and the stale-order sweep would then cancel it.
 *
 * Never call this inside a transaction: it makes a network request.
 */
export async function reconcileOrderPayments(orderId: string): Promise<ReconcileResult> {
  const payments = await db.payment.findMany({
    where: { orderId, status: { in: [PaymentStatus.REQUIRES_PAYMENT, PaymentStatus.FAILED] } },
    select: { id: true, provider: true, providerIntentId: true },
  });
  if (payments.length === 0) return "unpaid";

  let sawInFlight = false;
  for (const payment of payments) {
    let intent = null;
    try {
      intent = await getProvider(payment.provider).retrieveIntent(payment.providerIntentId);
    } catch {
      // A provider we cannot reach is not evidence that nothing was charged,
      // so treat it as in-flight and leave the order alone.
      sawInFlight = true;
      continue;
    }
    if (!intent) continue;

    if (intentSaysPaid(intent.status)) {
      // Feed it through the same handler the webhook uses so the amount
      // assertion, PAID compare-and-set, stock draw-down and PO fan-out all
      // run exactly once. A webhook arriving later is deduped by those same
      // in-transaction guards, not by the event ledger, since this synthetic
      // id will never match Stripe's evt_... one.
      await handlePaymentSucceeded({
        provider: payment.provider,
        intentId: payment.providerIntentId,
        eventId: `reconcile:${payment.providerIntentId}`,
        eventType: "reconcile.payment_intent.succeeded",
        providerAmountCents: intent.amountCents,
        providerCurrency: intent.currency,
      });
      return "paid";
    }
    if (intentInFlight(intent.status)) sawInFlight = true;
  }
  return sawInFlight ? "in_flight" : "unpaid";
}
