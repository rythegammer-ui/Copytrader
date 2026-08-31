/**
 * SERVER-ONLY query helpers shared by the admin API routes and admin pages
 * (both read the db directly). Never import from a "use client" component.
 */
import { db } from "@/lib/db";
import {
  AppointmentStatus,
  OrderItemStatus,
  OrderStatus,
  POStatus,
  RefundStatus,
  statusLabel,
} from "@/lib/enums";
import { formatDate } from "@/lib/format";

const DAY_MS = 24 * 60 * 60_000;

// ---------------------------------------------------------------------------
// KPIs
// ---------------------------------------------------------------------------

export interface KpiByDay {
  date: string; // "YYYY-MM-DD" (UTC calendar day of paidAt)
  revenueCents: number;
  orders: number;
}

export interface AdminKpis {
  days: number;
  revenueCents: number;
  ordersCount: number;
  aovCents: number;
  marginCents: number;
  installAttachRate: number; // 0..1
  refundsCents: number;
  openPOs: number;
  upcomingAppointments: number;
  byDay: KpiByDay[];
}

function utcDayStart(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** KPIs over paid orders whose paidAt falls in the last `days` calendar days. */
export async function computeKpis(days: number): Promise<AdminKpis> {
  const now = new Date();
  const windowStart = utcDayStart(new Date(now.getTime() - (days - 1) * DAY_MS));
  const in7d = new Date(now.getTime() + 7 * DAY_MS);

  const [orders, openPOs, upcomingAppointments] = await Promise.all([
    db.order.findMany({
      where: { paidAt: { gte: windowStart } },
      select: {
        paidAt: true,
        totalCents: true,
        refundedTotalCents: true,
        items: {
          select: {
            itemStatus: true,
            lineTotalCents: true,
            supplierCostCentsSnapshot: true,
            qty: true,
            withInstall: true,
          },
        },
      },
    }),
    db.purchaseOrder.count({
      where: {
        status: { in: [POStatus.PENDING_CONFIRMATION, POStatus.CONFIRMED, POStatus.SHIPPED] },
      },
    }),
    db.appointment.count({
      where: {
        startAt: { gte: now, lte: in7d },
        status: { in: [AppointmentStatus.PENDING_PARTS, AppointmentStatus.READY] },
      },
    }),
  ]);

  let revenueCents = 0;
  let marginCents = 0;
  let refundsCents = 0;
  let ordersWithInstall = 0;

  const dayMap = new Map<string, { revenueCents: number; orders: number }>();
  for (let i = 0; i < days; i++) {
    dayMap.set(dayKey(new Date(windowStart.getTime() + i * DAY_MS)), {
      revenueCents: 0,
      orders: 0,
    });
  }

  for (const o of orders) {
    const net = o.totalCents - o.refundedTotalCents;
    revenueCents += net;
    refundsCents += o.refundedTotalCents;
    if (o.items.some((i) => i.withInstall)) ordersWithInstall += 1;
    for (const i of o.items) {
      if (i.itemStatus === OrderItemStatus.PENDING) {
        marginCents += i.lineTotalCents - i.supplierCostCentsSnapshot * i.qty;
      }
    }
    if (o.paidAt) {
      const key = dayKey(o.paidAt);
      const bucket = dayMap.get(key);
      if (bucket) {
        bucket.revenueCents += net;
        bucket.orders += 1;
      }
    }
  }

  const ordersCount = orders.length;
  return {
    days,
    revenueCents,
    ordersCount,
    aovCents: ordersCount > 0 ? Math.round(revenueCents / ordersCount) : 0,
    marginCents,
    installAttachRate: ordersCount > 0 ? ordersWithInstall / ordersCount : 0,
    refundsCents,
    openPOs,
    upcomingAppointments,
    byDay: Array.from(dayMap.entries()).map(([date, v]) => ({ date, ...v })),
  };
}

// ---------------------------------------------------------------------------
// Attention queue
// ---------------------------------------------------------------------------

export type AttentionSeverity = "red" | "amber";

export interface AttentionEntry {
  kind:
    | "LATE_PO"
    | "REJECTED_PO"
    | "STUCK_SHIPPED"
    | "PAID_NO_POS"
    | "NEEDS_RESCHEDULE"
    | "NO_SHOW"
    | "PAST_PENDING"
    | "REFUND_FAILED"
    | "CANCELLED_UNREFUNDED";
  severity: AttentionSeverity;
  title: string;
  detail: string;
  href: string;
  at: string; // ISO timestamp the entry is anchored to
}

function daysAgoLabel(from: Date, now: Date): string {
  const d = Math.floor((now.getTime() - from.getTime()) / DAY_MS);
  if (d <= 0) return "today";
  return d === 1 ? "1 day ago" : `${d} days ago`;
}

/** The unified exception queue: everything an admin must act on, red first. */
export async function computeAttention(): Promise<AttentionEntry[]> {
  const now = new Date();
  const in24h = new Date(now.getTime() + DAY_MS);
  const sevenDaysAgo = new Date(now.getTime() - 7 * DAY_MS);

  const poInclude = {
    supplier: { select: { name: true } },
    order: { select: { id: true, orderNumber: true } },
  } as const;
  const apptInclude = {
    installer: { select: { name: true, tzOffsetMinutes: true } },
    order: { select: { id: true, orderNumber: true } },
  } as const;

  const [latePos, rejectedPos, stuckShipped, paidNoPos, lateAppts, noShows, failedRefunds, cancelledPaid] =
    await Promise.all([
      db.purchaseOrder.findMany({
        where: {
          dueAt: { lt: now },
          status: { in: [POStatus.PENDING_CONFIRMATION, POStatus.CONFIRMED] },
        },
        include: poInclude,
      }),
      db.purchaseOrder.findMany({ where: { status: POStatus.REJECTED }, include: poInclude }),
      db.purchaseOrder.findMany({
        where: { status: POStatus.SHIPPED, shippedAt: { lt: sevenDaysAgo } },
        include: poInclude,
      }),
      db.order.findMany({
        where: {
          paidAt: { not: null },
          status: {
            in: [
              OrderStatus.PROCESSING,
              OrderStatus.PARTIALLY_FULFILLED,
              OrderStatus.FULFILLED,
              OrderStatus.COMPLETED,
            ],
          },
          purchaseOrders: { none: {} },
        },
        select: { id: true, orderNumber: true, paidAt: true },
      }),
      db.appointment.findMany({
        where: { status: AppointmentStatus.PENDING_PARTS, startAt: { lt: in24h } },
        include: apptInclude,
      }),
      db.appointment.findMany({ where: { status: AppointmentStatus.NO_SHOW }, include: apptInclude }),
      db.refund.findMany({
        where: { status: RefundStatus.FAILED },
        include: { order: { select: { id: true, orderNumber: true } } },
      }),
      db.order.findMany({
        where: { status: OrderStatus.CANCELLED, paidAt: { not: null } },
        select: {
          id: true,
          orderNumber: true,
          totalCents: true,
          refundedTotalCents: true,
          cancelledAt: true,
          placedAt: true,
        },
      }),
    ]);

  const entries: AttentionEntry[] = [];

  for (const po of latePos) {
    entries.push({
      kind: "LATE_PO",
      severity: "red",
      title: `${po.poNumber} is past due`,
      detail: `${po.supplier.name} · ${statusLabel(po.status)} · was due ${
        po.dueAt ? formatDate(po.dueAt) : "—"
      } · order ${po.order.orderNumber}`,
      href: `/admin/orders/${po.order.id}`,
      at: (po.dueAt ?? po.createdAt).toISOString(),
    });
  }
  for (const po of rejectedPos) {
    entries.push({
      kind: "REJECTED_PO",
      severity: "red",
      title: `${po.poNumber} rejected by supplier`,
      detail: `${po.supplier.name}: ${po.rejectReason ?? "no reason given"} — resolve with a refund on order ${po.order.orderNumber}`,
      href: `/admin/orders/${po.order.id}`,
      at: po.createdAt.toISOString(),
    });
  }
  for (const po of stuckShipped) {
    entries.push({
      kind: "STUCK_SHIPPED",
      severity: "amber",
      title: `${po.poNumber} shipped but not delivered`,
      detail: `${po.supplier.name} · shipped ${
        po.shippedAt ? daysAgoLabel(po.shippedAt, now) : "over 7 days ago"
      }${po.trackingNumber ? ` · ${po.trackingNumber}` : ""} · order ${po.order.orderNumber}`,
      href: `/admin/orders/${po.order.id}`,
      at: (po.shippedAt ?? po.createdAt).toISOString(),
    });
  }
  for (const o of paidNoPos) {
    entries.push({
      kind: "PAID_NO_POS",
      severity: "red",
      title: `${o.orderNumber} is paid but has no purchase orders`,
      detail: "Consistency alarm — PO fan-out never happened for this order.",
      href: `/admin/orders/${o.id}`,
      at: (o.paidAt ?? now).toISOString(),
    });
  }
  for (const a of lateAppts) {
    const past = a.startAt.getTime() <= now.getTime();
    entries.push(
      past
        ? {
            kind: "PAST_PENDING",
            severity: "red",
            title: `Appointment slot passed, parts never arrived`,
            detail: `${a.installer.name} · order ${a.order.orderNumber} · slot was ${daysAgoLabel(a.startAt, now)}`,
            href: `/admin/orders/${a.order.id}`,
            at: a.startAt.toISOString(),
          }
        : {
            kind: "NEEDS_RESCHEDULE",
            severity: "amber",
            title: `Appointment in under 24h, parts not ready`,
            detail: `${a.installer.name} · order ${a.order.orderNumber} — parts won't make it; reschedule.`,
            href: `/admin/orders/${a.order.id}`,
            at: a.startAt.toISOString(),
          },
    );
  }
  for (const a of noShows) {
    entries.push({
      kind: "NO_SHOW",
      severity: "amber",
      title: `No-show at ${a.installer.name}`,
      detail: `Order ${a.order.orderNumber} · ${a.customerName} missed the appointment — rebook or refund labor.`,
      href: `/admin/orders/${a.order.id}`,
      at: a.startAt.toISOString(),
    });
  }
  for (const r of failedRefunds) {
    entries.push({
      kind: "REFUND_FAILED",
      severity: "red",
      title: `Refund failed on ${r.order.orderNumber}`,
      detail: `$${(r.amountCents / 100).toFixed(2)} refund failed at the provider — retry from the order page.`,
      href: `/admin/orders/${r.order.id}`,
      at: r.createdAt.toISOString(),
    });
  }
  for (const o of cancelledPaid) {
    if (o.refundedTotalCents >= o.totalCents) continue;
    entries.push({
      kind: "CANCELLED_UNREFUNDED",
      severity: "red",
      title: `${o.orderNumber} cancelled but not fully refunded`,
      detail: `$${((o.totalCents - o.refundedTotalCents) / 100).toFixed(2)} still owed to the customer.`,
      href: `/admin/orders/${o.id}`,
      at: (o.cancelledAt ?? o.placedAt).toISOString(),
    });
  }

  entries.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === "red" ? -1 : 1;
    return a.at.localeCompare(b.at);
  });
  return entries;
}
