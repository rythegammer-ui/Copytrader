import Link from "next/link";
import { db } from "@/lib/db";
import { Role } from "@/lib/enums";
import { getCart } from "@/lib/cart";
import { getCurrentUser } from "@/lib/session";
import { roleHome } from "@/lib/page-auth";

export const dynamic = "force-dynamic";

export async function SiteHeader() {
  const user = await getCurrentUser();
  // getCart resolves the guest cookie cart too, so the badge works signed out.
  const [cart, unread] = await Promise.all([
    getCart(),
    user
      ? db.notification.count({ where: { userId: user.id, readAt: null } })
      : Promise.resolve(0),
  ]);
  const count = cart?.items.reduce((s, i) => s + i.qty, 0) ?? 0;

  const portalLink =
    user && user.role !== Role.CUSTOMER ? { href: roleHome(user.role), label: portalLabel(user.role) } : null;

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-6 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2 text-xl font-bold text-brand-700">
          <span aria-hidden className="text-2xl">🔧</span> PartsPro
        </Link>
        <nav className="hidden items-center gap-5 text-sm font-medium text-slate-600 sm:flex">
          <Link href="/parts" className="hover:text-brand-700">
            Shop parts
          </Link>
          <Link href="/parts?install=1" className="hover:text-brand-700">
            Parts + install
          </Link>
        </nav>
        <div className="ml-auto flex items-center gap-4 text-sm">
          {portalLink && (
            <Link
              href={portalLink.href}
              className="rounded-full bg-slate-900 px-3 py-1.5 font-semibold text-white hover:bg-slate-700"
            >
              {portalLink.label}
            </Link>
          )}
          {user ? (
            <>
              <Link
                href="/account/notifications"
                className="relative rounded-lg p-2 text-slate-600 hover:bg-slate-100"
                aria-label="Notifications"
              >
                <span aria-hidden>🔔</span>
                {unread > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">
                    {unread > 9 ? "9+" : unread}
                  </span>
                )}
              </Link>
              <Link href="/account" className="font-medium text-slate-700 hover:text-brand-700">
                {user.name.split(" ")[0]}
              </Link>
            </>
          ) : (
            <Link href="/login" className="font-medium text-slate-700 hover:text-brand-700">
              Sign in
            </Link>
          )}
          <Link
            href="/cart"
            className="relative rounded-lg bg-brand-600 px-3 py-2 font-semibold text-white hover:bg-brand-700"
          >
            Cart
            {count > 0 && (
              <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-400 px-1 text-[11px] font-bold text-slate-900">
                {count}
              </span>
            )}
          </Link>
        </div>
      </div>
    </header>
  );
}

function portalLabel(role: string): string {
  switch (role) {
    case Role.ADMIN:
      return "Admin";
    case Role.SUPPLIER:
      return "Supplier portal";
    case Role.INSTALLER:
      return "Installer portal";
    default:
      return "Account";
  }
}
