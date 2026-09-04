import type { Prisma } from "@prisma/client";
import { isPostgres } from "@/lib/slots";

/**
 * Case-insensitive `contains`. Postgres LIKE is case-sensitive, so it needs
 * mode:"insensitive"; SQLite LIKE is already ASCII case-insensitive and its
 * client rejects `mode`, so the flag is only added on Postgres.
 */
export function ci(q: string): Prisma.StringFilter {
  return (isPostgres() ? { contains: q, mode: "insensitive" } : { contains: q }) as unknown as Prisma.StringFilter;
}
