"use client";

/**
 * Fitment editor for the admin part page: current rules table with delete,
 * plus an add-row form with cascading Make -> Model -> Engine selects.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  parseIntField,
  sendJson,
  type FitmentRow,
  type MakeNode,
} from "@/components/admin-crud/crud-shared";

interface FitmentEditorProps {
  partId: string;
  universalFit: boolean;
  fitments: FitmentRow[];
  makes: MakeNode[];
}

export function FitmentEditor({ partId, universalFit, fitments, makes }: FitmentEditorProps) {
  const router = useRouter();
  const [makeId, setMakeId] = useState("");
  const [modelId, setModelId] = useState("");
  const [engineId, setEngineId] = useState("");
  const [yearFrom, setYearFrom] = useState("");
  const [yearTo, setYearTo] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedMake = makes.find((m) => m.id === makeId) ?? null;
  const selectedModel = selectedMake?.models.find((m) => m.id === modelId) ?? null;

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const from = parseIntField(yearFrom);
    const to = parseIntField(yearTo);
    if (!modelId) return setError("Pick a make and model.");
    if (from === null || to === null) return setError("Enter both years (e.g. 2015).");
    if (to < from) return setError("Year to must be ≥ year from.");

    setBusy(true);
    const res = await sendJson(`/api/admin/parts/${partId}/fitments`, "POST", {
      modelId,
      yearFrom: from,
      yearTo: to,
      engineId: engineId || null,
      notes: notes.trim() || null,
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setEngineId("");
    setYearFrom("");
    setYearTo("");
    setNotes("");
    router.refresh();
  };

  const remove = async (id: string) => {
    setError(null);
    setDeletingId(id);
    const res = await sendJson(`/api/admin/fitments/${id}`, "DELETE");
    setDeletingId(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    router.refresh();
  };

  return (
    <div className="card p-5">
      <h2 className="text-lg font-semibold text-slate-900">Fitment rules</h2>
      {universalFit && (
        <p className="mt-1 text-sm text-amber-700">
          This part is marked universal fit — fitment rules below are ignored by the matcher.
        </p>
      )}

      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              <th className="px-3 py-2">Vehicle</th>
              <th className="px-3 py-2">Years</th>
              <th className="px-3 py-2">Engine</th>
              <th className="px-3 py-2">Notes</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {fitments.map((f) => (
              <tr key={f.id}>
                <td className="px-3 py-2 text-slate-900">
                  {f.makeName} {f.modelName}
                </td>
                <td className="px-3 py-2 text-slate-600">
                  {f.yearFrom}–{f.yearTo}
                </td>
                <td className="px-3 py-2 text-slate-600">{f.engineName ?? "All engines"}</td>
                <td className="px-3 py-2 text-slate-500">{f.notes ?? "—"}</td>
                <td className="px-3 py-2 text-right">
                  <button
                    type="button"
                    className="text-sm font-medium text-red-600 hover:underline disabled:opacity-50"
                    onClick={() => remove(f.id)}
                    disabled={deletingId === f.id}
                  >
                    {deletingId === f.id ? "Removing…" : "Delete"}
                  </button>
                </td>
              </tr>
            ))}
            {fitments.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-slate-500">
                  No fitment rules yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <form onSubmit={add} className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
        <p className="mb-3 text-sm font-medium text-slate-700">Add fitment rule</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className="label" htmlFor="ft-make">Make</label>
            <select
              id="ft-make"
              className="input"
              value={makeId}
              onChange={(e) => {
                setMakeId(e.target.value);
                setModelId("");
                setEngineId("");
              }}
            >
              <option value="">Select…</option>
              {makes.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="ft-model">Model</label>
            <select
              id="ft-model"
              className="input"
              value={modelId}
              onChange={(e) => {
                setModelId(e.target.value);
                setEngineId("");
              }}
              disabled={!selectedMake}
            >
              <option value="">Select…</option>
              {(selectedMake?.models ?? []).map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="ft-engine">Engine (optional)</label>
            <select
              id="ft-engine"
              className="input"
              value={engineId}
              onChange={(e) => setEngineId(e.target.value)}
              disabled={!selectedModel}
            >
              <option value="">All engines</option>
              {(selectedModel?.engines ?? []).map((en) => (
                <option key={en.id} value={en.id}>{en.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="ft-from">Year from</label>
            <input id="ft-from" className="input" inputMode="numeric" value={yearFrom} onChange={(e) => setYearFrom(e.target.value)} placeholder="2015" />
          </div>
          <div>
            <label className="label" htmlFor="ft-to">Year to</label>
            <input id="ft-to" className="input" inputMode="numeric" value={yearTo} onChange={(e) => setYearTo(e.target.value)} placeholder="2020" />
          </div>
          <div>
            <label className="label" htmlFor="ft-notes">Notes (optional)</label>
            <input id="ft-notes" className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Excl. TRD trim" />
          </div>
        </div>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        <div className="mt-3 flex justify-end">
          <button type="submit" className="btn-secondary" disabled={busy}>
            {busy ? "Adding…" : "Add rule"}
          </button>
        </div>
      </form>
    </div>
  );
}
