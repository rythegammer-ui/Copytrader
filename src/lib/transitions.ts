import type { Prisma, PrismaClient } from "@prisma/client";
import {
  AppointmentStatus,
  EntityType,
  OrderItemStatus,
  OrderStatus,
  POStatus,
  Role,
  ShipTo,
  poTerminalDelivered,
} from "@/lib/enums";
import { logEvent, notify, notifyMany } from "@/lib/events";
import { formatShopTime } from "@/lib/format";
import { blocksNeeded, isSlotAvailable, nextFreeSlot } from "@/lib/slots";

export type DbClient = PrismaClient | Prisma.TransactionClient;

/** Who is performing a transition. role "SYSTEM" = webhook/rollup/automation. */
export interface Actor {
  userId?: string | null;
  role: string; // Role value or "SYSTEM"
  supplierId?: string | null; // verified for SUPPLIER actors
  installerId?: string | null; // verified for INSTALLER actors
}

export const SYSTEM_ACTOR: Actor = { role: "SYSTEM", userId: null };

export class TransitionError extends Error {
  status: number;
  constructor(message: string, status = 409) {
    super(message);
    this.status = status;
  }
}

const CARRIER_TRACKING: Record<string, string> = {
  UPS: "https://www.ups.com/track?tracknum=",
  FEDEX: "https://www.fedex.com/fedextrack/?trknbr=",
  USPS: "https://tools.usps.com/go/TrackConfirmAction?tLabels=",
  DHL: "https://www.dhl.com/us-en/home/tracking.html?tracking-id=",
};

export function carrierTrackingUrl(carrier: string, trackingNumber: string): string | null {
  const base = CARRIER_TRACKING[carrier.toUpperCase().replace(/[^A-Z]/g, "")];
  return base ? `${base}${encodeURIComponent(trackingNumber)}` : null;
}

// ---------------------------------------------------------------------------
// Legality tables: from -> to -> allowed actor roles.
// ---------------------------------------------------------------------------

const PO_TABLE: Record<string, Record<string, string[]>> = {
  [POStatus.PENDING_CONFIRMATION]: {
    [POStatus.CONFIRMED]: [Role.SUPPLIER, Role.ADMIN],
    [POStatus.REJECTED]: [Role.SUPPLIER, Role.ADMIN],
    [POStatus.CANCELLED]: [Role.ADMIN, "SYSTEM"],
  },
  [POStatus.CONFIRMED]: {
    [POStatus.SHIPPED]: [Role.SUPPLIER, Role.ADMIN],
    [POStatus.CANCELLED]: [Role.ADMIN, "SYSTEM"],
  },
  [POStatus.REJECTED]: {
    [POStatus.CANCELLED]: [Role.ADMIN, "SYSTEM"],
  },
  [POStatus.SHIPPED]: {
    [POStatus.DELIVERED]: [Role.SUPPLIER, Role.ADMIN, "SYSTEM"],
    [POStatus.RECEIVED]: [Role.INSTALLER, Role.ADMIN], // shortcut; implies DELIVERED
  },
  [POStatus.DELIVERED]: {
    [POStatus.RECEIVED]: [Role.INSTALLER, Role.ADMIN],
  },
};

const APPT_TABLE: Record<string, Record<string, string[]>> = {
  [AppointmentStatus.PENDING_PARTS]: {
    [AppointmentStatus.READY]: ["SYSTEM", Role.ADMIN],
    [AppointmentStatus.CANCELLED]: [Role.CUSTOMER, Role.ADMIN, "SYSTEM"],
  },
  [AppointmentStatus.READY]: {
    [AppointmentStatus.PENDING_PARTS]: ["SYSTEM", Role.ADMIN],
    [AppointmentStatus.COMPLETED]: [Role.INSTALLER, Role.ADMIN],
    [AppointmentStatus.NO_SHOW]: [Role.INSTALLER, Role.ADMIN],
    [AppointmentStatus.CANCELLED]: [Role.CUSTOMER, Role.ADMIN, "SYSTEM"],
  },
  [AppointmentStatus.NO_SHOW]: {
    [AppointmentStatus.READY]: [Role.ADMIN], // rebook
    [AppointmentStatus.CANCELLED]: [Role.ADMIN, "SYSTEM"],
  },
};

