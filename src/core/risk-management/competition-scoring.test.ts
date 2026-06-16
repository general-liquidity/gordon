import { describe, expect, it } from "bun:test";
import {
  computeReturn,
  computeMaxDrawdown,
  computeNonAnnualizedSharpe,
  computeRiskDiscipline,
  scoreCompetitionRound,
  selectBestSharpeAward,
  isBestSharpeEligible,
  COMPETITION_INITIAL_EQUITY,
  type ParticipantRound,
  type RiskSample,
  type BestSharpeCandidate,
} from "./competition-scoring.ts";

const M = COMPETITION_INITIAL_EQUITY;
const curve = (...mults: number[]): number[] => mults.map((m) => m * M);

describe("raw metrics", () => {
  it("computeReturn off the fixed 1M baseline", () => {
    expect(computeReturn(1_200_000)).toBeCloseTo(0.2, 9);
    expect(computeReturn(900_000)).toBeCloseTo(-0.1, 9);
  });

  it("computeMaxDrawdown is the worst peak-to-trough", () => {
    expect(computeMaxDrawdown([100, 120, 90, 110])).toBeCloseTo(0.25, 9); // 120→90
    expect(computeMaxDrawdown([100, 101, 102])).toBe(0);
  });

  it("non-annualized Sharpe: zero variance → 0; sparse-aware nObs", () => {
    expect(computeNonAnnualizedSharpe(curve(1, 1, 1)).sharpe).toBe(0); // flat → std 0
    const steady = computeNonAnnualizedSharpe(curve(1, 1.01, 1.0201)); // identical returns → std 0
    expect(steady.sharpe).toBe(0);
    expect(steady.nObs).toBe(2);
    const varied = computeNonAnnualizedSharpe(curve(1, 1.02, 1.01, 1.05));
    expect(varied.sharpe).toBeGreaterThan(0);
    expect(varied.nObs).toBe(3);
  });
});

describe("computeRiskDiscipline (Section 13, 15-min samples)", () => {
  const flat: RiskSample = {
    marginUsage: 0.5,
    leverage: 5,
    singleInstrumentExposure: 0.3,
    netDirectionalExposure: 0.4,
  };
  const withMargin = (m: number): RiskSample => ({ ...flat, marginUsage: m });

  it("clean book keeps the full 100", () => {
    expect(computeRiskDiscipline([flat, flat, flat], 15).score).toBe(100);
  });

  it("margin >90% for ≥30min → −20", () => {
    const r = computeRiskDiscipline([withMargin(0.92), withMargin(0.92)], 15); // 2×15 = 30m
    expect(r.score).toBe(80);
    expect(r.deductions[0]!.rule).toContain("margin>90%");
  });

  it("margin >95% for ≥15min → −30 (more severe tier wins, not stacked)", () => {
    const r = computeRiskDiscipline([withMargin(0.96)], 15); // 1×15 = 15m
    expect(r.score).toBe(70);
  });

  it("margin >98% for ≥10min raises compliance review, not an auto-deduction", () => {
    const r = computeRiskDiscipline([withMargin(0.99)], 15);
    expect(r.complianceReview).toBe(true);
  });

  it("leverage >28x ≥30min (−20) and concentration penalties stack additively", () => {
    const s: RiskSample = {
      marginUsage: 0.5,
      leverage: 28.5,
      singleInstrumentExposure: 0.95,
      netDirectionalExposure: 0.97,
    };
    const r = computeRiskDiscipline([s, s], 15); // 30m each
    expect(r.score).toBe(100 - 20 - 10 - 10); // leverage + single-instrument + directional
  });
});

