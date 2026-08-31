import { describe, expect, it } from "vitest";
import { fitmentVerdict, type VehicleContext } from "@/lib/fitment";

const CAMRY = "model_camry";
const COROLLA = "model_corolla";
const I4 = "engine_25_i4";
const V6 = "engine_35_v6";

const normalPart = { universalFit: false };
const universalPart = { universalFit: true };

type Row = { modelId: string; yearFrom: number; yearTo: number; engineId: string | null };
const wildcardRow: Row = { modelId: CAMRY, yearFrom: 2018, yearTo: 2024, engineId: null };
const i4Row: Row = { modelId: CAMRY, yearFrom: 2018, yearTo: 2024, engineId: I4 };
const v6Row: Row = { modelId: CAMRY, yearFrom: 2008, yearTo: 2017, engineId: V6 };

const camry2019I4: VehicleContext = { modelId: CAMRY, year: 2019, engineId: I4 };
const camry2019NoEngine: VehicleContext = { modelId: CAMRY, year: 2019, engineId: null };

describe("fitmentVerdict matrix", () => {
  it("returns null when no vehicle is selected", () => {
    expect(fitmentVerdict(normalPart, [wildcardRow], null)).toBeNull();
    expect(fitmentVerdict(universalPart, [], null)).toBeNull();
  });

  it("returns UNIVERSAL for universal-fit parts regardless of fitment rows", () => {
    expect(fitmentVerdict(universalPart, [], camry2019I4)).toBe("UNIVERSAL");
    expect(fitmentVerdict(universalPart, [v6Row], camry2019I4)).toBe("UNIVERSAL");
  });

  it("FITS on an exact engine match", () => {
    expect(fitmentVerdict(normalPart, [i4Row], camry2019I4)).toBe("FITS");
  });

  it("FITS via a null-engine wildcard row (all engines of the model)", () => {
    expect(fitmentVerdict(normalPart, [wildcardRow], camry2019I4)).toBe("FITS");
    // wildcard also satisfies a customer with no engine chosen
    expect(fitmentVerdict(normalPart, [wildcardRow], camry2019NoEngine)).toBe("FITS");
  });

  it("VERIFY_ENGINE when only engine-specific rules match and no engine is chosen", () => {
    const i4Only: Row[] = [i4Row];
    expect(fitmentVerdict(normalPart, i4Only, camry2019NoEngine)).toBe("VERIFY_ENGINE");
    // as soon as a wildcard row exists, it's a clean FITS
    expect(fitmentVerdict(normalPart, [i4Row, wildcardRow], camry2019NoEngine)).toBe("FITS");
  });

  it("NO_FIT when the year is outside every rule's range", () => {
    // v6Row covers 2008-2017 only
    expect(fitmentVerdict(normalPart, [v6Row], { modelId: CAMRY, year: 2019, engineId: V6 })).toBe(
      "NO_FIT",
    );
    // boundary years are inclusive
    expect(fitmentVerdict(normalPart, [v6Row], { modelId: CAMRY, year: 2017, engineId: V6 })).toBe(
      "FITS",
    );
    expect(fitmentVerdict(normalPart, [v6Row], { modelId: CAMRY, year: 2008, engineId: V6 })).toBe(
      "FITS",
    );
  });

  it("NO_FIT when the vehicle's engine does not match any engine-specific rule", () => {
    expect(fitmentVerdict(normalPart, [v6Row], { modelId: CAMRY, year: 2015, engineId: I4 })).toBe(
      "NO_FIT",
    );
  });

  it("NO_FIT for a different model entirely", () => {
    expect(
      fitmentVerdict(normalPart, [wildcardRow, i4Row], { modelId: COROLLA, year: 2019, engineId: I4 }),
    ).toBe("NO_FIT");
  });

  it("NO_FIT for a non-universal part with no rows at all", () => {
    expect(fitmentVerdict(normalPart, [], camry2019I4)).toBe("NO_FIT");
  });
});
