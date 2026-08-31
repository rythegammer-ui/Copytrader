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
import { blocksNeeded, isSlotAvailable, nextFreeSlot } from "@/lib/slots";
import type { PaymentProviderApi } from "@/lib/payments/provider";
import { mockProvider } from "@/lib/payments/mock";
import { stripeProvider } from "@/lib/payments/stripe";

export function stripeConfigured(): boolean {
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
      const providerRefund = await getProvider(stray.provider).createRefund(
        stray.intentId,
        stray.amountCents,
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

  return { ok: result.ok, duplicate: result.duplicate, error: result.error };
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
        // A REAL capture on an order that can't accept it. Record the truth
        // (money was captured) and hand back a stray-capture marker; the
        // caller auto-refunds outside this transaction.
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
            intentId: input.intentId,
            amountCents: payment.amountCents,
            orderId: order.id,
            orderNumber: order.orderNumber,
          },
        };
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
      await tx.order.update({
        where: { id: order.id },
        data: { status: OrderStatus.PAID, paidAt: now },
      });
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

      for (const [, groupItemList] of apptGroups) {
        const installerId = groupItemList[0].installerIdSnapshot!;
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
            ? `Requested time was taken — appointment booked at ${shop.name} for ${startAt.toISOString()} instead`
            : `Installation booked at ${shop.name} for ${startAt.toISOString()} (awaiting parts)`,
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
