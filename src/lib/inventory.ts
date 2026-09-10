import { Prisma } from "@prisma/client";

/**
 * Finite-inventory availability.
 *
 * Most of the catalog is dropshipped and effectively unlimited
 * (`trackStock = false`). A part pulled off one car is different: it exists
 * once, and `stockQty` is what stops the store selling the same alternator
 * twice.
 *
 * A KIT is different again. The 528i front clip is not a unit we own — it is
 * an assembly of units we already own individually. If the kit and the hood
 * inside it each carried their own stock, the store would happily sell both
 * and the shop would owe somebody a refund. So a kit holds no stock of its
 * own: what it can sell is derived from its components, and selling either
 * side draws the same physical pieces down.
 */

/** `null` means "no finite limit" — a dropshipped part. */
export type Availability = number | null;

export interface KitPiece {
  componentId: string;
  qty: number;
  component: { trackStock: boolean; stockQty: number; name: string };
}

export interface StockFacts {
  trackStock: boolean;
  stockQty: number;
  isKit: boolean;
}

/**
 * How many of this part the store can sell right now.
 *
 * For a kit this is the tightest component bound: four wheels and one hood
 * means one clip, however many hoods the kit row claims to have.
 */
export function availableQty(part: StockFacts, pieces: KitPiece[] = []): Availability {
  if (part.isKit && pieces.length > 0) {
    let limit = Infinity;
    for (const p of pieces) {
      // An unlimited component never constrains the kit.
      if (!p.component.trackStock) continue;
      const per = Math.max(1, p.qty);
      limit = Math.min(limit, Math.floor(p.component.stockQty / per));
    }
    // A kit whose components are all unlimited is itself unlimited, unless it
    // was given a finite count of its own.
    if (limit === Infinity) return part.trackStock ? part.stockQty : null;
    return part.trackStock ? Math.min(limit, part.stockQty) : limit;
  }
  return part.trackStock ? part.stockQty : null;
}

/** True when `want` units cannot be supplied. */
export function isShort(available: Availability, want: number): boolean {
  return available !== null && want > available;
}

/** The message customers see when they ask for more than exists. */
export function shortMessage(name: string, available: Availability): string {
  return available === 0 ? `${name} just sold out` : `Only ${available} of ${name} left`;
}

type Tx = Prisma.TransactionClient;

/** Load the component rows for every kit among `partIds`. */
export async function loadKitPieces(tx: Tx, partIds: string[]): Promise<Map<string, KitPiece[]>> {
  const byKit = new Map<string, KitPiece[]>();
  if (partIds.length === 0) return byKit;
  const rows = await tx.kitComponent.findMany({
    where: { kitId: { in: partIds } },
    select: {
      kitId: true,
      componentId: true,
      qty: true,
      component: { select: { trackStock: true, stockQty: true, name: true } },
    },
  });
  for (const r of rows) {
    const list = byKit.get(r.kitId) ?? [];
    list.push({ componentId: r.componentId, qty: r.qty, component: r.component });
    byKit.set(r.kitId, list);
  }
  return byKit;
}

/**
 * Effective availability for a batch of parts, kits resolved.
 * Read paths that only need one part can pass a single id.
 */
export async function availabilityFor(
  tx: Tx,
  parts: { id: string; trackStock: boolean; stockQty: number; isKit: boolean }[],
): Promise<Map<string, Availability>> {
  const kitIds = parts.filter((p) => p.isKit).map((p) => p.id);
  const pieces = await loadKitPieces(tx, kitIds);
  return new Map(parts.map((p) => [p.id, availableQty(p, pieces.get(p.id) ?? [])]));
}

/**
 * Re-mirror the stored `stockQty` / `inStock` of every kit built from these
 * components. The derived value is authoritative at the point of sale; this
 * mirror is what keeps catalog list pages correct without a join.
 */
