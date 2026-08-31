import Link from "next/link";
import type { FitmentVerdict } from "@/lib/fitment";
import { formatCents } from "@/lib/money";

/**
 * Presentational catalog card (server-safe: no client hooks, no server libs).
 * Pages compute PartCardData (verdict + installFromCents) and pass it in.
 */
export interface PartCardData {
  id: string;
  slug: string;
  name: string;
  priceCents: number;
  imageUrl: string;
  brandName: string;
  installEligible: boolean;
  inStock: boolean;
  installFromCents: number | null;
  verdict: FitmentVerdict | null;
}

export function PartCard({ part }: { part: PartCardData }) {
  return (
    <Link
      href={`/parts/${part.slug}`}
      className="card group flex flex-col overflow-hidden transition hover:shadow-md"
    >
      <div className="relative aspect-[4/3] bg-slate-100">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={part.imageUrl}
          alt={part.name}
          className="h-full w-full object-cover transition group-hover:scale-[1.02]"
        />
        {!part.inStock && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/70">
            <span className="rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-white">
              Out of stock
            </span>
          </div>
        )}
        {(part.verdict === "FITS" || part.verdict === "UNIVERSAL") && (
          <span className="badge absolute left-2 top-2 bg-green-100 text-green-800">
            ✓ Fits your vehicle
          </span>
        )}
        {part.verdict === "VERIFY_ENGINE" && (
          <span className="badge absolute left-2 top-2 bg-amber-100 text-amber-800">
            ⚠ Verify engine
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1 p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{part.brandName}</p>
        <h3 className="line-clamp-2 text-sm font-semibold text-slate-900 group-hover:text-brand-700">
          {part.name}
        </h3>
        <div className="mt-auto flex items-center justify-between gap-2 pt-2">
          <span className="text-base font-bold text-slate-900">{formatCents(part.priceCents)}</span>
          {part.installEligible && part.installFromCents != null && (
            <span className="badge bg-brand-100 text-brand-800">
              🔧 Install from {formatCents(part.installFromCents)}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
