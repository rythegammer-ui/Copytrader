import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  AppointmentStatus,
  EntityType,
  OrderItemStatus,
  OrderStatus,
  PaymentStatus,
  POStatus,
  RefundStatus,
  Role,
  ShipTo,
} from "@/lib/enums";
import { ApiError } from "@/lib/errors";
import { logEvent, notify, notifyMany } from "@/lib/events";
import { getProvider } from "@/lib/payments";
import { computeRefund, type RefundOrderSnapshot, type RefundSelection } from "@/lib/refunds";
import { blocksNeeded, isSlotAvailable } from "@/lib/slots";
import {
  SYSTEM_ACTOR,
  TransitionError,
  transitionAppointment,
  transitionPO,
  type Actor,
} from "@/lib/transitions";

const CANCELLABLE_PO_STATUSES: string[] = [
  POStatus.PENDING_CONFIRMATION,
  POStatus.CONFIRMED,
  POStatus.REJECTED,
];

function toRefundSnapshot(
  order: Prisma.OrderGetPayload<{ include: { items: true; purchaseOrders: true } }>,
): RefundOrderSnapshot {
  return {
    totalCents: order.totalCents,
    taxRateBps: order.taxRateBps,
    refundedTotalCents: order.refundedTotalCents,
    items: order.items.map((i) => ({
      id: i.id,
      lineTotalCents: i.lineTotalCents,
      installTotalCents: i.installTotalCents,
      withInstall: i.withInstall,
      installRefunded: i.installRefunded,
      itemStatus: i.itemStatus,
      purchaseOrderId: i.purchaseOrderId,
      shipTo: i.shipTo,
    })),
    purchaseOrders: order.purchaseOrders.map((po) => ({
      id: po.id,
      shippingFeeCents: po.shippingFeeCents,
    })),
  };
}

async function loadOrderForRefund(orderId: string) {
  const order = await db.order.findUnique({
    where: { id: orderId },
    include: { items: true, purchaseOrders: true, payments: true, user: true, appointments: true },
  });
  if (!order) throw new ApiError("NOT_FOUND", "Order not found", 404);
  return order;
}

function succeededPayment(order: { payments: { status: string; id: string; provider: string; providerIntentId: string; amountCents: number }[] }) {
  const payment = order.payments.find((p) => p.status === PaymentStatus.SUCCEEDED);
  if (!payment) throw new ApiError("NO_PAYMENT", "Order has no successful payment to refund", 409);
  return payment;
}

/**
 * Execute a refund: provider call first (money moves), then one transaction
 * records the refund, flips item/appointment/PO state, and updates totals.
 * If concurrent changes shifted the computed amount, the provider amount is
 * still recorded (money DID move) with an internal mismatch event.
 */
