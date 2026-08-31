/**
 * Client-safe helpers shared by the admin CRUD forms. No server imports —
 * safe to use from both server pages (labels) and "use client" components.
 */

export interface ApiResult<T = unknown> {
  ok: boolean;
  status: number;
  data: T | null;
  error: string | null;
}

/** JSON fetch wrapper for the admin CRUD API routes. */
export async function sendJson<T = unknown>(
  path: string,
  method: "POST" | "PATCH" | "DELETE",
  body?: unknown,
): Promise<ApiResult<T>> {
  try {
    const res = await fetch(path, {
      method,
      headers: { "Content-Type": "application/json" },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      /* empty body */
    }
    if (!res.ok) {
      const err = data as { error?: { message?: string } } | null;
      return {
        ok: false,
        status: res.status,
        data: null,
        error: err?.error?.message ?? `Request failed (${res.status})`,
      };
    }
    return { ok: true, status: res.status, data: data as T, error: null };
  } catch {
    return { ok: false, status: 0, data: null, error: "Network error" };
  }
}

/** "129.99" (or "$1,299.99") -> integer cents; null when not a valid amount. */
export function parseDollars(input: string): number | null {
  const cleaned = input.replace(/[$,\s]/g, "");
  if (!cleaned) return null;
  const n = Number.parseFloat(cleaned);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

/** Integer cents -> "129.99" for form inputs ("" for null/undefined). */
export function centsToDollarInput(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "";
  return (cents / 100).toFixed(2);
}

/** Non-negative integer from a text input; null when invalid. */
export function parseIntField(input: string): number | null {
  const t = input.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number.parseInt(t, 10);
  return Number.isFinite(n) ? n : null;
}

/** Minutes-from-midnight -> "08:00" style label. */
export function minutesToHHMM(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
}

/** Half-hour options for the shop-hours selects (00:00 .. 24:00). */
export const TIME_OPTIONS: number[] = Array.from({ length: 49 }, (_, i) => i * 30);

/** Day bits: Sun=1 .. Sat=64 (matches Installer.daysOpenMask). */
export const DAY_OPTIONS: { bit: number; label: string }[] = [
  { bit: 1, label: "Sun" },
  { bit: 2, label: "Mon" },
  { bit: 4, label: "Tue" },
  { bit: 8, label: "Wed" },
  { bit: 16, label: "Thu" },
  { bit: 32, label: "Fri" },
  { bit: 64, label: "Sat" },
];

/** "Mon, Tue, Wed" summary from a daysOpenMask. */
export function daysMaskLabel(mask: number): string {
  const days = DAY_OPTIONS.filter((d) => (mask & d.bit) !== 0).map((d) => d.label);
  return days.length > 0 ? days.join(", ") : "Closed";
}

/** Fixed-offset timezone choices (DST out of scope, per spec). */
export const TZ_OPTIONS: { value: number; label: string }[] = [
  { value: -300, label: "Eastern (ET, UTC-05:00)" },
  { value: -360, label: "Central (CT, UTC-06:00)" },
  { value: -420, label: "Mountain (MT, UTC-07:00)" },
  { value: -480, label: "Pacific (PT, UTC-08:00)" },
];

export function tzLabel(offset: number): string {
  return TZ_OPTIONS.find((t) => t.value === offset)?.label ?? `UTC${offset >= 0 ? "+" : ""}${offset / 60}`;
}

// ---- serialized shapes passed from server pages into the client forms ----

export interface Option {
  id: string;
  name: string;
}

export interface EngineOption {
  id: string;
  name: string;
}

export interface ModelNode {
  id: string;
  name: string;
  engines: EngineOption[];
}

export interface MakeNode {
  id: string;
  name: string;
  models: ModelNode[];
}

export interface FitmentRow {
  id: string;
  makeName: string;
  modelName: string;
  engineName: string | null;
  yearFrom: number;
  yearTo: number;
  notes: string | null;
}

export interface PartFormInitial {
  sku: string;
  slug: string;
  name: string;
  description: string;
  imageUrl: string;
  categoryId: string;
  brandId: string;
  supplierId: string;
  priceCents: number;
  supplierCostCents: number;
  weightGrams: number;
  installEligible: boolean;
  laborHoursTenths: number;
  installFixedFeeCents: number | null;
  universalFit: boolean;
  inStock: boolean;
  active: boolean;
}

export interface SupplierFormInitial {
  name: string;
  slug: string;
  contactEmail: string;
  phone: string;
  city: string;
  state: string;
  leadTimeDays: number;
  shippingFlatCents: number;
  shippingPerItemCents: number;
  active: boolean;
}

export interface InstallerFormInitial {
  name: string;
  slug: string;
  hourlyRateCents: number;
  line1: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  bays: number;
  openMinutes: number;
  closeMinutes: number;
  slotMinutes: number;
  daysOpenMask: number;
  tzOffsetMinutes: number;
  active: boolean;
}