describe("scoreCompetitionRound", () => {
  const A: ParticipantRound = { id: "A", equity15m: curve(1, 1.02, 1.01, 1.04, 1.03, 1.06, 1.08, 1.12, 1.2) };
  const B: ParticipantRound = { id: "B", equity15m: curve(1, 1, 1, 1, 1, 1, 1, 1, 1) }; // flat
  const C: ParticipantRound = { id: "C", equity15m: curve(1, 0.99, 0.98, 0.97, 0.96, 0.95, 0.94, 0.92, 0.9) };

  it("return dominates (70%): the high-return book wins the round", () => {
    const board = scoreCompetitionRound([A, B, C]);
    expect(board[0]!.id).toBe("A");
    expect(board.map((p) => p.id)).toEqual(["A", "B", "C"]);
    // 3 active, distinct returns → return rank scores 100 / 50 / 0.
    expect(board.find((p) => p.id === "A")!.returnRank).toBeCloseTo(100, 6);
    expect(board.find((p) => p.id === "B")!.returnRank).toBeCloseTo(50, 6);
    expect(board.find((p) => p.id === "C")!.returnRank).toBeCloseTo(0, 6);
  });

  it("a disqualified (forced-liq/red-line) entry is removed from the field, scored 0, sorted last", () => {
    const D: ParticipantRound = { id: "D", equity15m: curve(1, 0.5), disqualified: true };
    const board = scoreCompetitionRound([A, B, C, D]);
    const d = board.find((p) => p.id === "D")!;
    expect(d.disqualified).toBe(true);
    expect(d.finalScore).toBe(0);
    expect(board[board.length - 1]!.id).toBe("D");
    // D didn't dilute the active field — A still top with returnRank 100 of 3.
    expect(board.find((p) => p.id === "A")!.returnRank).toBeCloseTo(100, 6);
  });

  it("Sharpe Rank is capped at 50 with < 8 valid 15-min observations", () => {
    const sparse: ParticipantRound = { id: "sparse", equity15m: curve(1, 1.05, 1.02, 1.2) }; // 3 obs
    const dense: ParticipantRound = { id: "dense", equity15m: A.equity15m };
    const board = scoreCompetitionRound([sparse, dense]);
    expect(board.find((p) => p.id === "sparse")!.sharpeObs).toBeLessThan(8);
    expect(board.find((p) => p.id === "sparse")!.sharpeRank).toBeLessThanOrEqual(50);
  });

  it("a sole flawless participant scores the full 100", () => {
    const solo = scoreCompetitionRound([A]);
    expect(solo[0]!.finalScore).toBeCloseTo(100, 6); // all ranks default 100, risk discipline 100
  });
});

describe("selectBestSharpeAward (Section 17)", () => {
  const base: BestSharpeCandidate = {
    id: "x",
    reachedFinals: true,
    finalOverallRank: 10,
    redLineViolation: false,
    tradeCount: 40,
    sharpe: 1.0,
    finalReturn: 0.2,
    maxDrawdown: 0.1,
  };

  it("each eligibility gate is enforced (Finals, Top-50, no red-line, ≥30 trades)", () => {
    expect(isBestSharpeEligible(base)).toBe(true);
    expect(isBestSharpeEligible({ ...base, reachedFinals: false })).toBe(false);
    expect(isBestSharpeEligible({ ...base, finalOverallRank: 51 })).toBe(false);
    expect(isBestSharpeEligible({ ...base, redLineViolation: true })).toBe(false);
    expect(isBestSharpeEligible({ ...base, tradeCount: 29 })).toBe(false);
  });

  it("highest Sharpe among eligible wins; ineligible high-Sharpe entrants are excluded", () => {
    const result = selectBestSharpeAward([
      { ...base, id: "ineligible_29_trades", sharpe: 5.0, tradeCount: 29 }, // huge Sharpe but < 30 trades
      { ...base, id: "ineligible_rank60", sharpe: 4.0, finalOverallRank: 60 }, // not Top-50
      { ...base, id: "winner", sharpe: 1.5 },
      { ...base, id: "runner_up", sharpe: 1.2 },
    ]);
    expect(result.winner!.id).toBe("winner");
    expect(result.eligible.map((c) => c.id)).toEqual(["winner", "runner_up"]);
  });

  it("ties break on higher final return, then lower drawdown", () => {
    const r = selectBestSharpeAward([
      { ...base, id: "lowReturn", sharpe: 2.0, finalReturn: 0.1 },
      { ...base, id: "highReturn", sharpe: 2.0, finalReturn: 0.3 },
    ]);
    expect(r.winner!.id).toBe("highReturn");
  });

  it("returns no winner when nobody is eligible", () => {
    const r = selectBestSharpeAward([{ ...base, tradeCount: 5 }]);
    expect(r.winner).toBeNull();
    expect(r.eligible).toHaveLength(0);
  });
});