export async function executeRefund(
  orderId: string,
  selection: RefundSelection | null,
  actor: Actor,
  reason: string,
  customAmountCents?: number,
): Promise<{ refundId: string; amountCents: number }> {
  const order = await loadOrderForRefund(orderId);
  if (!order.paidAt) throw new ApiError("NOT_PAID", "Order was never paid", 409);
  const payment = succeededPayment(order);

  let amountCents: number;
  if (customAmountCents != null) {
    const remaining = order.totalCents - order.refundedTotalCents;
    if (customAmountCents <= 0 || customAmountCents > remaining) {
      throw new ApiError("BAD_AMOUNT", `Refund must be between 1 and ${remaining} cents`, 400);
    }
    amountCents = customAmountCents;
  } else if (selection) {
    amountCents = computeRefund(toRefundSnapshot(order), selection).amountCents;
  } else {
    throw new ApiError("BAD_REQUEST", "Provide a selection or a custom amount", 400);
  }
  if (amountCents <= 0) throw new ApiError("NOTHING_TO_REFUND", "Nothing to refund", 409);

  const provider = getProvider(payment.provider);
  const providerRefund = await provider.createRefund(payment.providerIntentId, amountCents);

  return db.$transaction(
    async (tx) => {
      const fresh = await tx.order.findUniqueOrThrow({
        where: { id: orderId },
        include: { items: true, purchaseOrders: true, appointments: true },
      });

      let mismatch = false;
      let deadPoIds: string[] = [];
      if (selection && customAmountCents == null) {
        const recomputed = computeRefund(toRefundSnapshot(fresh), selection);
        if (recomputed.amountCents !== amountCents) {
          mismatch = true;
        } else {
          deadPoIds = recomputed.deadPoIds;
        }
      }

      const refund = await tx.refund.create({
        data: {
          orderId,
          paymentId: payment.id,
          amountCents,
          reason,
          providerRefundId: providerRefund.refundId,
          status: providerRefund.status,
          createdByUserId: actor.userId ?? null,
        },
      });
      const newRefundedTotal = fresh.refundedTotalCents + amountCents;
      await tx.order.update({
        where: { id: orderId },
        data: {
          refundedTotalCents: newRefundedTotal,
          ...(newRefundedTotal >= fresh.totalCents ? { status: OrderStatus.REFUNDED } : {}),
        },
      });
      await logEvent(tx, {
        orderId,
        entityType: EntityType.REFUND,
        entityId: refund.id,
        action: "created",
        actorUserId: actor.userId,
        actorRole: actor.role,
        message: `Refund of $${(amountCents / 100).toFixed(2)} issued — ${reason}`,
      });

      if (mismatch) {
        await logEvent(tx, {
          orderId,
          entityType: EntityType.REFUND,
          entityId: refund.id,
          action: "refund_mismatch",
          internal: true,
          actorRole: "SYSTEM",
          message:
            "Order changed while the refund was processing; money was refunded but item states were left untouched. Review manually.",
        });
        const admins = await tx.user.findMany({ where: { role: Role.ADMIN }, select: { id: true } });
        await notifyMany(tx, admins.map((u) => u.id), {
          type: "refund_mismatch",
          title: "Refund needs review",
          body: `A refund on order ${fresh.orderNumber} raced a concurrent change. Verify item states.`,
          href: `/admin/orders/${orderId}`,
        });
      } else if (selection) {
        // Flip item states.
        if (selection.itemIds.length > 0) {
          await tx.orderItem.updateMany({
            where: { id: { in: selection.itemIds } },
            data: { itemStatus: OrderItemStatus.REFUNDED },
          });
        }
        const installOnly = selection.installOnlyItemIds ?? [];
        if (installOnly.length > 0) {
          await tx.orderItem.updateMany({
            where: { id: { in: installOnly } },
            data: { installRefunded: true },
          });
        }

        // Cancel POs whose last live item just died (only if still cancellable).
        for (const poId of deadPoIds) {
          const po = fresh.purchaseOrders.find((p) => p.id === poId);
          if (po && CANCELLABLE_PO_STATUSES.includes(po.status)) {
            await transitionPO(tx, poId, POStatus.CANCELLED, SYSTEM_ACTOR);
          }
        }

        // Cancel appointments with no remaining live install work.
        const touchedApptIds = new Set(
          fresh.items
            .filter((i) => selection.itemIds.includes(i.id) || installOnly.includes(i.id))
            .map((i) => i.appointmentId)
            .filter((x): x is string => Boolean(x)),
        );
        for (const apptId of touchedApptIds) {
          const appt = fresh.appointments.find((a) => a.id === apptId);
          if (!appt) continue;
          if (appt.status !== AppointmentStatus.PENDING_PARTS && appt.status !== AppointmentStatus.READY) continue;
          const liveInstall = await tx.orderItem.findMany({
            where: {
              appointmentId: apptId,
              itemStatus: OrderItemStatus.PENDING,
              withInstall: true,
              installRefunded: false,
            },
          });
          if (liveInstall.length === 0) {
            await transitionAppointment(tx, apptId, AppointmentStatus.CANCELLED, SYSTEM_ACTOR, {
              skipRollup: true,
            });
          }
        }
      }

      await notify(tx, {
        userId: fresh.userId,
        type: "refund_issued",
        title: "Refund issued",
        body: `$${(amountCents / 100).toFixed(2)} was refunded on order ${fresh.orderNumber}.`,
        href: `/account/orders/${orderId}`,
      });

      return { refundId: refund.id, amountCents };
    },
    { timeout: 30_000, maxWait: 10_000 },
  );
}

/**
 * Cancel an order.
 * - Unpaid (PENDING_PAYMENT / PAYMENT_FAILED): customer or admin; no money moved.
 * - Paid: customer only while EVERY PO is still PENDING_CONFIRMATION (re-checked
 *   in-tx); admin any time pre-FULFILLED. Full remaining refund is issued.
 */
