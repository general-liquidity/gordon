import { describe, it, expect } from "bun:test";
import {
  isVolRegimeConvergenceEnabled,
  evaluateVolRegimeConvergence,
  convergenceToPayload,
  VOL_REGIME_CONVERGENCE_FLAG_ENV,
} from "./volRegimeConvergence.ts";
import type { KalmanVolatilityResult } from "./kalmanVolatility.ts";
import type { MarkovRegimeResult, MarkovState } from "./markovRegime.ts";

describe("isVolRegimeConvergenceEnabled", () => {
  it("respects the flag", () => {
    expect(isVolRegimeConvergenceEnabled({})).toBe(false);
    expect(
      isVolRegimeConvergenceEnabled({ [VOL_REGIME_CONVERGENCE_FLAG_ENV]: "1" }),
    ).toBe(true);
  });
});

function mkVol(opts: { current: number; mean: number; min: number; max: number }): KalmanVolatilityResult {
  return {
    variance: [],
    annualVol: [],
    currentAnnualVol: opts.current,
    currentVariance: opts.current * opts.current,
    minAnnualVol: opts.min,
    maxAnnualVol: opts.max,
    meanAnnualVol: opts.mean,
    sampleSize: 100,
  };
}

function mkRegime(opts: {
  current: MarkovState;
  predicted: MarkovState;
  confidence: number;
  signal?: MarkovRegimeResult["signal"];
}): MarkovRegimeResult {
  return {
    currentState: opts.current,
    transitionProbabilities: { bull: 0.33, neutral: 0.34, bear: 0.33 },
    predictedNextState: opts.predicted,
    confidence: opts.confidence,
    transitionMatrix: {
      matrix: {
        bull: { bull: 0.33, neutral: 0.34, bear: 0.33 },
        neutral: { bull: 0.33, neutral: 0.34, bear: 0.33 },
        bear: { bull: 0.33, neutral: 0.34, bear: 0.33 },
      },
      observations: 100,
      smoothingAlpha: 0.1,
    },
    stateHistory: [],
    regimeStrength: 0.5,
    signal: opts.signal ?? "stay",
    summary: "",
  };
}

describe("evaluateVolRegimeConvergence — four verdicts", () => {
  it("vol high + regime bear → aligned_storm, risk_off", () => {
    const r = evaluateVolRegimeConvergence({
      vol: mkVol({ current: 0.45, mean: 0.20, min: 0.10, max: 0.50 }),
      regime: mkRegime({ current: "bear", predicted: "bear", confidence: 0.8 }),
    });
    expect(r.verdict).toBe("aligned_storm");
    expect(r.suggestedAction).toBe("risk_off");
  });

  it("vol low + regime bull → aligned_calm, risk_on", () => {
    const r = evaluateVolRegimeConvergence({
      vol: mkVol({ current: 0.10, mean: 0.20, min: 0.10, max: 0.50 }),
      regime: mkRegime({ current: "bull", predicted: "bull", confidence: 0.8 }),
    });
    expect(r.verdict).toBe("aligned_calm");
    expect(r.suggestedAction).toBe("risk_on");
  });

  it("vol calm + regime flipping to bear → regime_only, risk_off", () => {
    const r = evaluateVolRegimeConvergence({
      vol: mkVol({ current: 0.18, mean: 0.20, min: 0.10, max: 0.50 }),
      regime: mkRegime({
        current: "neutral",
        predicted: "bear",
        confidence: 0.7,
        signal: "reversal_likely",
      }),
    });
    expect(r.verdict).toBe("regime_only");
    expect(r.suggestedAction).toBe("risk_off");
  });

  it("vol spike + regime stable bull → surface_only, investigate", () => {
    const r = evaluateVolRegimeConvergence({
      vol: mkVol({ current: 0.45, mean: 0.20, min: 0.10, max: 0.50 }),
      regime: mkRegime({ current: "bull", predicted: "bull", confidence: 0.85 }),
    });
    expect(r.verdict).toBe("surface_only");
    expect(r.suggestedAction).toBe("investigate");
  });

  it("vol neutral + regime neutral → aligned_calm (calm side)", () => {
    const r = evaluateVolRegimeConvergence({
      vol: mkVol({ current: 0.20, mean: 0.20, min: 0.10, max: 0.30 }),
      regime: mkRegime({ current: "neutral", predicted: "neutral", confidence: 0.6 }),
    });
    expect(r.verdict).toBe("aligned_calm");
  });
});

describe("evaluateVolRegimeConvergence — confidence floor", () => {
  it("low-confidence regime flip is ignored", () => {
    const r = evaluateVolRegimeConvergence({
      vol: mkVol({ current: 0.18, mean: 0.20, min: 0.10, max: 0.50 }),
      regime: mkRegime({
        current: "neutral",
        predicted: "bear",
        confidence: 0.4,
        signal: "transition_uncertain",
      }),
    });
    // Confidence below 0.55 floor, regime flip not load-bearing — fall through to aligned_calm.
    expect(r.verdict).toBe("aligned_calm");
  });
});

describe("evaluateVolRegimeConvergence — joint confidence", () => {
  it("disagreement (surface_only) reduces joint confidence", () => {
    const aligned = evaluateVolRegimeConvergence({
      vol: mkVol({ current: 0.45, mean: 0.20, min: 0.10, max: 0.50 }),
      regime: mkRegime({ current: "bear", predicted: "bear", confidence: 0.8 }),
    });
    const disagree = evaluateVolRegimeConvergence({
      vol: mkVol({ current: 0.45, mean: 0.20, min: 0.10, max: 0.50 }),
      regime: mkRegime({ current: "bull", predicted: "bull", confidence: 0.8 }),
    });
    expect(aligned.jointConfidence).toBeGreaterThan(disagree.jointConfidence);
  });
});

describe("convergenceToPayload", () => {
  it("emits stable shape", () => {
    const r = evaluateVolRegimeConvergence({
      vol: mkVol({ current: 0.20, mean: 0.20, min: 0.10, max: 0.30 }),
      regime: mkRegime({ current: "neutral", predicted: "neutral", confidence: 0.6 }),
    });
    const p = convergenceToPayload(r) as { kind: string; verdict: string };
    expect(p.kind).toBe("vol_regime_convergence.evaluated");
    expect([
      "aligned_calm",
      "aligned_storm",
      "regime_only",
      "surface_only",
      "indeterminate",
    ]).toContain(p.verdict);
  });
});
