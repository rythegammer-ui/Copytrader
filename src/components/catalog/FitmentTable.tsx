/**
 * Fitment table for the part detail page (server component).
 * Rows are pre-formatted by the page: vehicle "Make Model", years "2018–2022",
 * engine name or "All engines", optional notes.
 */
export interface FitmentRow {
  id: string;
  vehicle: string;
  years: string;
  engine: string;
  notes: string | null;
}

export function FitmentTable({ rows, universalFit }: { rows: FitmentRow[]; universalFit: boolean }) {
  if (universalFit) {
    return (
      <p className="rounded-lg bg-green-50 px-4 py-3 text-sm text-green-800">
        Universal fit — this part fits all vehicles.
      </p>
    );
  }
  if (rows.length === 0) {
    return <p className="text-sm text-slate-500">No fitment data recorded for this part.</p>;
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-2">Vehicle</th>
            <th className="px-4 py-2">Years</th>
            <th className="px-4 py-2">Engine</th>
            <th className="px-4 py-2">Notes</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white">
          {rows.map((row) => (
            <tr key={row.id}>
              <td className="px-4 py-2 font-medium text-slate-900">{row.vehicle}</td>
              <td className="px-4 py-2 text-slate-700">{row.years}</td>
              <td className="px-4 py-2 text-slate-700">{row.engine}</td>
              <td className="px-4 py-2 text-slate-500">{row.notes ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
