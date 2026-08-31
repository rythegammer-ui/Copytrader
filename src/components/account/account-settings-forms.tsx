"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { sendJson } from "./account-api";

export type ProfileInfo = {
  name: string;
  email: string;
  phone: string | null;
};

export type AddressRow = {
  id: string;
  label: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  zip: string;
  isDefault: boolean;
};

// ---------------------------------------------------------------------------
// Profile (name / phone)
// ---------------------------------------------------------------------------

export function AccountProfileForm({ profile }: { profile: ProfileInfo }) {
  const router = useRouter();
  const [name, setName] = useState(profile.name);
  const [phone, setPhone] = useState(profile.phone ?? "");
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    setError(null);
    const res = await sendJson("/api/account/profile", "PATCH", {
      name,
      phone: phone.trim() === "" ? null : phone.trim(),
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setMsg("Profile saved");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="card space-y-4 p-6">
      <h2 className="text-lg font-semibold text-slate-900">Profile</h2>
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {msg && <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">{msg}</p>}
      <div>
        <label className="label" htmlFor="set-email">
          Email
        </label>
        <input id="set-email" className="input bg-slate-100" type="email" value={profile.email} disabled />
      </div>
      <div>
        <label className="label" htmlFor="set-name">
          Full name
        </label>
        <input
          id="set-name"
          className="input"
          type="text"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div>
        <label className="label" htmlFor="set-phone">
          Phone
        </label>
        <input
          id="set-phone"
          className="input"
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
      </div>
      <button type="submit" className="btn-primary" disabled={busy}>
        {busy ? "Saving…" : "Save profile"}
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Password change
// ---------------------------------------------------------------------------

export function AccountPasswordForm() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMsg(null);
    if (next.length < 8) {
      setError("New password must be at least 8 characters");
      return;
    }
    if (next !== confirm) {
      setError("New passwords do not match");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await sendJson("/api/account/profile", "PATCH", {
      password: { current, next },
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setMsg("Password updated");
    setCurrent("");
    setNext("");
    setConfirm("");
  }

  return (
    <form onSubmit={onSubmit} className="card space-y-4 p-6">
      <h2 className="text-lg font-semibold text-slate-900">Change password</h2>
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {msg && <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">{msg}</p>}
      <div>
        <label className="label" htmlFor="pw-current">
          Current password
        </label>
        <input
          id="pw-current"
          className="input"
          type="password"
          autoComplete="current-password"
          required
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="pw-next">
            New password
          </label>
          <input
            id="pw-next"
            className="input"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="pw-confirm">
            Confirm new password
          </label>
          <input
            id="pw-confirm"
            className="input"
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </div>
      </div>
      <button type="submit" className="btn-primary" disabled={busy}>
        {busy ? "Updating…" : "Update password"}
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Addresses CRUD
// ---------------------------------------------------------------------------

export function AccountAddresses({ addresses }: { addresses: AddressRow[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [showAdd, setShowAdd] = useState(addresses.length === 0);

  // Add form state
  const [label, setLabel] = useState("Home");
  const [line1, setLine1] = useState("");
  const [line2, setLine2] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [zip, setZip] = useState("");
  const [adding, setAdding] = useState(false);

  async function onAdd(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setAdding(true);
    setError(null);
    const res = await sendJson("/api/account/addresses", "POST", {
      label,
      line1,
      ...(line2.trim() ? { line2: line2.trim() } : {}),
      city,
      state: state.toUpperCase(),
      zip,
    });
    setAdding(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setLabel("Home");
    setLine1("");
    setLine2("");
    setCity("");
    setState("");
    setZip("");
    setShowAdd(false);
    router.refresh();
  }

  async function patchAddress(id: string, body: unknown) {
    setBusyId(id);
    setError(null);
    const res = await sendJson(`/api/account/addresses/${id}`, "PATCH", body);
    setBusyId(null);
    if (!res.ok) {
      setError(res.error);
      return false;
    }
    router.refresh();
    return true;
  }

  async function onDelete(id: string) {
    setBusyId(id);
    setError(null);
    const res = await sendJson(`/api/account/addresses/${id}`, "DELETE");
    setBusyId(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    router.refresh();
  }

  return (
    <div className="card space-y-4 p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-900">Addresses</h2>
        <button type="button" className="btn-secondary" onClick={() => setShowAdd((s) => !s)}>
          {showAdd ? "Close" : "Add address"}
        </button>
      </div>
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="divide-y divide-slate-100">
        {addresses.length === 0 && (
          <p className="py-3 text-sm text-slate-500">No addresses saved yet.</p>
        )}
        {addresses.map((a) => (
          <div key={a.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
            <div>
              <p className="flex items-center gap-2 font-medium text-slate-900">
                {editingId === a.id ? (
                  <span className="flex items-center gap-2">
                    <input
                      className="input w-40"
                      type="text"
                      value={editLabel}
                      maxLength={40}
                      onChange={(e) => setEditLabel(e.target.value)}
                    />
                    <button
                      type="button"
                      className="text-sm font-medium text-brand-700 hover:underline"
                      onClick={async () => {
                        if (editLabel.trim() && (await patchAddress(a.id, { label: editLabel.trim() }))) {
                          setEditingId(null);
                        }
                      }}
                      disabled={busyId === a.id}
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      className="text-sm text-slate-500 hover:underline"
                      onClick={() => setEditingId(null)}
                    >
                      Cancel
                    </button>
                  </span>
                ) : (
                  <>
                    {a.label}
                    {a.isDefault && (
                      <span className="badge bg-green-100 text-green-800">Default</span>
                    )}
                  </>
                )}
              </p>
              <p className="text-sm text-slate-600">
                {a.line1}
                {a.line2 ? `, ${a.line2}` : ""}, {a.city}, {a.state} {a.zip}
              </p>
            </div>
            <div className="flex items-center gap-3 text-sm">
              {editingId !== a.id && (
                <button
                  type="button"
                  className="font-medium text-slate-600 hover:text-slate-900"
                  onClick={() => {
                    setEditingId(a.id);
                    setEditLabel(a.label);
                  }}
                >
                  Edit label
                </button>
              )}
              {!a.isDefault && (
                <button
                  type="button"
                  className="font-medium text-brand-700 hover:underline"
                  onClick={() => patchAddress(a.id, { isDefault: true })}
                  disabled={busyId === a.id}
                >
                  Make default
                </button>
              )}
              <button
                type="button"
                className="font-medium text-red-600 hover:underline"
                onClick={() => onDelete(a.id)}
                disabled={busyId === a.id}
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>

      {showAdd && (
        <form onSubmit={onAdd} className="space-y-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
          <h3 className="font-medium text-slate-900">New address</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="addr-label">
                Label
              </label>
              <input
                id="addr-label"
                className="input"
                type="text"
                required
                maxLength={40}
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
            </div>
            <div>
              <label className="label" htmlFor="addr-line1">
                Address line 1
              </label>
              <input
                id="addr-line1"
                className="input"
                type="text"
                required
                value={line1}
                onChange={(e) => setLine1(e.target.value)}
              />
            </div>
            <div>
              <label className="label" htmlFor="addr-line2">
                Address line 2 <span className="font-normal text-slate-400">(optional)</span>
              </label>
              <input
                id="addr-line2"
                className="input"
                type="text"
                value={line2}
                onChange={(e) => setLine2(e.target.value)}
              />
            </div>
            <div>
              <label className="label" htmlFor="addr-city">
                City
              </label>
              <input
                id="addr-city"
                className="input"
                type="text"
                required
                value={city}
                onChange={(e) => setCity(e.target.value)}
              />
            </div>
            <div>
              <label className="label" htmlFor="addr-state">
                State (2 letters)
              </label>
              <input
                id="addr-state"
                className="input uppercase"
                type="text"
                required
                maxLength={2}
                pattern="[A-Za-z]{2}"
                value={state}
                onChange={(e) => setState(e.target.value)}
              />
            </div>
            <div>
              <label className="label" htmlFor="addr-zip">
                ZIP
              </label>
              <input
                id="addr-zip"
                className="input"
                type="text"
                required
                pattern="\d{5}(-\d{4})?"
                value={zip}
                onChange={(e) => setZip(e.target.value)}
              />
            </div>
          </div>
          <button type="submit" className="btn-primary" disabled={adding}>
            {adding ? "Saving…" : "Save address"}
          </button>
        </form>
      )}
    </div>
  );
}
