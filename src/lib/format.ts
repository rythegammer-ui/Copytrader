/** Display helpers shared across storefront, portals, and admin. */

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Render a UTC instant in a shop's local wall-clock time (fixed UTC offset;
 * local = UTC + offset). Deterministic on server and client — avoids
 * hydration mismatches from environment-dependent toLocaleString.
 */
export function formatShopTime(date: Date | string, tzOffsetMinutes: number): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const local = new Date(d.getTime() + tzOffsetMinutes * 60_000);
  const h24 = local.getUTCHours();
  const ampm = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const min = local.getUTCMinutes().toString().padStart(2, "0");
  return `${DAYS[local.getUTCDay()]}, ${MONTHS[local.getUTCMonth()]} ${local.getUTCDate()} · ${h12}:${min} ${ampm}`;
}

/** Date-only (UTC calendar date) — for placed-at / due-at style stamps. */
export function formatDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

export function formatDateTime(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const min = d.getUTCMinutes().toString().padStart(2, "0");
  const h24 = d.getUTCHours();
  const ampm = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()} ${h12}:${min} ${ampm} UTC`;
}

export function pluralize(n: number, singular: string, plural?: string): string {
  return n === 1 ? singular : plural ?? `${singular}s`;
}