function assertAllowed(
  table: Record<string, Record<string, string[]>>,
  from: string,
  to: string,
  actor: Actor,
  override: boolean,
): void {
  if (override && actor.role === Role.ADMIN) return;
  const allowed = table[from]?.[to];
  if (!allowed) throw new TransitionError(`Illegal transition ${from} -> ${to}`);
  if (!allowed.includes(actor.role)) {
    throw new TransitionError(`${actor.role} may not perform ${from} -> ${to}`, 403);
  }
}

// ---------------------------------------------------------------------------
// PURCHASE ORDER transitions
// ---------------------------------------------------------------------------

export interface POTransitionOpts {
  carrier?: string;
  trackingNumber?: string;
  rejectReason?: string;
  override?: boolean; // ADMIN-only escape hatch; logs internal admin_override
}

export async function transitionPO(
  tx: Prisma.TransactionClient,
  poId: string,
  to: string,
  actor: Actor,
  opts: POTransitionOpts = {},
): Promise<void> {
  const po = await tx.purchaseOrder.findUnique({
    where: { id: poId },
    include: { supplier: true, order: true, items: true },
  });
  if (!po) throw new TransitionError("Purchase order not found", 404);

  if (actor.role === Role.SUPPLIER && actor.supplierId !== po.supplierId) {
    throw new TransitionError("Not your purchase order", 403);
  }
  if (actor.role === Role.INSTALLER && actor.installerId !== po.installerId) {
    throw new TransitionError("Not destined for your shop", 403);
  }
  if (to === POStatus.RECEIVED && po.shipTo !== ShipTo.INSTALLER) {
    throw new TransitionError("Only ship-to-shop POs can be received by an installer");
  }
  // Even with admin override: a cancelled PO whose items were all refunded or
  // cancelled must stay dead — reviving it would count refunded items back
  // into the fulfillment rollup.
  if (
    po.status === POStatus.CANCELLED &&
    to !== POStatus.CANCELLED &&
    !po.items.some((i) => i.itemStatus === OrderItemStatus.PENDING)
  ) {
    throw new TransitionError(
      "Cannot revive a cancelled purchase order whose items were refunded or cancelled",
    );
  }

  assertAllowed(PO_TABLE, po.status, to, actor, opts.override ?? false);

  const now = new Date();
  const data: Prisma.PurchaseOrderUpdateInput = { status: to };
  let message = "";

  switch (to) {
    case POStatus.CONFIRMED:
      data.confirmedAt = now;
      message = `Supplier ${po.supplier.name} confirmed ${po.poNumber}`;
      break;
    case POStatus.REJECTED:
      if (!opts.rejectReason) throw new TransitionError("Rejection requires a reason", 400);
      data.rejectReason = opts.rejectReason;
      message = `Supplier ${po.supplier.name} rejected ${po.poNumber}: ${opts.rejectReason}`;
      break;
    case POStatus.SHIPPED: {
      if (!opts.carrier || !opts.trackingNumber) {
        throw new TransitionError("Shipping requires carrier and tracking number", 400);
      }
      data.shippedAt = now;
      data.carrier = opts.carrier;
      data.trackingNumber = opts.trackingNumber;
      data.trackingUrl = carrierTrackingUrl(opts.carrier, opts.trackingNumber);
      message = `${po.poNumber} shipped via ${opts.carrier} (${opts.trackingNumber})`;
      break;
    }
    case POStatus.DELIVERED:
      data.deliveredAt = now;
      message =
        po.shipTo === ShipTo.INSTALLER
          ? `${po.poNumber} delivered to ${po.destName}`
          : `${po.poNumber} delivered`;
      break;
    case POStatus.RECEIVED:
      data.receivedAt = now;
      if (!po.deliveredAt) data.deliveredAt = now; // SHIPPED -> RECEIVED shortcut
      message = `${po.destName} received parts from ${po.poNumber}`;
      break;
    case POStatus.CANCELLED:
      data.cancelledAt = now;
      message = `${po.poNumber} cancelled`;
      break;
    default:
      throw new TransitionError(`Unknown PO status ${to}`, 400);
  }

  await tx.purchaseOrder.update({ where: { id: po.id }, data });
  await logEvent(tx, {
    orderId: po.orderId,
    entityType: EntityType.PURCHASE_ORDER,
    entityId: po.id,
    action: opts.override ? "admin_override" : "status_change",
    fromStatus: po.status,
    toStatus: to,
    actorUserId: actor.userId,
    actorRole: actor.role,
    internal: Boolean(opts.override) || to === POStatus.REJECTED,
    message,
  });

  // Notifications.
  const customerId = po.order.userId;
  if (to === POStatus.CONFIRMED) {
    await notify(tx, {
      userId: customerId,
      type: "po_confirmed",
      title: "Order confirmed by supplier",
      body: `${po.supplier.name} confirmed your parts for order ${po.order.orderNumber}.`,
      href: `/account/orders/${po.orderId}`,
    });
  } else if (to === POStatus.SHIPPED) {
    await notify(tx, {
      userId: customerId,
      type: "po_shipped",
      title: "Parts shipped",
      body: `${po.poNumber} shipped via ${opts.carrier}. Tracking: ${opts.trackingNumber}`,
      href: `/account/orders/${po.orderId}`,
    });
    if (po.shipTo === ShipTo.INSTALLER && po.installerId) {
      const installerUsers = await tx.user.findMany({
        where: { installerId: po.installerId, role: Role.INSTALLER },
        select: { id: true },
      });
      await notifyMany(tx, installerUsers.map((u) => u.id), {
        type: "po_inbound",
        title: "Parts inbound to your shop",
        body: `${po.poNumber} for order ${po.order.orderNumber} shipped via ${opts.carrier}.`,
        href: `/installer`,
      });
    }
  } else if (to === POStatus.DELIVERED && po.shipTo === ShipTo.INSTALLER && po.installerId) {
    const installerUsers = await tx.user.findMany({
      where: { installerId: po.installerId, role: Role.INSTALLER },
      select: { id: true },
    });
    await notifyMany(tx, installerUsers.map((u) => u.id), {
      type: "po_delivered",
      title: "Parts delivered — confirm receipt",
      body: `${po.poNumber} was delivered to your shop. Mark it received to unlock the appointment.`,
      href: `/installer`,
    });
  } else if (to === POStatus.REJECTED) {
    const admins = await tx.user.findMany({ where: { role: Role.ADMIN }, select: { id: true } });
    await notifyMany(tx, admins.map((u) => u.id), {
      type: "po_rejected",
      title: `PO rejected: ${po.poNumber}`,
      body: `${po.supplier.name} rejected ${po.poNumber} (${opts.rejectReason}). Resolve with a refund.`,
      href: `/admin/orders/${po.orderId}`,
    });
  }

  await recomputeReadinessForOrder(tx, po.orderId);
  await rollUpOrderStatus(tx, po.orderId);
}

