import { describe, expect, test } from "bun:test";
import { computeStanding, DEFAULT_SHARPE_FIELD, DEFAULT_DRAWDOWN_FIELD } from "./standingMonitor.ts";
import {
  computeReturn,
  computeMaxDrawdown,
  computeNonAnnualizedSharpe,
  COMPETITION_SCORE_WEIGHTS,
} from "../../../core/risk-management/competition-scoring.ts";

/** Smooth equity curve: 1M → 1M·(1+totalReturn), low per-bar variance. */
function smoothEquity(nBars: number, totalReturn: number, noise = 1e-4, seed = 1): number[] {
  let s = seed >>> 0 || 1;
  const rng = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const drift = Math.pow(1 + totalReturn, 1 / nBars) - 1;
  const eq = [1_000_000];
  for (let i = 0; i < nBars; i++) eq.push(eq[eq.length - 1]! * (1 + drift + (rng() - 0.5) * 2 * noise));
  return eq;
}

/** A board of peer returns engineered so OUR return sits at ~targetPercentile. */
function boardForPercentile(ourReturn: number, targetPercentile: number, n = 100): number[] {
  const below = Math.round(targetPercentile * n);
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(i < below ? ourReturn - 0.01 - i * 1e-4 : ourReturn + 0.01 + i * 1e-4);
  return out;
}

describe("computeStanding — metrics match the §11-17 scoring exactly", () => {
  test("return / drawdown / Sharpe equal the direct competition-scoring computations", () => {
    const eq = smoothEquity(120, 0.02);
    const s = computeStanding({ equity15m: eq, phase: "pre_cut" });
    expect(s.return).toBeCloseTo(computeReturn(eq[eq.length - 1]!), 12);
    expect(s.maxDrawdown).toBeCloseTo(computeMaxDrawdown(eq), 12);
    expect(s.sharpe).toBeCloseTo(computeNonAnnualizedSharpe(eq).sharpe, 12);
  });

  test("composite is the §11-weighted sum of the four rank-scores", () => {
    const s = computeStanding({ equity15m: smoothEquity(120, 0.02), phase: "pre_cut" });
    const w = COMPETITION_SCORE_WEIGHTS;
    const expected =
      w.returnRank * (s.returnPercentile * 100) +
      w.drawdownRank * (s.drawdownPercentile * 100) +
      w.sharpeRank * (s.sharpePercentile * 100) + // ≥8 obs here, so uncapped
      w.riskDiscipline * s.riskDiscipline;
    expect(s.finalScoreEst).toBeCloseTo(expected, 6);
  });
});

describe("computeStanding — a smooth book ranks high on DD/Sharpe, median on return", () => {
  const s = computeStanding({ equity15m: smoothEquity(200, 0.02), phase: "pre_cut" });
  test("low drawdown → top-decile DD percentile vs a gambling field", () => {
    expect(s.maxDrawdown).toBeLessThan(0.02);
    expect(s.drawdownPercentile).toBeGreaterThan(0.85);
  });
  test("positive Sharpe → above-median Sharpe percentile", () => {
    expect(s.sharpe).toBeGreaterThan(0);
    expect(s.sharpePercentile).toBeGreaterThan(0.5);
  });
  test("a near-median return CAPS the overall finish — NOT top-decile despite great DD/Sharpe", () => {
    // The whole point: the 70% return weight at ~median drags the composite to mid-field.
    expect(s.returnPercentile).toBeLessThan(0.65);
    expect(s.overallRankEst).toBeGreaterThan(s.fieldN * 0.15); // not in the top 15%
  });
});

describe("computeStanding — return source + Sharpe cap", () => {
  test("uses the live board for an EMPIRICAL return rank when supplied", () => {
    const eq = smoothEquity(120, 0.05);
    const board = { returns: boardForPercentile(computeReturn(eq[eq.length - 1]!), 0.7) };
    const s = computeStanding({ equity15m: eq, phase: "pre_cut", board });
    expect(s.returnSource).toBe("board");
    expect(s.returnPercentile).toBeGreaterThan(0.6);
    expect(s.returnPercentile).toBeLessThan(0.8);
  });
  test("falls back to the field model with no board", () => {
    const s = computeStanding({ equity15m: smoothEquity(120, 0.02), phase: "pre_cut" });
    expect(s.returnSource).toBe("model");
  });
  test("<8 valid 15-min observations → Sharpe rank capped at 50", () => {
    const eq = smoothEquity(5, 0.01); // 5 returns < 8 obs
    const s = computeStanding({ equity15m: eq, phase: "pre_cut" });
    expect(s.sharpeObs).toBeLessThan(8);
    expect(s.summary).toContain("capped");
    // the Sharpe contribution to the composite is at most weight·50
    expect(s.finalScoreEst).toBeLessThanOrEqual(
      COMPETITION_SCORE_WEIGHTS.returnRank * 100 +
        COMPETITION_SCORE_WEIGHTS.drawdownRank * 100 +
        COMPETITION_SCORE_WEIGHTS.sharpeRank * 50 +
        COMPETITION_SCORE_WEIGHTS.riskDiscipline * 100 +
        1e-6,
    );
  });
});

