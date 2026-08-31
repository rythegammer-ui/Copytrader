"use client";

/**
 * Tabbed taxonomy manager: Categories / Brands / Makes / Models / Engines.
 * Lists come server-rendered via props; adds POST /api/admin/taxonomy/[kind]
 * and refresh the page data.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { sendJson, type MakeNode } from "@/components/admin-crud/crud-shared";

export interface CategoryNode {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  children: CategoryNode[];
}

export interface BrandRow {
  id: string;
  name: string;
  slug: string;
}

interface TaxonomyManagerProps {
  categories: CategoryNode[];
  brands: BrandRow[];
  makes: MakeNode[];
}

const TABS = ["Categories", "Brands", "Makes", "Models", "Engines"] as const;
type Tab = (typeof TABS)[number];

const SINGULAR: Record<Tab, string> = {
  Categories: "category",
  Brands: "brand",
  Makes: "make",
  Models: "model",
  Engines: "engine",
};

export function TaxonomyManager({ categories, brands, makes }: TaxonomyManagerProps) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("Categories");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // form state (shared across tabs; cleared on submit)
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [parentId, setParentId] = useState("");
  const [makeId, setMakeId] = useState("");
  const [modelId, setModelId] = useState("");

  const selectedMake = makes.find((m) => m.id === makeId) ?? null;
  const selectedModel = selectedMake?.models.find((m) => m.id === modelId) ?? null;

  const post = async (kind: string, body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    const res = await sendJson(`/api/admin/taxonomy/${kind}`, "POST", body);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setName("");
    setSlug("");
    router.refresh();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) return setError("Name is required.");
    switch (tab) {
      case "Categories":
        if (!slug.trim()) return setError("Slug is required.");
        return post("category", { name: n, slug: slug.trim(), parentId: parentId || null });
      case "Brands":
        if (!slug.trim()) return setError("Slug is required.");
        return post("brand", { name: n, slug: slug.trim() });
      case "Makes":
        return post("make", { name: n });
      case "Models":
        if (!makeId) return setError("Pick a make.");
        return post("model", { makeId, name: n });
      case "Engines":
        if (!modelId) return setError("Pick a make and model.");
        return post("engine", { modelId, name: n });
    }
  };

  const switchTab = (t: Tab) => {
    setTab(t);
    setError(null);
    setName("");
    setSlug("");
    setParentId("");
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-1">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => switchTab(t)}
            className={`rounded-full px-3 py-1 text-sm font-medium transition ${
              tab === t
                ? "bg-slate-900 text-white"
                : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* ---------- listing ---------- */}
        <div className="card p-5">
          {tab === "Categories" && (
            <ul className="space-y-1 text-sm">
              {categories.map((c) => (
                <li key={c.id}>
                  <span className="font-medium text-slate-900">{c.name}</span>{" "}
                  <span className="text-xs text-slate-400">/{c.slug}</span>
                  {c.children.length > 0 && (
                    <ul className="ml-4 mt-1 space-y-1 border-l border-slate-200 pl-3">
                      {c.children.map((ch) => (
                        <li key={ch.id} className="text-slate-700">
                          {ch.name} <span className="text-xs text-slate-400">/{ch.slug}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
              {categories.length === 0 && <li className="text-slate-500">No categories yet.</li>}
            </ul>
          )}

          {tab === "Brands" && (
            <ul className="space-y-1 text-sm">
              {brands.map((b) => (
                <li key={b.id} className="text-slate-900">
                  {b.name} <span className="text-xs text-slate-400">/{b.slug}</span>
                </li>
              ))}
              {brands.length === 0 && <li className="text-slate-500">No brands yet.</li>}
            </ul>
          )}

          {tab === "Makes" && (
            <ul className="space-y-1 text-sm">
              {makes.map((m) => (
                <li key={m.id} className="text-slate-900">
                  {m.name}{" "}
                  <span className="text-xs text-slate-400">
                    {m.models.length} model{m.models.length === 1 ? "" : "s"}
                  </span>
                </li>
              ))}
              {makes.length === 0 && <li className="text-slate-500">No makes yet.</li>}
            </ul>
          )}

          {tab === "Models" && (
            <ul className="space-y-2 text-sm">
              {(makeId ? makes.filter((m) => m.id === makeId) : makes).map((m) => (
                <li key={m.id}>
                  <p className="font-medium text-slate-900">{m.name}</p>
                  <p className="ml-3 text-slate-600">
                    {m.models.length > 0 ? m.models.map((mo) => mo.name).join(", ") : "—"}
                  </p>
                </li>
              ))}
            </ul>
          )}

          {tab === "Engines" && (
            <div className="text-sm">
              {selectedModel ? (
                <>
                  <p className="mb-1 font-medium text-slate-900">
                    {selectedMake?.name} {selectedModel.name}
                  </p>
                  <ul className="space-y-1">
                    {selectedModel.engines.map((e) => (
                      <li key={e.id} className="text-slate-700">{e.name}</li>
                    ))}
                    {selectedModel.engines.length === 0 && (
                      <li className="text-slate-500">No engines yet for this model.</li>
                    )}
                  </ul>
                </>
              ) : (
                <p className="text-slate-500">Pick a make and model to see its engines.</p>
              )}
            </div>
          )}
        </div>

        {/* ---------- add form ---------- */}
        <form onSubmit={submit} className="card h-fit p-5">
          <h2 className="mb-3 text-lg font-semibold text-slate-900">
            Add {SINGULAR[tab]}
          </h2>

          {(tab === "Models" || tab === "Engines") && (
            <div className="mb-3">
              <label className="label" htmlFor="tx-make">Make</label>
              <select
                id="tx-make"
                className="input"
                value={makeId}
                onChange={(e) => {
                  setMakeId(e.target.value);
                  setModelId("");
                }}
              >
                <option value="">Select…</option>
                {makes.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            </div>
          )}

          {tab === "Engines" && (
            <div className="mb-3">
              <label className="label" htmlFor="tx-model">Model</label>
              <select
                id="tx-model"
                className="input"
                value={modelId}
                onChange={(e) => setModelId(e.target.value)}
                disabled={!selectedMake}
              >
                <option value="">Select…</option>
                {(selectedMake?.models ?? []).map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            </div>
          )}

          {tab === "Categories" && (
            <div className="mb-3">
              <label className="label" htmlFor="tx-parent">Parent category (optional)</label>
              <select id="tx-parent" className="input" value={parentId} onChange={(e) => setParentId(e.target.value)}>
                <option value="">None (top level)</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          )}

          <div className="mb-3">
            <label className="label" htmlFor="tx-name">Name</label>
            <input id="tx-name" className="input" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>

          {(tab === "Categories" || tab === "Brands") && (
            <div className="mb-3">
              <label className="label" htmlFor="tx-slug">Slug</label>
              <input id="tx-slug" className="input" value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="lowercase-with-dashes" required />
            </div>
          )}

          {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? "Adding…" : "Add"}
          </button>
        </form>
      </div>
    </div>
  );
}
