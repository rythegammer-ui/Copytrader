import { OrderItemStatus, ShipTo } from "@/lib/enums";
import { mulBps } from "@/lib/pricing";

/**
 * Pure refund math. Whole-line refunds only (no partial quantities).
 *
 * Tax uses recompute-and-diff: taxBack = tax(remainingBaseBefore) -
 * tax(remainingBaseAfter). Successive refunds telescope, so refunding an order
 * item-by-item sums exactly to the order's original taxCents. A final-balance
 * clamp absorbs any residual drift and guards Σrefunds ≤ payment.
 */

export interface RefundOrderSnapshot {
  totalCents: number;
  taxRateBps: number;
  refundedTotalCents: number;
  items: RefundItemSnapshot[];
  purchaseOrders: RefundPOSnapshot[];
}

export interface RefundItemSnapshot {
  id: string;
  lineTotalCents: number;
  installTotalCents: number;
  withInstall: boolean;
  installRefunded: boolean;
  itemStatus: string; // OrderItemStatus
  purchaseOrderId: string | null;
  shipTo: string;
}

export interface RefundPOSnapshot {
  id: string;
  shippingFeeCents: number;
}

export interface RefundSelection {
  /** OrderItem ids to refund in full (parts + install if any). */
  itemIds: string[];
  /** OrderItem ids whose INSTALL portion only is refunded (item still ships). */
  installOnlyItemIds?: string[];
}

export interface RefundComputation {
  partsCents: number;
  installCents: number;
  shippingCents: number;
  taxCents: number;
  amountCents: number; // clamped final amount
  isFinal: boolean; // this refund zeroes out all remaining order value
  /** PO ids whose shipping was refunded because their last live item died. */
  deadPoIds: string[];
}

function liveItems(items: RefundItemSnapshot[]): RefundItemSnapshot[] {
  return items.filter((i) => i.itemStatus === OrderItemStatus.PENDING);
}

/** Taxable base still un-refunded: live items' parts + shipping of POs with ≥1 live item. */
function taxableBase(snapshot: RefundOrderSnapshot, excludeItemIds: Set<string>): number {
  const live = liveItems(snapshot.items).filter((i) => !excludeItemIds.has(i.id));
  const parts = live.reduce((s, i) => s + i.lineTotalCents, 0);
  const livePoIds = new Set(live.map((i) => i.purchaseOrderId).filter(Boolean));
  const shipping = snapshot.purchaseOrders
    .filter((po) => livePoIds.has(po.id))
    .reduce((s, po) => s + po.shippingFeeCents, 0);
  return parts + shipping;
}

export function computeRefund(
  snapshot: RefundOrderSnapshot,
  selection: RefundSelection,
): RefundComputation {
  const byId = new Map(snapshot.items.map((i) => [i.id, i]));
  const refundIds = new Set(selection.itemIds);
  const installOnlyIds = new Set(selection.installOnlyItemIds ?? []);

  let partsCents = 0;
  let installCents = 0;

  for (const id of refundIds) {
    const item = byId.get(id);
    if (!item) throw new Error(`Unknown order item ${id}`);
    if (item.itemStatus !== OrderItemStatus.PENDING) {
      throw new Error(`Item ${id} already ${item.itemStatus}`);
    }
    partsCents += item.lineTotalCents;
    if (item.withInstall && !item.installRefunded) installCents += item.installTotalCents;
  }
  for (const id of installOnlyIds) {
    if (refundIds.has(id)) continue; // full refund already covers install
    const item = byId.get(id);
    if (!item) throw new Error(`Unknown order item ${id}`);
    if (!item.withInstall || item.installRefunded) {
      throw new Error(`Item ${id} has no refundable install`);
    }
    installCents += item.installTotalCents;
  }

  // Shipping: a PO's fee is refunded when this refund kills its last live item.
  const deadPoIds: string[] = [];
  let shippingCents = 0;
  const affectedPoIds = new Set(
    Array.from(refundIds)
      .map((id) => byId.get(id)?.purchaseOrderId)
      .filter((x): x is string => Boolean(x)),
  );
  for (const poId of affectedPoIds) {
    const survivors = liveItems(snapshot.items).filter(
      (i) => i.purchaseOrderId === poId && !refundIds.has(i.id),
    );
    if (survivors.length === 0) {
      const po = snapshot.purchaseOrders.find((p) => p.id === poId);
      if (po) {
        shippingCents += po.shippingFeeCents;
        deadPoIds.push(poId);
      }
    }
  }

  // Recompute-and-diff tax (labor exempt — installs contribute no tax).
  const baseBefore = taxableBase(snapshot, new Set());
  const baseAfter = taxableBase(snapshot, refundIds);
  const taxCents = mulBps(baseBefore, snapshot.taxRateBps) - mulBps(baseAfter, snapshot.taxRateBps);

  let amountCents = partsCents + installCents + shippingCents + taxCents;

  // Is any order value left after this refund?
  const remainingInstall = liveItems(snapshot.items)
    .filter((i) => !refundIds.has(i.id))
    .filter((i) => i.withInstall && !i.installRefunded && !installOnlyIds.has(i.id))
    .reduce((s, i) => s + i.installTotalCents, 0);
  const isFinal = baseAfter === 0 && remainingInstall === 0;

  const remainingBalance = snapshot.totalCents - snapshot.refundedTotalCents;
  if (isFinal) {
    amountCents = remainingBalance; // absorb rounding drift exactly
  }
  amountCents = Math.max(0, Math.min(amountCents, remainingBalance));

  return { partsCents, installCents, shippingCents, taxCents, amountCents, isFinal, deadPoIds };
}