// ---------------------------------------------------------------------------
// APPOINTMENT transitions
// ---------------------------------------------------------------------------

export interface ApptTransitionOpts {
  notes?: string;
  newStartAt?: Date; // for NO_SHOW -> READY rebook
  override?: boolean;
  skipRollup?: boolean;
}

export async function transitionAppointment(
  tx: Prisma.TransactionClient,
  appointmentId: string,
  to: string,
  actor: Actor,
  opts: ApptTransitionOpts = {},
): Promise<void> {
  const appt = await tx.appointment.findUnique({
    where: { id: appointmentId },
    include: { order: true, installer: true },
  });
  if (!appt) throw new TransitionError("Appointment not found", 404);

  if (actor.role === Role.INSTALLER && actor.installerId !== appt.installerId) {
    throw new TransitionError("Not your shop's appointment", 403);
  }
  if (actor.role === Role.CUSTOMER && actor.userId !== appt.order.userId) {
    throw new TransitionError("Not your appointment", 403);
  }

  assertAllowed(APPT_TABLE, appt.status, to, actor, opts.override ?? false);

  if (
    to === AppointmentStatus.NO_SHOW &&
    new Date() < new Date(appt.startAt.getTime() + appt.durationMinutes * 60_000)
  ) {
    throw new TransitionError("Cannot mark no-show before the appointment window has passed");
  }

  const now = new Date();
  const data: Prisma.AppointmentUpdateInput = { status: to };
  let message = "";
  switch (to) {
    case AppointmentStatus.READY:
      if (appt.status === AppointmentStatus.NO_SHOW) {
        if (!opts.newStartAt) throw new TransitionError("Rebooking requires a new time", 400);
        const ok = await isSlotAvailable(
          tx,
          appt.installer,
          opts.newStartAt,
          blocksNeeded(appt.totalLaborHoursTenths, appt.installer.slotMinutes),
          appt.id,
        );
        if (!ok) throw new TransitionError("That slot is no longer available");
        data.startAt = opts.newStartAt;
        message = `Appointment rebooked for ${formatShopTime(opts.newStartAt, appt.installer.tzOffsetMinutes)}`;
      } else {
        data.partsReadyAt = now;
        message = `All parts ready — appointment at ${appt.installer.name} confirmed`;
      }
      break;
    case AppointmentStatus.PENDING_PARTS:
      message = "Appointment back to waiting for parts";
      break;
    case AppointmentStatus.COMPLETED:
      data.completedAt = now;
      if (opts.notes) data.notes = opts.notes;
      message = `Installation completed at ${appt.installer.name}`;
      break;
    case AppointmentStatus.NO_SHOW:
      message = `Customer did not show for the ${appt.installer.name} appointment`;
      break;
    case AppointmentStatus.CANCELLED:
      data.cancelledAt = now;
      message = "Installation appointment cancelled";
      break;
    default:
      throw new TransitionError(`Unknown appointment status ${to}`, 400);
  }

  await tx.appointment.update({ where: { id: appt.id }, data });
  await logEvent(tx, {
    orderId: appt.orderId,
    entityType: EntityType.APPOINTMENT,
    entityId: appt.id,
    action: opts.override ? "admin_override" : "status_change",
    fromStatus: appt.status,
    toStatus: to,
    actorUserId: actor.userId,
    actorRole: actor.role,
    internal: Boolean(opts.override),
    message,
  });

  if (to === AppointmentStatus.COMPLETED) {
    await notify(tx, {
      userId: appt.order.userId,
      type: "install_done",
      title: "Installation complete",
      body: `Your installation at ${appt.installer.name} is done. Thanks for choosing PartsPro!`,
      href: `/account/orders/${appt.orderId}`,
    });
  } else if (to === AppointmentStatus.READY) {
    await notify(tx, {
      userId: appt.order.userId,
      type: "appt_ready",
      title: "Appointment confirmed",
      body: `Parts have arrived — your appointment at ${appt.installer.name} is confirmed.`,
      href: `/account/appointments`,
    });
  }

  if (!opts.skipRollup) await rollUpOrderStatus(tx, appt.orderId);
}

