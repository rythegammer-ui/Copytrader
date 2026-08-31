import Link from "next/link";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { Role, zRole } from "@/lib/enums";
import { formatDate } from "@/lib/format";
import { requirePageUser } from "@/lib/page-auth";
import { CreateUserForm, PasswordResetButton } from "@/components/admin-crud/UserForms";

export const metadata: Metadata = { title: "Users — admin" };
export const dynamic = "force-dynamic";

const ROLE_TABS: { value: string; label: string }[] = [
  { value: "", label: "All" },
  ...Object.values(Role).map((r) => ({ value: r, label: r })),
];

function roleBadgeClass(role: string): string {
  switch (role) {
    case Role.ADMIN:
      return "bg-purple-100 text-purple-800";
    case Role.SUPPLIER:
      return "bg-blue-100 text-blue-800";
    case Role.INSTALLER:
      return "bg-indigo-100 text-indigo-800";
    default:
      return "bg-slate-100 text-slate-800";
  }
}

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: { role?: string };
}) {
  await requirePageUser([Role.ADMIN], "/admin/users");

  const roleParse = zRole.safeParse(searchParams.role);
  const roleFilter = roleParse.success ? roleParse.data : "";

  const [users, suppliers, installers] = await Promise.all([
    db.user.findMany({
      where: roleFilter ? { role: roleFilter } : {},
      orderBy: { email: "asc" },
      include: {
        supplier: { select: { id: true, name: true } },
        installer: { select: { id: true, name: true } },
      },
    }),
    db.supplier.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.installer.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-900">Users</h1>
        <CreateUserForm suppliers={suppliers} installers={installers} collapsible />
      </div>

      <div className="mb-4 flex flex-wrap gap-1">
        {ROLE_TABS.map((t) => (
          <Link
            key={t.value || "all"}
            href={t.value ? `/admin/users?role=${t.value}` : "/admin/users"}
            className={`rounded-full px-3 py-1 text-xs font-medium transition ${
              roleFilter === t.value
                ? "bg-slate-900 text-white"
                : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Linked to</th>
              <th className="px-4 py-3">Created</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {users.map((u) => (
              <tr key={u.id} className="transition hover:bg-slate-50">
                <td className="px-4 py-3 text-slate-900">{u.email}</td>
                <td className="px-4 py-3 text-slate-600">{u.name}</td>
                <td className="px-4 py-3">
                  <span className={`badge ${roleBadgeClass(u.role)}`}>{u.role}</span>
                </td>
                <td className="px-4 py-3 text-slate-600">
                  {u.supplier ? (
                    <Link
                      href={`/admin/suppliers/${u.supplier.id}`}
                      className="text-brand-700 hover:underline"
                    >
                      {u.supplier.name}
                    </Link>
                  ) : u.installer ? (
                    <Link
                      href={`/admin/installers/${u.installer.id}`}
                      className="text-brand-700 hover:underline"
                    >
                      {u.installer.name}
                    </Link>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-4 py-3 text-slate-600">{formatDate(u.createdAt)}</td>
                <td className="px-4 py-3 text-right">
                  <PasswordResetButton userId={u.id} email={u.email} />
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                  No users match this filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
