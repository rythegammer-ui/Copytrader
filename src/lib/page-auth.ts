import { redirect } from "next/navigation";
import type { User } from "@prisma/client";
import { Role } from "@/lib/enums";
import { getCurrentUser } from "@/lib/session";

/**
 * Server-component auth guard for pages/layouts. Redirects to /login (with a
 * `next` return path) when signed out, or to the user's home surface when the
 * role doesn't match. API routes use requireUser() from lib/session instead.
 */
export async function requirePageUser(roles: string[], nextPath: string): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  if (roles.length > 0 && !roles.includes(user.role)) redirect(roleHome(user.role));
  return user;
}

/** Landing surface per role (used after login too). */
export function roleHome(role: string): string {
  switch (role) {
    case Role.ADMIN:
      return "/admin";
    case Role.SUPPLIER:
      return "/supplier";
    case Role.INSTALLER:
      return "/installer";
    default:
      return "/account";
  }
}