export async function cancelOrder(orderId: string, actor: Actor, reason: string): Promise<void> {
  const order = await loadOrderForRefund(orderId);
  if (actor.role === Role.CUSTOMER && order.userId !== actor.userId) {
    throw new ApiError("FORBIDDEN", "Not your order", 403);
  }

  const unpaid =
    order.status === OrderStatus.PENDING_PAYMENT || order.status === OrderStatus.PAYMENT_FAILED;

  if (unpaid) {
    await db.$transaction(async (tx) => {
      const fresh = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
      if (fresh.status !== OrderStatus.PENDING_PAYMENT && fresh.status !== OrderStatus.PAYMENT_FAILED) {
        throw new TransitionError("Order state changed — refresh and try again");
      }
      await tx.order.update({
        where: { id: orderId },
        data: { status: OrderStatus.CANCELLED, cancelledAt: new Date(), cancelReason: reason },
      });
      await tx.payment.updateMany({
        where: { orderId, status: PaymentStatus.REQUIRES_PAYMENT },
        data: { status: PaymentStatus.CANCELLED },
      });
      await logEvent(tx, {
        orderId,
        entityType: EntityType.ORDER,
        entityId: orderId,
        action: "status_change",
        fromStatus: fresh.status,
        toStatus: OrderStatus.CANCELLED,
        actorUserId: actor.userId,
        actorRole: actor.role,
        message: `Order cancelled — ${reason}`,
      });
    });
    // Cancel open intents at the provider, best-effort.
    for (const p of order.payments.filter((p) => p.status === PaymentStatus.REQUIRES_PAYMENT)) {
      await getProvider(p.provider).cancelIntent(p.providerIntentId);
    }
    return;
  }

  // Paid cancellation: phase 1 commits the cancel (eligibility re-checked
  // in-tx), phase 2 refunds. A provider failure after phase 1 leaves the order
  // cancelled-but-unrefunded, flagged loudly for admins.
  const eligibleStatuses: string[] =
    actor.role === Role.ADMIN
      ? [OrderStatus.PAID, OrderStatus.PROCESSING, OrderStatus.PARTIALLY_FULFILLED]
      : [OrderStatus.PAID, OrderStatus.PROCESSING];

  await db.$transaction(
    async (tx) => {
      const fresh = await tx.order.findUniqueOrThrow({
        where: { id: orderId },
        include: { purchaseOrders: true, appointments: true },
      });
      if (!eligibleStatuses.includes(fresh.status)) {
        throw new TransitionError("This order can no longer be cancelled");
      }
      if (actor.role === Role.CUSTOMER) {
        const allUnconfirmed = fresh.purchaseOrders.every(
          (po) => po.status === POStatus.PENDING_CONFIRMATION,
        );
        if (!allUnconfirmed) {
          throw new TransitionError(
            "A supplier already confirmed part of this order — contact support to cancel",
          );
        }
      }

      for (const po of fresh.purchaseOrders) {
        if (CANCELLABLE_PO_STATUSES.includes(po.status)) {
          await transitionPO(tx, po.id, POStatus.CANCELLED, SYSTEM_ACTOR);
        }
      }
      for (const appt of fresh.appointments) {
        if (appt.status === AppointmentStatus.PENDING_PARTS || appt.status === AppointmentStatus.READY) {
          await transitionAppointment(tx, appt.id, AppointmentStatus.CANCELLED, SYSTEM_ACTOR, {
            skipRollup: true,
          });
        }
      }
      await tx.orderItem.updateMany({
        where: { orderId, itemStatus: OrderItemStatus.PENDING },
        data: { itemStatus: OrderItemStatus.CANCELLED },
      });
      await tx.order.update({
        where: { id: orderId },
        data: { status: OrderStatus.CANCELLED, cancelledAt: new Date(), cancelReason: reason },
      });
      await logEvent(tx, {
        orderId,
        entityType: EntityType.ORDER,
        entityId: orderId,
        action: "status_change",
        fromStatus: fresh.status,
        toStatus: OrderStatus.CANCELLED,
        actorUserId: actor.userId,
        actorRole: actor.role,
        message: `Order cancelled — ${reason}`,
      });
      const suppliers = await tx.user.findMany({
        where: { supplierId: { in: fresh.purchaseOrders.map((po) => po.supplierId) }, role: Role.SUPPLIER },
        select: { id: true },
      });
      await notifyMany(tx, suppliers.map((u) => u.id), {
        type: "po_cancelled",
        title: "Purchase order cancelled",
        body: `Order ${fresh.orderNumber} was cancelled — do not fulfill.`,
        href: `/supplier/pos`,
      });
    },
    { timeout: 30_000, maxWait: 10_000 },
  );

  const remaining = order.totalCents - order.refundedTotalCents;
  if (remaining > 0) {
    const payment = succeededPayment(order);
    try {
      const provider = getProvider(payment.provider);
      const providerRefund = await provider.createRefund(payment.providerIntentId, remaining);
      await db.$transaction(async (tx) => {
        const refund = await tx.refund.create({
          data: {
            orderId,
            paymentId: payment.id,
            amountCents: remaining,
            reason: `Full refund — ${reason}`,
            providerRefundId: providerRefund.refundId,
            status: providerRefund.status,
            createdByUserId: actor.userId ?? null,
          },
        });
        await tx.order.update({
          where: { id: orderId },
          data: { refundedTotalCents: order.totalCents, status: OrderStatus.REFUNDED },
        });
        await logEvent(tx, {
          orderId,
          entityType: EntityType.REFUND,
          entityId: refund.id,
          action: "created",
          actorUserId: actor.userId,
          actorRole: actor.role,
          message: `Full refund of $${(remaining / 100).toFixed(2)} issued`,
        });
        await notify(tx, {
          userId: order.userId,
          type: "refund_issued",
          title: "Order refunded",
          body: `Order ${order.orderNumber} was cancelled and fully refunded.`,
          href: `/account/orders/${orderId}`,
        });
      });
    } catch (err) {
      await db.$transaction(async (tx) => {
        await tx.refund.create({
          data: {
            orderId,
            paymentId: payment.id,
            amountCents: remaining,
            reason: `Full refund — ${reason}`,
            status: RefundStatus.FAILED,
            createdByUserId: actor.userId ?? null,
          },
        });
        await logEvent(tx, {
          orderId,
          entityType: EntityType.REFUND,
          entityId: orderId,
          action: "refund_failed",
          internal: true,
          actorRole: "SYSTEM",
          message: `Provider refund failed after cancellation: ${err instanceof Error ? err.message : "unknown error"}`,
        });
        const admins = await tx.user.findMany({ where: { role: Role.ADMIN }, select: { id: true } });
        await notifyMany(tx, admins.map((u) => u.id), {
          type: "refund_failed",
          title: "Refund failed — action required",
          body: `Order ${order.orderNumber} is cancelled but the refund failed. Retry from the order page.`,
          href: `/admin/orders/${orderId}`,
        });
      });
      throw new ApiError("REFUND_FAILED", "Order cancelled, but the refund failed — support has been alerted", 502);
    }
  }
}

