"use client";

/**
 * Admin user-management forms: create a portal/admin/customer login (with the
 * SUPPLIER<->supplierId / INSTALLER<->installerId linkage enforced), and an
 * inline admin password reset per user row.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Role } from "@/lib/enums";
import { sendJson, type Option } from "@/components/admin-crud/crud-shared";

const ROLES = [Role.CUSTOMER, Role.ADMIN, Role.SUPPLIER, Role.INSTALLER] as const;
type RoleName = (typeof ROLES)[number];

interface CreateUserFormProps {
  suppliers: Option[];
  installers: Option[];
  /** Lock the role (and the linked entity) — used on supplier/installer pages. */
  fixedRole?: RoleName;
  fixedSupplierId?: string;
  fixedInstallerId?: string;
  collapsible?: boolean;
  buttonLabel?: string;
}

export function CreateUserForm({
  suppliers,
  installers,
  fixedRole,
  fixedSupplierId,
  fixedInstallerId,
  collapsible,
  buttonLabel,
}: CreateUserFormProps) {
  const router = useRouter();
  const [open, setOpen] = useState(!collapsible);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<RoleName>(fixedRole ?? Role.CUSTOMER);
  const [supplierId, setSupplierId] = useState(fixedSupplierId ?? "");
  const [installerId, setInstallerId] = useState(fixedInstallerId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);

  const effectiveRole = fixedRole ?? role;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setCreated(null);

    if (password.length < 8) return setError("Password must be at least 8 characters.");
    const effSupplierId = fixedSupplierId ?? supplierId;
    const effInstallerId = fixedInstallerId ?? installerId;
    if (effectiveRole === Role.SUPPLIER && !effSupplierId) return setError("Pick a supplier to link.");
    if (effectiveRole === Role.INSTALLER && !effInstallerId) return setError("Pick a shop to link.");

    setBusy(true);
    const res = await sendJson<{ email: string }>("/api/admin/users", "POST", {
      email: email.trim(),
      name: name.trim(),
      password,
      role: effectiveRole,
      supplierId: effectiveRole === Role.SUPPLIER ? effSupplierId : null,
      installerId: effectiveRole === Role.INSTALLER ? effInstallerId : null,
    });
    setBusy(false);

    if (!res.ok) {
      setError(res.error);
      return;
    }
    setCreated(res.data?.email ?? email.trim());
    setEmail("");
    setName("");
    setPassword("");
    router.refresh();
  };

  if (!open) {
    return (
      <button type="button" className="btn-primary" onClick={() => setOpen(true)}>
        {buttonLabel ?? "+ New user"}
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="card p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-900">
          {buttonLabel ?? "Create login"}
        </h2>
        {collapsible && (
          <button type="button" className="text-sm text-slate-500 hover:underline" onClick={() => setOpen(false)}>
            Close
          </button>
        )}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="uf-email">Email</label>
          <input id="uf-email" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div>
          <label className="label" htmlFor="uf-name">Name</label>
          <input id="uf-name" className="input" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div>
          <label className="label" htmlFor="uf-pass">Password (min 8 chars)</label>
          <input id="uf-pass" className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        {!fixedRole && (
          <div>
            <label className="label" htmlFor="uf-role">Role</label>
            <select id="uf-role" className="input" value={role} onChange={(e) => setRole(e.target.value as RoleName)}>
              {ROLES.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
        )}
        {effectiveRole === Role.SUPPLIER && !fixedSupplierId && (
          <div>
            <label className="label" htmlFor="uf-sup">Linked supplier</label>
            <select id="uf-sup" className="input" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">Select…</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
        )}
        {effectiveRole === Role.INSTALLER && !fixedInstallerId && (
          <div>
            <label className="label" htmlFor="uf-inst">Linked shop</label>
            <select id="uf-inst" className="input" value={installerId} onChange={(e) => setInstallerId(e.target.value)}>
              <option value="">Select…</option>
              {installers.map((i) => (
                <option key={i.id} value={i.id}>{i.name}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      {created && <p className="mt-3 text-sm text-green-700">Created login for {created}.</p>}

      <div className="mt-5 flex justify-end">
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? "Creating…" : "Create user"}
        </button>
      </div>
    </form>
  );
}

export function PasswordResetButton({ userId, email }: { userId: string; email: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const reset = async () => {
    setError(null);
    if (password.length < 8) {
      setError("Min 8 characters");
      return;
    }
    setBusy(true);
    const res = await sendJson(`/api/admin/users/${userId}`, "PATCH", { password });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setDone(true);
    setPassword("");
    setOpen(false);
    router.refresh();
  };

  if (!open) {
    return (
      <span className="inline-flex items-center gap-2">
        <button
          type="button"
          className="text-sm font-medium text-brand-700 hover:underline"
          onClick={() => {
            setOpen(true);
            setDone(false);
          }}
        >
          Reset password
        </button>
        {done && <span className="text-xs text-green-700">Done</span>}
      </span>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <input
        className="input w-40"
        type="password"
        placeholder={`New password for ${email}`}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <button type="button" className="btn-secondary" onClick={reset} disabled={busy}>
        {busy ? "Saving…" : "Set"}
      </button>
      <button
        type="button"
        className="text-sm text-slate-500 hover:underline"
        onClick={() => setOpen(false)}
        disabled={busy}
      >
        Cancel
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}
