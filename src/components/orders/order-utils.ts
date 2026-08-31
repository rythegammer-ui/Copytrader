/**
 * Pure display helpers shared by the customer order/appointment pages, their
 * client components, and the /api/orders + /api/appointments routes.
 * Imports ONLY client-safe modules (enums) — safe on server and client.
 */
import {
  AppointmentStatus,
  OrderItemStatus,
  OrderStatus,
  PaymentStatus,
  POStatus,
  poTerminalDelivered,
} from "@/lib/enums";

/** Badge color classes (paired with the .badge class from globals.css). */
export function statusBadgeClass(status: string): string {
  switch (status) {
    case OrderStatus.PENDING_PAYMENT:
    case POStatus.PENDING_CONFIRMATION:
    case AppointmentStatus.PENDING_PARTS:
    case OrderItemStatus.PENDING:
    case PaymentStatus.REQUIRES_PAYMENT:
      return "bg-amber-100 text-amber-800";
    case OrderStatus.PAYMENT_FAILED:
    case POStatus.REJECTED:
    case PaymentStatus.FAILED:
    case AppointmentStatus.NO_SHOW:
      return "bg-red-100 text-red-800";
    case OrderStatus.PAID:
    case OrderStatus.PROCESSING:
    case POStatus.CONFIRMED:
      return "bg-blue-100 text-blue-800";
    case OrderStatus.PARTIALLY_FULFILLED:
    case POStatus.SHIPPED:
      return "bg-indigo-100 text-indigo-800";
    case OrderStatus.FULFILLED:
    case OrderStatus.COMPLETED:
    case POStatus.DELIVERED:
    case POStatus.RECEIVED:
    case AppointmentStatus.READY:
    case PaymentStatus.SUCCEEDED:
      return "bg-green-100 text-green-800";
    case OrderStatus.REFUNDED:
      return "bg-purple-100 text-purple-800";
    default:
      // CANCELLED (all machines) + anything unknown.
      return "bg-slate-100 text-slate-800";
  }
}

/**
 * An OrderItem's fulfillment display derives from its PurchaseOrder's status;
 * itemStatus CANCELLED / REFUNDED overrides it. Returns a status string —
 * render with statusLabel() + statusBadgeClass().
 */
export function itemDisplayStatus(itemStatus: string, poStatus: string | null | undefined): string {
  if (itemStatus !== OrderItemStatus.PENDING) return itemStatus;
  return poStatus ?? itemStatus;
}

export interface ReadinessItem {
  itemStatus: string;
  shipTo: string;
  poStatus: string | null | undefined;
}

/** One-line readiness summary for an appointment card. */
export function readinessSummary(apptStatus: string, items: ReadinessItem[]): string {
  switch (apptStatus) {
    case AppointmentStatus.READY:
      return "All parts arrived — you're confirmed";
    case AppointmentStatus.COMPLETED:
      return "Installation completed";
    case AppointmentStatus.CANCELLED:
      return "Installation cancelled";
    case AppointmentStatus.NO_SHOW:
      return "Missed appointment — contact support to rebook";
    default: {
      const live = items.filter((i) => i.itemStatus === OrderItemStatus.PENDING);
      const arrived = live.filter(
        (i) => i.poStatus != null && poTerminalDelivered(i.poStatus, i.shipTo),
      ).length;
      return `Waiting for parts — ${arrived} of ${live.length} arrived`;
    }
  }
}

/** "~2.0 h" from labor tenths. */
export function laborLabel(laborTenths: number): string {
  return `~${(laborTenths / 10).toFixed(1)} h`;
}

/**
 * Fingerprint of everything the order-detail page renders from live state.
 * The server page and the client poller compute it identically (same field
 * ordering); a mismatch means the page is stale → router.refresh().
 */
export interface OrderStateKeyInput {
  status: string;
  refundedTotalCents: number;
  purchaseOrders: { id: string; status: string }[];
  appointments: { id: string; status: string; startAt: string }[];
  payments: { status: string }[];
  timelineCount: number;
}

export function computeOrderStateKey(o: OrderStateKeyInput): string {
  return [
    o.status,
    String(o.refundedTotalCents),
    o.purchaseOrders.map((p) => `${p.id}:${p.status}`).join(","),
    o.appointments.map((a) => `${a.id}:${a.status}:${a.startAt}`).join(","),
    o.payments.map((p) => p.status).join(","),
    String(o.timelineCount),
  ].join("|");
}
