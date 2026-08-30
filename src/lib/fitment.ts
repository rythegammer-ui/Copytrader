import type { Prisma } from "@prisma/client";

/**
 * Fitment = year-range rules per part against Make -> VehicleModel -> Engine.
 * engineId NULL on a Fitment row means "all engines of that model".
 * Part.universalFit bypasses fitment entirely.
 */

export interface VehicleContext {
  modelId: string;
  year: number;
  engineId?: string | null;
}

/**
 * Prisma where-clause fragment selecting parts compatible with the vehicle.
 * When the customer picked no engine, engine-specific rows still match (the
 * UI badges those "verify engine" via fitmentVerdict below).
 */
export function compatibleWhere(vehicle: VehicleContext): Prisma.PartWhereInput {
  return {
    OR: [
      { universalFit: true },
      {
        fitments: {
          some: {
            modelId: vehicle.modelId,
            yearFrom: { lte: vehicle.year },
            yearTo: { gte: vehicle.year },
            ...(vehicle.engineId
              ? { OR: [{ engineId: null }, { engineId: vehicle.engineId }] }
              : {}),
          },
        },
      },
    ],
  };
}

export type FitmentVerdict = "FITS" | "VERIFY_ENGINE" | "NO_FIT" | "UNIVERSAL";

/**
 * Verdict for one part given its fitment rows and the selected vehicle.
 * - UNIVERSAL: universal-fit part.
 * - FITS: an exact rule matches (engine wildcard, or matching engine).
 * - VERIFY_ENGINE: only engine-specific rules match and the customer hasn't
 *   picked an engine — show, but badge "verify engine".
 * - NO_FIT: no rule matches.
 */
export function fitmentVerdict(
  part: { universalFit: boolean },
  fitments: Array<{ modelId: string; yearFrom: number; yearTo: number; engineId: string | null }>,
  vehicle: VehicleContext | null,
): FitmentVerdict | null {
  if (!vehicle) return null; // no vehicle selected — no verdict
  if (part.universalFit) return "UNIVERSAL";
  const rows = fitments.filter(
    (f) => f.modelId === vehicle.modelId && f.yearFrom <= vehicle.year && f.yearTo >= vehicle.year,
  );
  if (rows.length === 0) return "NO_FIT";
  if (vehicle.engineId) {
    return rows.some((f) => f.engineId === null || f.engineId === vehicle.engineId)
      ? "FITS"
      : "NO_FIT";
  }
  return rows.some((f) => f.engineId === null) ? "FITS" : "VERIFY_ENGINE";
}
