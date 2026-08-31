"use client";

/**
 * Create/edit form for catalog parts. Prices are entered in DOLLARS and
 * converted to integer cents on submit (Math.round(parseFloat * 100)).
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  centsToDollarInput,
  parseDollars,
  parseIntField,
  sendJson,
  type Option,
  type PartFormInitial,
} from "@/components/admin-crud/crud-shared";

interface PartFormProps {
  mode: "create" | "edit";
  partId?: string;
  initial?: PartFormInitial;
  categories: Option[];
  brands: Option[];
  suppliers: Option[];
}

export function PartForm({ mode, partId, initial, categories, brands, suppliers }: PartFormProps) {
  const router = useRouter();
  const [sku, setSku] = useState(initial?.sku ?? "");
  const [slug, setSlug] = useState(initial?.slug ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [imageUrl, setImageUrl] = useState(initial?.imageUrl ?? "");
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? "");
  const [brandId, setBrandId] = useState(initial?.brandId ?? "");
  const [supplierId, setSupplierId] = useState(initial?.supplierId ?? "");
  const [price, setPrice] = useState(centsToDollarInput(initial?.priceCents));
  const [cost, setCost] = useState(centsToDollarInput(initial?.supplierCostCents));
  const [weight, setWeight] = useState(String(initial?.weightGrams ?? 1000));
  const [installEligible, setInstallEligible] = useState(initial?.installEligible ?? true);
  const [laborTenths, setLaborTenths] = useState(String(initial?.laborHoursTenths ?? 10));
  const [fixedFee, setFixedFee] = useState(centsToDollarInput(initial?.installFixedFeeCents));
  const [universalFit, setUniversalFit] = useState(initial?.universalFit ?? false);
  const [inStock, setInStock] = useState(initial?.inStock ?? true);
  const [active, setActive] = useState(initial?.active ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaved(false);

    const priceCents = parseDollars(price);
    const supplierCostCents = parseDollars(cost);
    const weightGrams = parseIntField(weight);
    const laborHoursTenths = parseIntField(laborTenths);
    const installFixedFeeCents = fixedFee.trim() === "" ? null : parseDollars(fixedFee);

    if (priceCents === null || priceCents <= 0) return setError("Enter a valid retail price.");
    if (supplierCostCents === null) return setError("Enter a valid supplier cost.");
    if (weightGrams === null || weightGrams <= 0) return setError("Enter a valid weight in grams.");
    if (laborHoursTenths === null) return setError("Enter labor as whole tenths (e.g. 15 = 1.5h).");
    if (fixedFee.trim() !== "" && installFixedFeeCents === null) {
      return setError("Enter a valid fixed install fee or leave it blank.");
    }
    if (!categoryId || !brandId || !supplierId) {
      return setError("Category, brand and supplier are required.");
    }

    const body = {
      sku: sku.trim(),
      slug: slug.trim(),
      name: name.trim(),
      description: description.trim(),
      imageUrl: imageUrl.trim(),
      categoryId,
      brandId,
      supplierId,
      priceCents,
      supplierCostCents,
      weightGrams,
      installEligible,
      laborHoursTenths,
      installFixedFeeCents,
      universalFit,
      inStock,
      active,
    };

    setBusy(true);
    const res =
      mode === "create"
        ? await sendJson<{ id: string }>("/api/admin/parts", "POST", body)
        : await sendJson<{ id: string }>(`/api/admin/parts/${partId}`, "PATCH", body);
    setBusy(false);

    if (!res.ok) {
      setError(res.error);
      return;
    }
    if (mode === "create" && res.data) {
      router.push(`/admin/parts/${res.data.id}`);
      router.refresh();
    } else {
      setSaved(true);
      router.refresh();
    }
  };

  return (
    <form onSubmit={submit} className="card p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="pf-sku">SKU</label>
          <input id="pf-sku" className="input" value={sku} onChange={(e) => setSku(e.target.value)} required />
        </div>
        <div>
          <label className="label" htmlFor="pf-slug">Slug</label>
          <input id="pf-slug" className="input" value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="brake-pads-front" required />
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="pf-name">Name</label>
          <input id="pf-name" className="input" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="pf-desc">Description</label>
          <textarea id="pf-desc" className="input min-h-[90px]" value={description} onChange={(e) => setDescription(e.target.value)} required />
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="pf-img">Image URL (blank = category placeholder)</label>
          <input id="pf-img" className="input" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="/images/placeholders/brakes.svg" />
        </div>
        <div>
          <label className="label" htmlFor="pf-cat">Category</label>
          <select id="pf-cat" className="input" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} required>
            <option value="">Select…</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="pf-brand">Brand</label>
          <select id="pf-brand" className="input" value={brandId} onChange={(e) => setBrandId(e.target.value)} required>
            <option value="">Select…</option>
            {brands.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="pf-sup">Supplier</label>
          <select id="pf-sup" className="input" value={supplierId} onChange={(e) => setSupplierId(e.target.value)} required>
            <option value="">Select…</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="pf-weight">Weight (grams)</label>
          <input id="pf-weight" className="input" inputMode="numeric" value={weight} onChange={(e) => setWeight(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="pf-price">Retail price ($)</label>
          <input id="pf-price" className="input" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="129.99" required />
        </div>
        <div>
          <label className="label" htmlFor="pf-cost">Supplier cost ($)</label>
          <input id="pf-cost" className="input" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="74.50" required />
        </div>
        <div>
          <label className="label" htmlFor="pf-labor">Labor (tenths of an hour, 15 = 1.5h)</label>
          <input id="pf-labor" className="input" inputMode="numeric" value={laborTenths} onChange={(e) => setLaborTenths(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="pf-fee">Fixed install fee ($, blank = labor-based)</label>
          <input id="pf-fee" className="input" inputMode="decimal" value={fixedFee} onChange={(e) => setFixedFee(e.target.value)} placeholder="" />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-700">
        <label className="inline-flex items-center gap-2">
          <input type="checkbox" checked={installEligible} onChange={(e) => setInstallEligible(e.target.checked)} />
          Install eligible
        </label>
        <label className="inline-flex items-center gap-2">
          <input type="checkbox" checked={universalFit} onChange={(e) => setUniversalFit(e.target.checked)} />
          Universal fit (no fitment rules needed)
        </label>
        <label className="inline-flex items-center gap-2">
          <input type="checkbox" checked={inStock} onChange={(e) => setInStock(e.target.checked)} />
          In stock
        </label>
        <label className="inline-flex items-center gap-2">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          Active (visible in the store)
        </label>
      </div>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      {saved && <p className="mt-3 text-sm text-green-700">Saved.</p>}

      <div className="mt-5 flex justify-end gap-2">
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? "Saving…" : mode === "create" ? "Create part" : "Save changes"}
        </button>
      </div>
    </form>
  );
}
