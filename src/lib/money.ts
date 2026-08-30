/**
 * All money in this codebase is handled as integer US cents.
 * Never use floats for amounts; convert to dollars only for display.
 */

export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const rem = abs % 100;
  return `${sign}$${dollars.toLocaleString("en-US")}.${rem.toString().padStart(2, "0")}`;
}

/** Round half-up on the cent boundary, e.g. for tax: cents * rate. */
export function roundCents(value: number): number {
  return Math.round(value);
}