/**
 * Customer cancels ONLY the installation on an appointment (parts still ship).
 * Allowed >= 24h before the slot for customers; any time for admins.
 * Refunds the labor (untaxed). Ship-to-shop items become shop pickups (v1).
 */
export async function cancelInstallOnly(appointmentId: string, actor: Actor, reason: string): Promise<void> {
  const appt = await db.appointment.findUnique({
    where: { id: appointmentId },
    include: { order: true, items: true, installer: true },
  });
  if (!appt) throw new ApiError("NOT_FOUND", "Appointment not found", 404);
  if (actor.role === Role.CUSTOMER) {
    if (appt.order.userId !== actor.userId) throw new ApiError("FORBIDDEN", "Not your appointment", 403);
    if (appt.startAt.getTime() - Date.now() < 24 * 60 * 60_000) {
      throw new ApiError(
        "TOO_LATE",
        "Installations can be cancelled up to 24 hours before the appointment",
        409,
      );
    }
  }
  if (appt.status !== AppointmentStatus.PENDING_PARTS && appt.status !== AppointmentStatus.READY) {
    throw new ApiError("NOT_CANCELLABLE", "This appointment can no longer be cancelled", 409);
  }

  const installOnlyItemIds = appt.items
    .filter((i) => i.itemStatus === OrderItemStatus.PENDING && i.withInstall && !i.installRefunded)
    .map((i) => i.id);
  if (installOnlyItemIds.length === 0) {
    throw new ApiError("NOTHING_TO_REFUND", "No refundable installation on this appointment", 409);
  }

  await executeRefund(appt.orderId, { itemIds: [], installOnlyItemIds }, actor, reason);

  const shopShipped = appt.items.some((i) => i.shipTo === ShipTo.INSTALLER);
  if (shopShipped) {
    const admins = await db.user.findMany({ where: { role: Role.ADMIN }, select: { id: true } });
    await db.$transaction(async (tx) => {
      await notifyMany(tx, admins.map((u) => u.id), {
        type: "pickup_needed",
        title: "Install cancelled — parts shipping to shop",
        body: `Order ${appt.order.orderNumber}: install was cancelled but parts ship to ${appt.installer.name}. Customer will pick up there.`,
        href: `/admin/orders/${appt.orderId}`,
      });
    });
  }
}

