import type { Prisma, PrismaClient, Installer } from "@prisma/client";
import { AppointmentStatus } from "@/lib/enums";
import { ceilDiv, TRANSIT_BUFFER_DAYS } from "@/lib/pricing";

/**
 * Appointment slots are COMPUTED from shop hours, never stored.
 *
 * Shops use a fixed UTC offset (tzOffsetMinutes; local = UTC + offset). DST is
 * intentionally out of scope for v1 (documented in SPEC.md).
 *
 * A booking occupies `blocks = max(1, ceil(laborMinutes / slotMinutes))`
 * consecutive blocks; a candidate slot is available iff every needed block has
 * fewer than `bays` overlapping active appointments.
 */

export type DbClient = PrismaClient | Prisma.TransactionClient;

export type ShopSchedule = Pick<
  Installer,
  "id" | "bays" | "openMinutes" | "closeMinutes" | "slotMinutes" | "daysOpenMask" | "tzOffsetMinutes"
>;

/** Statuses that occupy bay capacity. */
const OCCUPYING = [AppointmentStatus.PENDING_PARTS, AppointmentStatus.READY];

export function blocksNeeded(totalLaborTenths: number, slotMinutes: number): number {
  const laborMinutes = totalLaborTenths * 6;
  return Math.max(1, ceilDiv(laborMinutes, slotMinutes));
}

/** UTC instant for a shop-local calendar date + minutes-from-midnight. */
export function localToUtc(shop: ShopSchedule, y: number, m0: number, d: number, minutes: number): Date {
  return new Date(Date.UTC(y, m0, d) + (minutes - shop.tzOffsetMinutes) * 60_000);
}

/** All block starts (UTC) for one shop-local calendar date; empty if closed that day. */
export function blockStartsForDate(shop: ShopSchedule, y: number, m0: number, d: number): Date[] {
  const dayBit = 1 << new Date(Date.UTC(y, m0, d)).getUTCDay(); // Sun=1 .. Sat=64
  if ((shop.daysOpenMask & dayBit) === 0) return [];
  const starts: Date[] = [];
  for (let t = shop.openMinutes; t + shop.slotMinutes <= shop.closeMinutes; t += shop.slotMinutes) {
    starts.push(localToUtc(shop, y, m0, d, t));
  }
  return starts;
}

/** Earliest slot date the part(s) can plausibly arrive by. */
export function earliestFeasible(maxLeadTimeDays: number, now = new Date()): Date {
  return new Date(now.getTime() + (maxLeadTimeDays + TRANSIT_BUFFER_DAYS) * 24 * 60 * 60_000);
}

interface Occupied {
  startAt: Date;
  durationMinutes: number;
}

function countOverlapping(existing: Occupied[], blockStart: Date, slotMinutes: number): number {
  const b0 = blockStart.getTime();
  const b1 = b0 + slotMinutes * 60_000;
  return existing.filter((a) => {
    const a0 = a.startAt.getTime();
    const a1 = a0 + a.durationMinutes * 60_000;
    return a0 < b1 && a1 > b0;
  }).length;
}

async function fetchOccupied(
  db: DbClient,
  installerId: string,
  windowStart: Date,
  windowEnd: Date,
  excludeAppointmentId?: string,
): Promise<Occupied[]> {
  return db.appointment.findMany({
    where: {
      installerId,
      status: { in: OCCUPYING },
      startAt: { lt: windowEnd, gte: new Date(windowStart.getTime() - 24 * 60 * 60_000) },
      ...(excludeAppointmentId ? { id: { not: excludeAppointmentId } } : {}),
    },
    select: { startAt: true, durationMinutes: true },
  });
}

/**
 * Is a specific candidate slot bookable for `neededBlocks` consecutive blocks?
 * The candidate must be one of the shop's block starts and every needed block
 * must fit inside the same day's hours. Call inside the transaction that books.
 */
export async function isSlotAvailable(
  db: DbClient,
  shop: ShopSchedule,
  startAt: Date,
  neededBlocks: number,
  excludeAppointmentId?: string,
): Promise<boolean> {
  // Locate the shop-local date of this instant and verify it's a real block start.
  const localMs = startAt.getTime() + shop.tzOffsetMinutes * 60_000;
  const local = new Date(localMs);
  const y = local.getUTCFullYear();
  const m0 = local.getUTCMonth();
  const d = local.getUTCDate();
  const dayStarts = blockStartsForDate(shop, y, m0, d);
  const idx = dayStarts.findIndex((s) => s.getTime() === startAt.getTime());
  if (idx < 0) return false;
  if (idx + neededBlocks > dayStarts.length) return false; // job doesn't fit before close

  const windowEnd = new Date(startAt.getTime() + neededBlocks * shop.slotMinutes * 60_000);
  const occupied = await fetchOccupied(db, shop.id, startAt, windowEnd, excludeAppointmentId);
  for (let b = 0; b < neededBlocks; b++) {
    const blockStart = dayStarts[idx + b];
    if (countOverlapping(occupied, blockStart, shop.slotMinutes) >= shop.bays) return false;
  }
  return true;
}

export interface SlotInfo {
  startAt: Date;
  available: boolean;
  feasible: boolean; // false when before earliest part-arrival estimate
}

/** Grid of slots for the picker: `days` days from `fromDate` (shop-local date). */
export async function getSlotGrid(
  db: DbClient,
  shop: ShopSchedule,
  fromDate: Date,
  days: number,
  neededBlocks: number,
  notBefore: Date,
): Promise<SlotInfo[]> {
  const out: SlotInfo[] = [];
  const from = new Date(Date.UTC(fromDate.getUTCFullYear(), fromDate.getUTCMonth(), fromDate.getUTCDate()));
  const windowEnd = new Date(from.getTime() + (days + 1) * 24 * 60 * 60_000);
  const occupied = await fetchOccupied(db, shop.id, from, windowEnd);
  const now = new Date();

  for (let i = 0; i < days; i++) {
    const day = new Date(from.getTime() + i * 24 * 60 * 60_000);
    const y = day.getUTCFullYear();
    const m0 = day.getUTCMonth();
    const d = day.getUTCDate();
    const dayStarts = blockStartsForDate(shop, y, m0, d);
    for (let idx = 0; idx < dayStarts.length; idx++) {
      const startAt = dayStarts[idx];
      if (startAt <= now) continue;
      let available = idx + neededBlocks <= dayStarts.length;
      if (available) {
        for (let b = 0; b < neededBlocks && available; b++) {
          if (countOverlapping(occupied, dayStarts[idx + b], shop.slotMinutes) >= shop.bays) {
            available = false;
          }
        }
      }
      out.push({ startAt, available, feasible: startAt >= notBefore });
    }
  }
  return out;
}

/** Next bookable slot at/after `notBefore` (used for auto-rebooking). */
export async function nextFreeSlot(
  db: DbClient,
  shop: ShopSchedule,
  notBefore: Date,
  neededBlocks: number,
  searchDays = 30,
): Promise<Date | null> {
  const grid = await getSlotGrid(db, shop, notBefore, searchDays, neededBlocks, notBefore);
  const found = grid.find((s) => s.available && s.startAt >= notBefore);
  return found ? found.startAt : null;
}