export async function resyncKits(tx: Tx, componentIds: string[]): Promise<void> {
  if (componentIds.length === 0) return;
  const affected = await tx.kitComponent.findMany({
    where: { componentId: { in: componentIds } },
    select: { kitId: true },
    distinct: ["kitId"],
  });
  for (const { kitId } of affected) {
    const kit = await tx.part.findUnique({
      where: { id: kitId },
      select: { trackStock: true, stockQty: true, isKit: true },
    });
    if (!kit) continue;
    const pieces = (await loadKitPieces(tx, [kitId])).get(kitId) ?? [];
    const avail = availableQty({ ...kit, trackStock: false }, pieces);
    const qty = avail === null ? kit.stockQty : avail;
    await tx.part.update({
      where: { id: kitId },
      data: { stockQty: qty, inStock: qty > 0 },
    });
  }
}

export interface DrawResult {
  /** false when the units were not there — the caller must flag an oversell. */
  ok: boolean;
  name: string;
}

/**
 * Take `qty` units of a part out of stock, atomically.
 *
 * Selling a kit consumes its components, not the kit row. Every decrement is
 * a compare-and-set (`updateMany` with a `gte` guard) so two carts racing the
 * last unit cannot both win under Postgres READ COMMITTED.
 */
export async function drawDownPart(tx: Tx, partId: string, qty: number): Promise<DrawResult> {
  const part = await tx.part.findUnique({
    where: { id: partId },
    select: { trackStock: true, stockQty: true, isKit: true, name: true },
  });
  if (!part) return { ok: true, name: "unknown part" };

  if (part.isKit) {
    const pieces = (await loadKitPieces(tx, [partId])).get(partId) ?? [];
    if (pieces.length > 0) {
      const taken: KitPiece[] = [];
      for (const p of pieces) {
        if (!p.component.trackStock) continue;
        const need = Math.max(1, p.qty) * qty;
        const hit = await tx.part.updateMany({
          where: { id: p.componentId, stockQty: { gte: need } },
          data: { stockQty: { decrement: need } },
        });
        if (hit.count === 0) {
          // Put back whatever this kit already consumed so a partial draw
          // never strands components in a half-sold state.
          for (const back of taken) {
            await tx.part.update({
              where: { id: back.componentId },
              data: { stockQty: { increment: Math.max(1, back.qty) * qty } },
            });
          }
          return { ok: false, name: part.name };
        }
        taken.push(p);
      }
      await tx.part.updateMany({
        where: { id: { in: pieces.map((p) => p.componentId) }, stockQty: 0 },
        data: { inStock: false },
      });
      await resyncKits(tx, pieces.map((p) => p.componentId));
      return { ok: true, name: part.name };
    }
  }

  if (!part.trackStock) return { ok: true, name: part.name };

  const drawn = await tx.part.updateMany({
    where: { id: partId, stockQty: { gte: qty } },
    data: { stockQty: { decrement: qty } },
  });
  if (drawn.count === 0) {
    await tx.part.update({ where: { id: partId }, data: { stockQty: 0, inStock: false } });
    await resyncKits(tx, [partId]);
    return { ok: false, name: part.name };
  }
  await tx.part.updateMany({ where: { id: partId, stockQty: 0 }, data: { inStock: false } });
  await resyncKits(tx, [partId]);
  return { ok: true, name: part.name };
}

/** Put `qty` units back — a refunded line or a cancelled paid order. */
export async function restorePart(tx: Tx, partId: string, qty: number): Promise<void> {
  const part = await tx.part.findUnique({
    where: { id: partId },
    select: { trackStock: true, isKit: true },
  });
  if (!part) return;

  if (part.isKit) {
    const pieces = (await loadKitPieces(tx, [partId])).get(partId) ?? [];
    if (pieces.length > 0) {
      for (const p of pieces) {
        if (!p.component.trackStock) continue;
        await tx.part.update({
          where: { id: p.componentId },
          data: { stockQty: { increment: Math.max(1, p.qty) * qty }, inStock: true },
        });
      }
      await resyncKits(tx, pieces.map((p) => p.componentId));
      return;
    }
  }

  if (!part.trackStock) return;
  await tx.part.update({
    where: { id: partId },
    data: { stockQty: { increment: qty }, inStock: true },
  });
  await resyncKits(tx, [partId]);
}