// ---------------------------------------------------------------------------
// Readiness + rollup (the derived-state engine)
// ---------------------------------------------------------------------------

/**
 * Re-evaluate parts-readiness for every live appointment on an order.
 * Ready when every non-cancelled item on the appointment satisfies:
 *   ship INSTALLER -> its PO is RECEIVED;  ship HOME -> its PO is DELIVERED+.
 * If readiness lands after startAt passed, auto-rebook the next free slot
 * (>= tomorrow) and notify both sides.
 */
export async function recomputeReadinessForOrder(
  tx: Prisma.TransactionClient,
  orderId: string,
): Promise<void> {
  const appts = await tx.appointment.findMany({
    where: {
      orderId,
      status: { in: [AppointmentStatus.PENDING_PARTS, AppointmentStatus.READY] },
    },
    include: {
      installer: true,
      order: true,
      items: { include: { purchaseOrder: true } },
    },
  });

  for (const appt of appts) {
    const liveItems = appt.items.filter((i) => i.itemStatus === OrderItemStatus.PENDING);
    if (liveItems.length === 0) continue; // cancellation flows handle the appointment itself
    const ready = liveItems.every((i) => {
      const po = i.purchaseOrder;
      if (!po || po.status === POStatus.CANCELLED) return false;
      return poTerminalDelivered(po.status, i.shipTo);
    });

    if (ready && appt.status === AppointmentStatus.PENDING_PARTS) {
      const now = new Date();
      if (appt.startAt <= now) {
        // Slot already passed — auto-rebook the next free feasible slot.
        const tomorrow = new Date(now.getTime() + 24 * 60 * 60_000);
        const blocks = blocksNeeded(appt.totalLaborHoursTenths, appt.installer.slotMinutes);
        const slot = await nextFreeSlot(tx, appt.installer, tomorrow, blocks);
        if (slot) {
          await tx.appointment.update({
            where: { id: appt.id },
            data: { startAt: slot, status: AppointmentStatus.READY, partsReadyAt: now },
          });
          await logEvent(tx, {
            orderId,
            entityType: EntityType.APPOINTMENT,
            entityId: appt.id,
            action: "auto_rescheduled",
            fromStatus: appt.status,
            toStatus: AppointmentStatus.READY,
            actorRole: "SYSTEM",
            message: `Parts arrived after the original time — appointment moved to ${formatShopTime(slot, appt.installer.tzOffsetMinutes)}`,
          });
          await notify(tx, {
            userId: appt.order.userId,
            type: "appt_rescheduled",
            title: "Appointment rescheduled",
            body: `Your parts arrived after the original slot. New appointment time at ${appt.installer.name}.`,
            href: `/account/appointments`,
          });
          const installerUsers = await tx.user.findMany({
            where: { installerId: appt.installerId, role: Role.INSTALLER },
            select: { id: true },
          });
          await notifyMany(tx, installerUsers.map((u) => u.id), {
            type: "appt_rescheduled",
            title: "Appointment auto-rescheduled",
            body: `Order ${appt.order.orderNumber}: parts arrived late; appointment moved.`,
            href: `/installer/appointments/${appt.id}`,
          });
        }
        // No free slot found: stays PENDING_PARTS; admin attention queue flags it.
      } else {
        await transitionAppointment(tx, appt.id, AppointmentStatus.READY, SYSTEM_ACTOR, {
          skipRollup: true,
        });
      }
    } else if (!ready && appt.status === AppointmentStatus.READY) {
      await transitionAppointment(tx, appt.id, AppointmentStatus.PENDING_PARTS, SYSTEM_ACTOR, {
        skipRollup: true,
      });
    }
  }
}

