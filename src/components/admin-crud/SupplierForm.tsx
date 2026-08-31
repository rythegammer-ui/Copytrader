"use client";

/**
 * Create/edit form for suppliers. Shipping fees entered in dollars, stored
 * as integer cents. In create mode it can render collapsed behind a button.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  centsToDollarInput,
  parseDollars,
  parseIntField,
  sendJson,
  type SupplierFormInitial,
} from "@/components/admin-crud/crud-shared";

interface SupplierFormProps {
  mode: "create" | "edit";
  supplierId?: string;
  initial?: SupplierFormInitial;
  collapsible?: boolean;
}

export function SupplierForm({ mode, supplierId, initial, collapsible }: SupplierFormProps) {
  const router = useRouter();
  const [open, setOpen] = useState(!collapsible);
  const [name, setName] = useState(initial?.name ?? "");
  const [slug, setSlug] = useState(initial?.slug ?? "");
  const [contactEmail, setContactEmail] = useState(initial?.contactEmail ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [city, setCity] = useState(initial?.city ?? "");
  const [state, setState] = useState(initial?.state ?? "");
  const [leadTimeDays, setLeadTimeDays] = useState(String(initial?.leadTimeDays ?? 3));
  const [flat, setFlat] = useState(centsToDollarInput(initial?.shippingFlatCents ?? 999));
  const [perItem, setPerItem] = useState(centsToDollarInput(initial?.shippingPerItemCents ?? 0));
  const [active, setActive] = useState(initial?.active ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaved(false);

    const lead = parseIntField(leadTimeDays);
    const shippingFlatCents = parseDollars(flat);
    const shippingPerItemCents = parseDollars(perItem);
    if (lead === null) return setError("Enter lead time in whole days.");
    if (shippingFlatCents === null) return setError("Enter a valid flat shipping fee.");
    if (shippingPerItemCents === null) return setError("Enter a valid per-item shipping fee.");
    if (state.trim().length !== 2) return setError("State must be a 2-letter code.");

    const body = {
      name: name.trim(),
      slug: slug.trim(),
      contactEmail: contactEmail.trim(),
      phone: phone.trim() || null,
      city: city.trim(),
      state: state.trim(),
      leadTimeDays: lead,
      shippingFlatCents,
      shippingPerItemCents,
      active,
    };

    setBusy(true);
    const res =
      mode === "create"
        ? await sendJson<{ id: string }>("/api/admin/suppliers", "POST", body)
        : await sendJson<{ id: string }>(`/api/admin/suppliers/${supplierId}`, "PATCH", body);
    setBusy(false);

    if (!res.ok) {
      setError(res.error);
      return;
    }
    if (mode === "create") {
      setName(""); setSlug(""); setContactEmail(""); setPhone(""); setCity(""); setState("");
      setLeadTimeDays("3"); setFlat("9.99"); setPerItem("0.00"); setActive(true);
      if (collapsible) setOpen(false);
    }
    setSaved(true);
    router.refresh();
  };

  if (!open) {
    return (
      <button type="button" className="btn-primary" onClick={() => setOpen(true)}>
        + New supplier
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="card p-5">
      {mode === "create" && (
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">New supplier</h2>
          {collapsible && (
            <button type="button" className="text-sm text-slate-500 hover:underline" onClick={() => setOpen(false)}>
              Close
            </button>
          )}
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="sf-name">Name</label>
          <input id="sf-name" className="input" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div>
          <label className="label" htmlFor="sf-slug">Slug</label>
          <input id="sf-slug" className="input" value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="automax-parts" required />
        </div>
        <div>
          <label className="label" htmlFor="sf-email">Contact email</label>
          <input id="sf-email" className="input" type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} required />
        </div>
        <div>
          <label className="label" htmlFor="sf-phone">Phone (optional)</label>
          <input id="sf-phone" className="input" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="sf-city">City</label>
          <input id="sf-city" className="input" value={city} onChange={(e) => setCity(e.target.value)} required />
        </div>
        <div>
          <label className="label" htmlFor="sf-state">State (2-letter)</label>
          <input id="sf-state" className="input" maxLength={2} value={state} onChange={(e) => setState(e.target.value.toUpperCase())} required />
        </div>
        <div>
          <label className="label" htmlFor="sf-lead">Lead time (days)</label>
          <input id="sf-lead" className="input" inputMode="numeric" value={leadTimeDays} onChange={(e) => setLeadTimeDays(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="sf-flat">Shipping flat fee ($ per group)</label>
          <input id="sf-flat" className="input" inputMode="decimal" value={flat} onChange={(e) => setFlat(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="sf-per">Shipping per item ($)</label>
          <input id="sf-per" className="input" inputMode="decimal" value={perItem} onChange={(e) => setPerItem(e.target.value)} />
        </div>
        <div className="flex items-end pb-2">
          <label className="inline-flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            Active
          </label>
        </div>
      </div>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      {saved && <p className="mt-3 text-sm text-green-700">Saved.</p>}

      <div className="mt-5 flex justify-end">
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? "Saving…" : mode === "create" ? "Create supplier" : "Save changes"}
        </button>
      </div>
    </form>
  );
}
