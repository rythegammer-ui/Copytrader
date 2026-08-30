import { ShipTo } from "@/lib/enums";

/**
 * The ONLY place pricing formulas live. Checkout quote, order creation, and
 * tests all call priceQuote(). Post-checkout code reads Order/OrderItem
 * snapshots — never recompute from live catalog rows.
 *
 * All amounts are integer cents. Labor is integer tenths of an hour.
 */

export const FREE_SHIP_THRESHOLD_CENTS = 15000; // free group shipping at $150+ of parts
export const MIN_ORDER_TOTAL_CENTS = 50; // Stripe minimum charge
export const TRANSIT_BUFFER_DAYS = 2; // added to supplier lead time for slot feasibility

export function taxRateBps(): number {
  const parsed = parseInt(process.env.TAX_RATE_BPS ?? "825", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 825;
}

export function mulBps(cents: number, bps: number): number {
  return Math.round((cents * bps) / 10000);
}

export function ceilDiv(a: number, b: number): number {
  return Math.ceil(a / b);
}

/**
 * Shipment-group key. The SAME key groups shipping pricing and PO fan-out —
 * they must reconcile or PurchaseOrder.shippingFeeCents drifts from the quote.
 */
export function destinationKey(supplierId: string, shipTo: string, installerId: string | null | undefined): string {
  return `${supplierId}|${shipTo}|${shipTo === ShipTo.INSTALLER ? installerId ?? "" : ""}`;
}

export interface QuoteItemInput {
  cartItemId?: string;
  partId: string;
  qty: number;
  priceCents: number;
  supplierId: string;
  supplierCostCents: number;
  installEligible: boolean;
  laborHoursTenths: number;
  installFixedFeeCents: number | null;
  withInstall: boolean;
  installerId: string | null;
  installerHourlyRateCents: number | null; // required when withInstall
  apptStartAt: Date | null;
  shipTo: string; // ShipTo
}

export interface QuotedLine {
  cartItemId?: string;
  partId: string;
  qty: number;
  unitPriceCents: number;
  lineTotalCents: number;
  supplierId: string;
  supplierCostCents: number;
  withInstall: boolean;
  installerId: string | null;
  apptStartAt: Date | null;
  shipTo: string;
  laborHoursTenths: number | null;
  shopRateCents: number | null;
  installUnitCents: number | null;
  installTotalCents: number;
  groupKey: string;
}

export interface QuoteGroup {
  key: string;
  supplierId: string;
  shipTo: string;
  installerId: string | null;
  partsCents: number;
  qty: number;
  shippingCents: number;
  supplierCostTotalCents: number;
  lineIds: string[]; // partIds in the group
}

export interface Quote {
  lines: QuotedLine[];
  groups: QuoteGroup[];
  partsSubtotalCents: number;
  installSubtotalCents: number;
  shippingTotalCents: number;
  taxRateBps: number;
  taxCents: number;
  totalCents: number;
}

export interface SupplierShippingConfig {
  shippingFlatCents: number;
  shippingPerItemCents: number;
}

/** Per-unit install price for a part at a shop. */
export function installUnitCents(
  part: { installFixedFeeCents: number | null; laborHoursTenths: number },
  hourlyRateCents: number,
): number {
  return part.installFixedFeeCents ?? ceilDiv(part.laborHoursTenths * hourlyRateCents, 10);
}

/**
 * Price a set of cart lines. Pure function — pass in everything it needs.
 * suppliers maps supplierId -> shipping config.
 */
export function priceQuote(
  items: QuoteItemInput[],
  suppliers: Record<string, SupplierShippingConfig>,
  rateBps: number,
): Quote {
  const lines: QuotedLine[] = items.map((it) => {
    const lineTotalCents = it.priceCents * it.qty;
    const withInstall = it.withInstall && it.installEligible;
    let unitInstall: number | null = null;
    let installTotal = 0;
    if (withInstall) {
      if (it.installerHourlyRateCents == null) {
        throw new Error(`Missing installer rate for part ${it.partId} with install`);
      }
      unitInstall = installUnitCents(
        { installFixedFeeCents: it.installFixedFeeCents, laborHoursTenths: it.laborHoursTenths },
        it.installerHourlyRateCents,
      );
      installTotal = unitInstall * it.qty;
    }
    return {
      cartItemId: it.cartItemId,
      partId: it.partId,
      qty: it.qty,
      unitPriceCents: it.priceCents,
      lineTotalCents,
      supplierId: it.supplierId,
      supplierCostCents: it.supplierCostCents,
      withInstall,
      installerId: withInstall || it.shipTo === ShipTo.INSTALLER ? it.installerId : null,
      apptStartAt: withInstall ? it.apptStartAt : null,
      shipTo: it.shipTo,
      laborHoursTenths: withInstall ? it.laborHoursTenths : null,
      shopRateCents: withInstall ? it.installerHourlyRateCents : null,
      installUnitCents: unitInstall,
      installTotalCents: installTotal,
      groupKey: destinationKey(it.supplierId, it.shipTo, it.installerId),
    };
  });

  const groupMap = new Map<string, QuoteGroup>();
  for (const line of lines) {
    let g = groupMap.get(line.groupKey);
    if (!g) {
      g = {
        key: line.groupKey,
        supplierId: line.supplierId,
        shipTo: line.shipTo,
        installerId: line.shipTo === ShipTo.INSTALLER ? line.installerId : null,
        partsCents: 0,
        qty: 0,
        shippingCents: 0,
        supplierCostTotalCents: 0,
        lineIds: [],
      };
      groupMap.set(line.groupKey, g);
    }
    g.partsCents += line.lineTotalCents;
    g.qty += line.qty;
    g.supplierCostTotalCents += line.supplierCostCents * line.qty;
    g.lineIds.push(line.partId);
  }

  const groups = Array.from(groupMap.values());
  for (const g of groups) {
    const cfg = suppliers[g.supplierId];
    if (!cfg) throw new Error(`Missing supplier shipping config for ${g.supplierId}`);
    g.shippingCents =
      g.partsCents >= FREE_SHIP_THRESHOLD_CENTS
        ? 0
        : cfg.shippingFlatCents + cfg.shippingPerItemCents * g.qty;
  }

  const partsSubtotalCents = lines.reduce((s, l) => s + l.lineTotalCents, 0);
  const installSubtotalCents = lines.reduce((s, l) => s + l.installTotalCents, 0);
  const shippingTotalCents = groups.reduce((s, g) => s + g.shippingCents, 0);
  // ONE rounding on the whole taxable base (parts + shipping; labor exempt).
  const taxCents = mulBps(partsSubtotalCents + shippingTotalCents, rateBps);
  const totalCents = partsSubtotalCents + installSubtotalCents + shippingTotalCents + taxCents;

  return {
    lines,
    groups,
    partsSubtotalCents,
    installSubtotalCents,
    shippingTotalCents,
    taxRateBps: rateBps,
    taxCents,
    totalCents,
  };
}
