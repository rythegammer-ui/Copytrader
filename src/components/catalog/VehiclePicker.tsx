"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface Option {
  id: string;
  name: string;
}

export interface CurrentVehicle {
  makeId: string;
  modelId: string;
  year: number;
  engineId: string | null;
  label: string; // e.g. "2019 Toyota Camry 2.5L I4"
}

/**
 * Cascading Make -> Model -> Year -> Engine(optional) picker. The saved
 * selection lives on the cart (PUT /api/cart/vehicle) — the single source of
 * truth that server pages read via getCart().
 */
export function VehiclePicker({
  current,
  compact = false,
}: {
  current: CurrentVehicle | null;
  compact?: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(current === null);

  const [makes, setMakes] = useState<Option[]>([]);
  const [models, setModels] = useState<Option[]>([]);
  const [years, setYears] = useState<number[]>([]);
  const [engines, setEngines] = useState<Option[]>([]);

  const [makeId, setMakeId] = useState(current?.makeId ?? "");
  const [modelId, setModelId] = useState(current?.modelId ?? "");
  const [year, setYear] = useState(current ? String(current.year) : "");
  const [engineId, setEngineId] = useState(current?.engineId ?? "");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load makes when the editor opens.
  useEffect(() => {
    if (!editing) return;
    let alive = true;
    fetch("/api/vehicles/makes")
      .then((r) => r.json())
      .then((data: Option[]) => {
        if (alive && Array.isArray(data)) setMakes(data);
      })
      .catch(() => setError("Could not load vehicle data"));
    return () => {
      alive = false;
    };
  }, [editing]);

  // Cascade: make -> models.
  useEffect(() => {
    if (!editing || !makeId) {
      setModels([]);
      return;
    }
    let alive = true;
    fetch(`/api/vehicles/models?makeId=${encodeURIComponent(makeId)}`)
      .then((r) => r.json())
      .then((data: Option[]) => {
        if (alive && Array.isArray(data)) setModels(data);
      })
      .catch(() => setError("Could not load models"));
    return () => {
      alive = false;
    };
  }, [editing, makeId]);

  // Cascade: model -> years + engines.
  useEffect(() => {
    if (!editing || !modelId) {
      setYears([]);
      setEngines([]);
      return;
    }
    let alive = true;
    fetch(`/api/vehicles/years?modelId=${encodeURIComponent(modelId)}`)
      .then((r) => r.json())
      .then((data: { years?: number[] }) => {
        if (alive && Array.isArray(data.years)) setYears(data.years);
      })
      .catch(() => setError("Could not load years"));
    fetch(`/api/vehicles/engines?modelId=${encodeURIComponent(modelId)}`)
      .then((r) => r.json())
      .then((data: Option[]) => {
        if (alive && Array.isArray(data)) setEngines(data);
      })
      .catch(() => setError("Could not load engines"));
    return () => {
      alive = false;
    };
  }, [editing, modelId]);

  const save = useCallback(async () => {
    if (!modelId || !year) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/cart/vehicle", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          modelId,
          year: parseInt(year, 10),
          engineId: engineId || null,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        setError(body?.error?.message ?? "Could not save your vehicle");
        return;
      }
      setEditing(false);
      router.refresh();
    } catch {
      setError("Could not save your vehicle");
    } finally {
      setBusy(false);
    }
  }, [modelId, year, engineId, router]);

  const clear = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/cart/vehicle", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelId: null, year: null, engineId: null }),
      });
      if (res.ok) {
        setMakeId("");
        setModelId("");
        setYear("");
        setEngineId("");
        setEditing(true);
        router.refresh();
      }
    } catch {
      setError("Could not clear your vehicle");
    } finally {
      setBusy(false);
    }
  }, [router]);

  if (current && !editing) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="badge bg-green-100 text-green-800">🚗 {current.label}</span>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="text-sm font-medium text-brand-700 hover:underline"
        >
          Change
        </button>
        <button
          type="button"
          onClick={clear}
          disabled={busy}
          className="text-sm font-medium text-slate-500 hover:underline disabled:opacity-50"
        >
          Clear
        </button>
      </div>
    );
  }

  return (
    <div className={compact ? "" : "space-y-3"}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <select
          className="input"
          aria-label="Make"
          value={makeId}
          onChange={(e) => {
            setMakeId(e.target.value);
            setModelId("");
            setYear("");
            setEngineId("");
          }}
        >
          <option value="">Make</option>
          {makes.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        <select
          className="input"
          aria-label="Model"
          value={modelId}
          disabled={!makeId}
          onChange={(e) => {
            setModelId(e.target.value);
            setYear("");
            setEngineId("");
          }}
        >
          <option value="">Model</option>
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        <select
          className="input"
          aria-label="Year"
          value={year}
          disabled={!modelId}
          onChange={(e) => setYear(e.target.value)}
        >
          <option value="">Year</option>
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
        <select
          className="input"
          aria-label="Engine (optional)"
          value={engineId}
          disabled={!modelId}
          onChange={(e) => setEngineId(e.target.value)}
        >
          <option value="">Engine (optional)</option>
          {engines.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <button type="button" onClick={save} disabled={busy || !modelId || !year} className="btn-primary">
          {busy ? "Saving…" : "Save vehicle"}
        </button>
        {current && (
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="text-sm font-medium text-slate-500 hover:underline"
          >
            Cancel
          </button>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    </div>
  );
}