const ORDER_PROGRESSION = [
  OrderStatus.PROCESSING,
  OrderStatus.PARTIALLY_FULFILLED,
  OrderStatus.FULFILLED,
  OrderStatus.COMPLETED,
] as const;

/**
 * Derive order status from PO + appointment state. Never moves backwards,
 * never touches CANCELLED/REFUNDED/pre-payment states.
 */
export async function rollUpOrderStatus(
  tx: Prisma.TransactionClient,
  orderId: string,
): Promise<void> {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    include: { purchaseOrders: true, appointments: true },
  });
  if (!order) return;
  const currentIdx = ORDER_PROGRESSION.indexOf(order.status as (typeof ORDER_PROGRESSION)[number]);
  if (currentIdx < 0) return; // not in a rollup-managed state

  const livePOs = order.purchaseOrders.filter((po) => po.status !== POStatus.CANCELLED);
  let target: (typeof ORDER_PROGRESSION)[number] = OrderStatus.PROCESSING;
  if (livePOs.length > 0) {
    const delivered = livePOs.filter((po) => poTerminalDelivered(po.status, po.shipTo));
    if (delivered.length === livePOs.length) target = OrderStatus.FULFILLED;
    else if (delivered.length > 0) target = OrderStatus.PARTIALLY_FULFILLED;
  }
  if (target === OrderStatus.FULFILLED) {
    const blocking = order.appointments.filter(
      (a) => a.status !== AppointmentStatus.COMPLETED && a.status !== AppointmentStatus.CANCELLED,
    );
    if (blocking.length === 0) target = OrderStatus.COMPLETED;
  }

  const targetIdx = ORDER_PROGRESSION.indexOf(target);
  if (targetIdx <= currentIdx) return; // never move backwards

  await tx.order.update({
    where: { id: orderId },
    data: {
      status: target,
      ...(target === OrderStatus.COMPLETED ? { completedAt: new Date() } : {}),
    },
  });
  await logEvent(tx, {
    orderId,
    entityType: EntityType.ORDER,
    entityId: orderId,
    action: "status_change",
    fromStatus: order.status,
    toStatus: target,
    actorRole: "SYSTEM",
    message:
      target === OrderStatus.COMPLETED
        ? `Order ${order.orderNumber} completed`
        : target === OrderStatus.FULFILLED
          ? `All parts for ${order.orderNumber} have been delivered`
          : `Order ${order.orderNumber}: some parts delivered`,
  });
  if (target === OrderStatus.COMPLETED) {
    await notify(tx, {
      userId: order.userId,
      type: "order_completed",
      title: "Order complete",
      body: `Order ${order.orderNumber} is complete. Thanks for shopping with PartsPro!`,
      href: `/account/orders/${orderId}`,
    });
  }
}