/** Reschedule an appointment (customer, that shop's installer, or admin). */
export async function rescheduleAppointment(
  appointmentId: string,
  newStartAt: Date,
  actor: Actor,
): Promise<void> {
  await db.$transaction(async (tx) => {
    const appt = await tx.appointment.findUnique({
      where: { id: appointmentId },
      include: { order: true, installer: true },
    });
    if (!appt) throw new ApiError("NOT_FOUND", "Appointment not found", 404);
    if (actor.role === Role.CUSTOMER && appt.order.userId !== actor.userId) {
      throw new ApiError("FORBIDDEN", "Not your appointment", 403);
    }
    if (actor.role === Role.INSTALLER && appt.installerId !== actor.installerId) {
      throw new ApiError("FORBIDDEN", "Not your shop's appointment", 403);
    }
    if (appt.status !== AppointmentStatus.PENDING_PARTS && appt.status !== AppointmentStatus.READY) {
      throw new ApiError("NOT_RESCHEDULABLE", "This appointment can no longer be rescheduled", 409);
    }
    if (newStartAt <= new Date()) {
      throw new ApiError("BAD_TIME", "Pick a future time", 400);
    }
    const blocks = blocksNeeded(appt.totalLaborHoursTenths, appt.installer.slotMinutes);
    const ok = await isSlotAvailable(tx, appt.installer, newStartAt, blocks, appt.id);
    if (!ok) throw new ApiError("SLOT_TAKEN", "That time is not available", 409);

    await tx.appointment.update({ where: { id: appt.id }, data: { startAt: newStartAt } });
    await logEvent(tx, {
      orderId: appt.orderId,
      entityType: EntityType.APPOINTMENT,
      entityId: appt.id,
      action: "rescheduled",
      actorUserId: actor.userId,
      actorRole: actor.role,
      message: `Appointment moved from ${appt.startAt.toISOString()} to ${newStartAt.toISOString()}`,
    });
    const otherParty =
      actor.role === Role.CUSTOMER
        ? await tx.user.findMany({
            where: { installerId: appt.installerId, role: Role.INSTALLER },
            select: { id: true },
          })
        : [{ id: appt.order.userId }];
    await notifyMany(tx, otherParty.map((u) => u.id), {
      type: "appt_rescheduled",
      title: "Appointment rescheduled",
      body: `Order ${appt.order.orderNumber}: appointment at ${appt.installer.name} was moved.`,
      href: actor.role === Role.CUSTOMER ? `/installer/appointments/${appt.id}` : `/account/appointments`,
    });
  });
}

/** Lazy TTL: cancel unpaid orders older than 24h. Call from order reads. */
export async function expireStaleUnpaidOrder(order: {
  id: string;
  status: string;
  placedAt: Date;
}): Promise<boolean> {
  const stale =
    (order.status === OrderStatus.PENDING_PAYMENT || order.status === OrderStatus.PAYMENT_FAILED) &&
    Date.now() - order.placedAt.getTime() > 24 * 60 * 60_000;
  if (!stale) return false;
  try {
    await cancelOrder(order.id, SYSTEM_ACTOR, "Payment not completed within 24 hours");
    return true;
  } catch {
    return false; // concurrent payment beat the TTL — fine
  }
}
