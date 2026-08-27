import { describe, expect, test } from "bun:test";
import {
  combineEnsembleSignals,
  formatEnsembleSignal,
  type EnsembleSignal,
} from "./ensemble-signal-combiner.ts";

describe("combineEnsembleSignals", () => {
  test("fewer than minSources → insufficient_data", () => {
    const r = combineEnsembleSignals([{ id: "A", value: 0.5 }]);
    expect(r.verdict).toBe("insufficient_data");
  });

  test("all values neutral → neutral verdict", () => {
    const r = combineEnsembleSignals([
      { id: "A", value: 0 },
      { id: "B", value: 0 },
      { id: "C", value: 0 },
    ]);
    expect(r.verdict).toBe("neutral");
    expect(r.compositeScore).toBe(0);
    expect(r.direction).toBe("neutral");
  });

  test("unanimous strong long → strong_long", () => {
    const r = combineEnsembleSignals([
      { id: "A", value: 0.8 },
      { id: "B", value: 0.9 },
      { id: "C", value: 0.7 },
    ]);
    expect(r.verdict).toBe("strong_long");
    expect(r.direction).toBe("long");
    expect(r.compositeScore).toBeCloseTo(0.8, 1);
    expect(r.agreementFraction).toBeCloseTo(1, 4);
  });

  test("unanimous strong short → strong_short", () => {
    const r = combineEnsembleSignals([
      { id: "A", value: -0.8 },
      { id: "B", value: -0.7 },
      { id: "C", value: -0.9 },
    ]);
    expect(r.verdict).toBe("strong_short");
    expect(r.direction).toBe("short");
    expect(r.compositeScore).toBeCloseTo(-0.8, 1);
  });

  test("modest agreement → weak verdict band", () => {
    const r = combineEnsembleSignals([
      { id: "A", value: 0.3 },
      { id: "B", value: 0.4 },
      { id: "C", value: 0.2 },
    ]);
    expect(r.verdict).toBe("weak_long");
    expect(r.compositeScore).toBeCloseTo(0.3, 1);
  });

  test("disagreement: high composite but low agreement → disagreement verdict", () => {
    // One huge weight overwhelms many small opposites:
    // composite = (15×1 + 4×-0.5) / 19 = 13/19 ≈ 0.684 (strong band)
    // agreement = 1/5 = 0.2 (below default 0.6 threshold)
    const r = combineEnsembleSignals([
      { id: "DOMINANT", value: 1.0, weight: 15 },
      { id: "OPP1", value: -0.5, weight: 1 },
      { id: "OPP2", value: -0.5, weight: 1 },
      { id: "OPP3", value: -0.5, weight: 1 },
      { id: "OPP4", value: -0.5, weight: 1 },
    ]);
    expect(r.compositeScore).toBeGreaterThan(0.6); // strong band
    expect(r.agreementFraction).toBeLessThan(0.6); // 1/5 = 0.2
    expect(r.verdict).toBe("disagreement");
  });

  test("weights bias the composite", () => {
    const r = combineEnsembleSignals([
      { id: "BIG", value: 1.0, weight: 10 },
      { id: "small", value: -1.0, weight: 1 },
    ]);
    // Weighted composite: (10×1 + 1×-1) / 11 = 9/11 ≈ 0.818
    expect(r.compositeScore).toBeCloseTo(9 / 11, 4);
    expect(r.direction).toBe("long");
  });

  test("clips out-of-range values to [-1, +1] by default", () => {
    const r = combineEnsembleSignals([
      { id: "X", value: 2.5 },
      { id: "Y", value: -3.0 },
    ]);
    expect(r.perSource.find((p) => p.id === "X")!.value).toBe(1);
    expect(r.perSource.find((p) => p.id === "Y")!.value).toBe(-1);
  });

  test("rejects out-of-range when clipOutOfRange=false", () => {
    const r = combineEnsembleSignals(
      [
        { id: "X", value: 2.5 },
        { id: "Y", value: -3.0 },
        { id: "Z", value: 0.5 },
      ],
      { clipOutOfRange: false },
    );
    // Only Z is valid; below minSources
    expect(r.verdict).toBe("insufficient_data");
  });

  test("continuousPositionFraction equals compositeScore", () => {
    const r = combineEnsembleSignals([
      { id: "A", value: 0.4 },
      { id: "B", value: 0.6 },
      { id: "C", value: 0.5 },
    ]);
    expect(r.continuousPositionFraction).toBeCloseTo(r.compositeScore, 6);
  });

  test("agreementFraction counts neutral sources as agreeing", () => {
    const r = combineEnsembleSignals([
      { id: "LONG1", value: 0.7 },
      { id: "LONG2", value: 0.5 },
      { id: "NEUTRAL", value: 0 },
    ]);
    expect(r.agreementFraction).toBe(1); // all "agree" with long
  });

  test("custom thresholds shift the verdict bands", () => {
    const signals: EnsembleSignal[] = [
      { id: "A", value: 0.4 },
      { id: "B", value: 0.5 },
      { id: "C", value: 0.3 },
    ];
    const def = combineEnsembleSignals(signals);
    const strict = combineEnsembleSignals(signals, {
      weakThreshold: 0.5,
      strongThreshold: 0.8,
    });
    expect(def.verdict).toBe("weak_long");
    // Under strict thresholds, composite ~0.4 is below weak=0.5 → neutral
    expect(strict.verdict).toBe("neutral");
  });

  test("invalid threshold ordering → insufficient_data", () => {
    const r = combineEnsembleSignals(
      [
        { id: "A", value: 0.5 },
        { id: "B", value: 0.5 },
        { id: "C", value: 0.5 },
      ],
      { weakThreshold: 0.7, strongThreshold: 0.5 },
    );
    expect(r.verdict).toBe("insufficient_data");
  });

  test("perSource preserves order + IDs + descriptions", () => {
    const r = combineEnsembleSignals([
      { id: "cs_momentum", value: 0.6, description: "top decile" },
      { id: "fip_quality", value: 0.4, description: "smooth" },
      { id: "agg_ratio", value: 0.3, description: "taker buys dominant" },
    ]);
    expect(r.perSource.map((p) => p.id)).toEqual(["cs_momentum", "fip_quality", "agg_ratio"]);
    expect(r.perSource[0]!.description).toBe("top decile");
  });

  test("zero-weight sources are excluded from totalWeight", () => {
    const r = combineEnsembleSignals([
      { id: "A", value: 1.0, weight: 1 },
      { id: "B", value: -1.0, weight: 0 }, // ignored
      { id: "C", value: 1.0, weight: 1 },
    ]);
    // Effective: (1×1 + 0×-1 + 1×1) / (1 + 0 + 1) = 2/2 = 1
    expect(r.compositeScore).toBeCloseTo(1, 6);
  });

  test("all-zero-weight inputs → insufficient_data", () => {
    const r = combineEnsembleSignals([
      { id: "A", value: 0.5, weight: 0 },
      { id: "B", value: 0.5, weight: 0 },
      { id: "C", value: 0.5, weight: 0 },
    ]);
    expect(r.verdict).toBe("insufficient_data");
  });

  test("non-finite values are rejected", () => {
    const r = combineEnsembleSignals([
      { id: "BAD1", value: NaN },
      { id: "BAD2", value: Infinity },
      { id: "GOOD1", value: 0.5 },
      { id: "GOOD2", value: 0.4 },
    ]);
    expect(r.validSources).toBe(2);
    expect(r.verdict).toBe("weak_long");
  });

  test("realistic multi-primitive composite scenario", () => {
    // Simulates feeding outputs from multiple Gordon primitives:
    // cross-sectional momentum says +0.7 (top decile)
    // fip-quality says +0.5 (smooth)
    // aggression-ratio says +0.6 (taker-buys dominant)
    // ma-crossover-cleanness says +0.4 (clean trend)
    // vol-pattern-edge says -0.2 (flat volume — mild MR bias)
    const r = combineEnsembleSignals([
      { id: "cs_mom", value: 0.7, weight: 1.5 },
      { id: "fip", value: 0.5 },
      { id: "agg_ratio", value: 0.6 },
      { id: "ma_clean", value: 0.4 },
      { id: "vol_pattern", value: -0.2 },
    ]);
    expect(r.direction).toBe("long");
    expect(r.verdict).toMatch(/long/);
    expect(r.continuousPositionFraction).toBeGreaterThan(0);
  });
});

describe("formatEnsembleSignal", () => {
  test("renders verdict + per-source rows", () => {
    const r = combineEnsembleSignals([
      { id: "A", value: 0.7 },
      { id: "B", value: 0.6 },
      { id: "C", value: 0.5 },
    ]);
    const text = formatEnsembleSignal(r);
    expect(text).toContain("Ensemble Signal");
    expect(text).toContain("Composite score");
    expect(text).toContain("Per-source");
  });

  test("renders [opp] markers for opposing sources", () => {
    const r = combineEnsembleSignals([
      { id: "BIG", value: 1.0, weight: 10 },
      { id: "OPP", value: -1.0, weight: 1 },
    ]);
    const text = formatEnsembleSignal(r);
    expect(text).toContain("[opp]");
  });
});
