"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { sendJson } from "./account-api";

export type GarageVehicle = {
  id: string;
  year: number;
  makeName: string;
  modelName: string;
  engineName: string | null;
  nickname: string | null;
};

type Option = { id: string; name: string };

const YEAR_MIN = 1990;
const YEAR_MAX = 2027;

/** Accepts either a bare array or {<key>: [...]} — tolerant of the M2 endpoint shape. */
function asOptions(data: unknown, key: string): Option[] {
  let list: unknown = data;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const rec = data as Record<string, unknown>;
    if (Array.isArray(rec[key])) list = rec[key];
    else if (Array.isArray(rec.items)) list = rec.items;
  }
  if (!Array.isArray(list)) return [];
  const out: Option[] = [];
  for (const row of list) {
    if (row && typeof row === "object") {
      const r = row as Record<string, unknown>;
      if (typeof r.id === "string" && typeof r.name === "string") {
        out.push({ id: r.id, name: r.name });
      }
    }
  }
  return out;
}

export function AccountVehicles({ vehicles }: { vehicles: GarageVehicle[] }) {
  const router = useRouter();

  const [makes, setMakes] = useState<Option[]>([]);
  const [models, setModels] = useState<Option[]>([]);
  const [engines, setEngines] = useState<Option[]>([]);
  const [makeId, setMakeId] = useState("");
  const [modelId, setModelId] = useState("");
  const [engineId, setEngineId] = useState("");
  const [year, setYear] = useState<string>("");
  const [nickname, setNickname] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const years = useMemo(() => {
    const ys: number[] = [];
    for (let y = YEAR_MAX; y >= YEAR_MIN; y--) ys.push(y);
    return ys;
  }, []);

  useEffect(() => {
    let cancelled = false;
    sendJson("/api/vehicles/makes", "GET").then((res) => {
      if (!cancelled && res.ok) setMakes(asOptions(res.data, "makes"));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setModels([]);
    setModelId("");
    setEngines([]);
    setEngineId("");
    if (!makeId) return;
    let cancelled = false;
    sendJson(`/api/vehicles/models?makeId=${encodeURIComponent(makeId)}`, "GET").then((res) => {
      if (!cancelled && res.ok) setModels(asOptions(res.data, "models"));
    });
    return () => {
      cancelled = true;
    };
  }, [makeId]);

  useEffect(() => {
    setEngines([]);
    setEngineId("");
    if (!modelId) return;
    let cancelled = false;
    sendJson(`/api/vehicles/engines?modelId=${encodeURIComponent(modelId)}`, "GET").then((res) => {
      if (!cancelled && res.ok) setEngines(asOptions(res.data, "engines"));
    });
    return () => {
      cancelled = true;
    };
  }, [modelId]);

  async function onAdd(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!modelId || !year) {
      setError("Pick a make, model and year");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await sendJson("/api/account/vehicles", "POST", {
      modelId,
      year: Number(year),
      ...(engineId ? { engineId } : {}),
      ...(nickname.trim() ? { nickname: nickname.trim() } : {}),
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setMakeId("");
    setModelId("");
    setEngineId("");
    setYear("");
    setNickname("");
    router.refresh();
  }

  async function onDelete(id: string) {
    setDeletingId(id);
    const res = await sendJson(`/api/account/vehicles/${id}`, "DELETE");
    setDeletingId(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <div className="card divide-y divide-slate-100">
        {vehicles.length === 0 && (
          <p className="p-6 text-sm text-slate-500">
            No vehicles yet — add one below so we can show parts that fit.
          </p>
        )}
        {vehicles.map((v) => (
          <div key={v.id} className="flex items-center justify-between gap-4 p-4">
            <div>
              <p className="font-medium text-slate-900">
                {v.year} {v.makeName} {v.modelName}
                {v.engineName ? ` · ${v.engineName}` : ""}
              </p>
              {v.nickname && <p className="text-sm text-slate-500">“{v.nickname}”</p>}
              {!v.engineName && (
                <p className="text-xs text-amber-700">
                  No engine selected — engine-specific parts will ask you to verify.
                </p>
              )}
            </div>
            <button
              type="button"
              className="btn-secondary text-red-600"
              onClick={() => onDelete(v.id)}
              disabled={deletingId === v.id}
            >
              {deletingId === v.id ? "Removing…" : "Remove"}
            </button>
          </div>
        ))}
      </div>

      <form onSubmit={onAdd} className="card space-y-4 p-6">
        <h2 className="text-lg font-semibold text-slate-900">Add a vehicle</h2>
        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
            {error}
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="veh-make">
              Make
            </label>
            <select
              id="veh-make"
              className="input"
              value={makeId}
              onChange={(e) => setMakeId(e.target.value)}
              required
            >
              <option value="">Select make…</option>
              {makes.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="veh-model">
              Model
            </label>
            <select
              id="veh-model"
              className="input"
              value={modelId}
              onChange={(e) => setModelId(e.target.value)}
              required
              disabled={!makeId}
            >
              <option value="">Select model…</option>
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="veh-year">
              Year
            </label>
            <select
              id="veh-year"
              className="input"
              value={year}
              onChange={(e) => setYear(e.target.value)}
              required
            >
              <option value="">Select year…</option>
              {years.map((y) => (
                <option key={y} value={String(y)}>
                  {y}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="veh-engine">
              Engine <span className="font-normal text-slate-400">(optional)</span>
            </label>
            <select
              id="veh-engine"
              className="input"
              value={engineId}
              onChange={(e) => setEngineId(e.target.value)}
              disabled={!modelId}
            >
              <option value="">Not sure / any engine</option>
              {engines.map((en) => (
                <option key={en.id} value={en.id}>
                  {en.name}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="veh-nickname">
              Nickname <span className="font-normal text-slate-400">(optional)</span>
            </label>
            <input
              id="veh-nickname"
              className="input"
              type="text"
              maxLength={60}
              placeholder="e.g. Daily driver"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
            />
          </div>
        </div>
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? "Adding…" : "Add to garage"}
        </button>
      </form>
    </div>
  );
}