describe("computeStanding — bang-bang stance + sleeve gating", () => {
  const eq = smoothEquity(120, 0.02);
  const ourRet = computeReturn(eq[eq.length - 1]!);
  const at = (p: number) => ({ returns: boardForPercentile(ourRet, p) });

  test("pre-cut below the cut → max_variance, sleeve held", () => {
    const s = computeStanding({ equity15m: eq, phase: "pre_cut", board: at(0.5) });
    expect(s.stance).toBe("max_variance");
    expect(s.sleeveArmed).toBe(false);
    expect(s.clearsCut).toBe(false);
  });
  test("post-cut mid-field → max_variance, sleeve ELIGIBLE", () => {
    const s = computeStanding({ equity15m: eq, phase: "post_cut", board: at(0.5) });
    expect(s.stance).toBe("max_variance");
    expect(s.sleeveArmed).toBe(true);
    expect(s.sleeveReason).toContain("swing");
  });
  test("post-cut top of field → lock_in, no sleeve", () => {
    const s = computeStanding({ equity15m: eq, phase: "post_cut", board: at(0.95) });
    expect(s.stance).toBe("lock_in");
    expect(s.sleeveArmed).toBe(false);
  });
  test("pre-cut comfortably above the cut → lock_in", () => {
    const s = computeStanding({ equity15m: eq, phase: "pre_cut", board: at(0.95) });
    expect(s.stance).toBe("lock_in");
  });
  test("pre-cut ENDGAME below the cut → sleeve eligible (climb into the Top-100)", () => {
    const s = computeStanding({ equity15m: eq, phase: "pre_cut", board: at(0.5), barsToCut: 24 });
    expect(s.sleeveArmed).toBe(true);
    expect(s.sleeveReason).toContain("Top-100");
  });
  test("pre-cut below the cut but NOT yet endgame → sleeve held", () => {
    const s = computeStanding({ equity15m: eq, phase: "pre_cut", board: at(0.5), barsToCut: 500 });
    expect(s.sleeveArmed).toBe(false);
  });
});

describe("computeStanding — risk discipline", () => {
  test("a sustained margin violation drops the discipline score below 100", () => {
    // >95% margin usage for ≥15 min at 15-min sampling = 2 consecutive samples → −30.
    const riskSamples = Array.from({ length: 4 }, () => ({ marginUsage: 0.97, leverage: 5, singleInstrumentExposure: 0.3, netDirectionalExposure: 0.1 }));
    const s = computeStanding({ equity15m: smoothEquity(120, 0.02), phase: "pre_cut", riskSamples, riskIntervalMinutes: 15 });
    expect(s.riskDiscipline).toBeLessThan(100);
  });
  test("no risk samples → assumes a clean 100", () => {
    const s = computeStanding({ equity15m: smoothEquity(120, 0.02), phase: "pre_cut" });
    expect(s.riskDiscipline).toBe(100);
  });
});

describe("formatStanding output", () => {
  test("renders the operator report with all rows", () => {
    const s = computeStanding({ equity15m: smoothEquity(120, 0.02), phase: "post_cut", liveRisk: { marginUsage: 0.18, leverage: 2.4 }, asOf: "2026-06-23 14:05" });
    expect(s.summary).toContain("STANDING @ 2026-06-23 14:05");
    expect(s.summary).toContain("return");
    expect(s.summary).toContain("15m Sharpe");
    expect(s.summary).toContain("max DD");
    expect(s.summary).toContain("risk-disc");
    expect(s.summary).toContain("est. final score");
    expect(s.summary).toContain("lev 2.4x");
  });
});

test("default field constants are exported and shaped right", () => {
  expect(DEFAULT_SHARPE_FIELD.std).toBeGreaterThan(0);
  expect(DEFAULT_DRAWDOWN_FIELD.mean).toBeGreaterThan(0.1);
});
