import Link from "next/link";
import { Role } from "@/lib/enums";
import { requirePageUser } from "@/lib/page-auth";

const NAV: { href: string; label: string }[] = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/attention", label: "Attention" },
  { href: "/admin/orders", label: "Orders" },
  { href: "/admin/refunds", label: "Refunds" },
  { href: "/admin/parts", label: "Parts" },
  { href: "/admin/suppliers", label: "Suppliers" },
  { href: "/admin/installers", label: "Installers" },
  { href: "/admin/taxonomy", label: "Taxonomy" },
  { href: "/admin/users", label: "Users" },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePageUser([Role.ADMIN], "/admin");
  return (
    <div className="flex min-h-[calc(100vh-8rem)] flex-col lg:flex-row">
      <aside className="w-full flex-shrink-0 bg-slate-900 text-slate-300 lg:w-56">
        <div className="px-4 py-5">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">
            PartsPro Admin
          </p>
          <p className="mt-1 truncate text-sm text-slate-400">{user.name}</p>
        </div>
        <nav className="flex flex-row flex-wrap gap-1 px-2 pb-4 lg:flex-col">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-lg px-3 py-2 text-sm font-medium transition hover:bg-slate-800 hover:text-white"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>
      <div className="min-w-0 flex-1 bg-slate-50">{children}</div>
    </div>
  );
}
