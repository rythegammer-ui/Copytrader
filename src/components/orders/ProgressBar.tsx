/**
 * Horizontal order-progress bar: Placed -> Paid -> Shipped -> Delivered ->
 * (Installed) -> Complete. Pure presentational — usable from server
 * components; the page computes each step's `done` flag.
 */
export interface ProgressStep {
  label: string;
  done: boolean;
}

export function ProgressBar({ steps }: { steps: ProgressStep[] }) {
  const currentIdx = steps.findIndex((s) => !s.done);
  return (
    <ol className="flex items-start">
      {steps.map((s, i) => {
        const isCurrent = i === currentIdx;
        const isFuture = currentIdx !== -1 && i > currentIdx;
        return (
          <li key={s.label} className={`flex items-start ${i < steps.length - 1 ? "flex-1" : ""}`}>
            <div className="flex w-16 flex-col items-center sm:w-20">
              <span
                className={`flex h-8 w-8 items-center justify-center rounded-full border-2 text-xs font-bold ${
                  s.done
                    ? "border-brand-600 bg-brand-600 text-white"
                    : isCurrent
                      ? "border-brand-600 bg-white text-brand-700"
                      : "border-slate-200 bg-white text-slate-300"
                }`}
              >
                {s.done ? "✓" : i + 1}
              </span>
              <span
                className={`mt-1.5 text-center text-[11px] font-medium leading-tight sm:text-xs ${
                  s.done ? "text-slate-900" : isCurrent ? "text-brand-700" : "text-slate-400"
                }`}
              >
                {s.label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div
                className={`mt-4 h-0.5 flex-1 rounded ${
                  s.done && !isFuture ? "bg-brand-600" : "bg-slate-200"
                }`}
                aria-hidden
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
