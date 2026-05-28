import { describe, expect, test } from "bun:test";
import { computeDisciplineTrajectory } from "./disciplineTrajectory.ts";
import type {
  DisciplineAuditReport,
  DisciplineFailureMode,
  FailureModeResult,
} from "./disciplineAudit.ts";

const ALL_MODES: DisciplineFailureMode[] = [
  "racing_the_target",
  "trading_without_plan",
  "risk_per_trade_too_high",
  "overtrading",
  "not_journaling",
  "strategy_switching",
  "emotional_trading",
];

/** Build a discipline report with a given score and an explicit set of
 *  triggered modes. The score is taken verbatim (not derived from the
 *  triggered set) so tests can control the band directly. */
function report(score: number, triggered: DisciplineFailureMode[] = []): DisciplineAuditReport {
  const triggeredSet = new Set(triggered);
  const modes: FailureModeResult[] = ALL_MODES.map((mode) => ({
    mode,
    triggered: triggeredSet.has(mode),
    severity: triggeredSet.has(mode) ? "warning" : "info",
    description: mode,
    evidence: {},
  }));
  return {
    windowStart: "2026-01-01T00:00:00.000Z",
    windowEnd: "2026-01-08T00:00:00.000Z",
    modes,
    triggeredCount: triggered.length,
    score,
    headlineSeverity: triggered.length > 0 ? "warning" : "info",
  };
}

describe("computeDisciplineTrajectory — slope + direction", () => {
  test("rising discipline scores → improving", () => {
    const r = computeDisciplineTrajectory({
      reports: [report(0.4), report(0.55), report(0.7), report(0.82)],
    });
    expect(r.disciplineDirection).toBe("improving");
    expect(r.disciplineSlope).toBeGreaterThan(0);
    expect(r.latestScore).toBeCloseTo(0.82, 5);
    expect(r.windowCount).toBe(4);
  });

  test("falling discipline scores → declining", () => {
    const r = computeDisciplineTrajectory({
      reports: [report(0.85), report(0.7), report(0.55), report(0.4)],
    });
    expect(r.disciplineDirection).toBe("declining");
    expect(r.disciplineSlope).toBeLessThan(0);
  });

  test("flat scores → flat", () => {
    const r = computeDisciplineTrajectory({
      reports: [report(0.7), report(0.71), report(0.69), report(0.7)],
    });
    expect(r.disciplineDirection).toBe("flat");
  });

  test("single window → slope 0, flat", () => {
    const r = computeDisciplineTrajectory({ reports: [report(0.6)] });
    expect(r.disciplineSlope).toBe(0);
    expect(r.disciplineDirection).toBe("flat");
    expect(r.windowCount).toBe(1);
  });
});

describe("computeDisciplineTrajectory — mode trends", () => {
  test("classifies resolved / regressed / persistent / absent", () => {
    const first = report(0.5, ["overtrading", "strategy_switching", "not_journaling"]);
    const last = report(0.8, ["not_journaling", "emotional_trading"]);
    const r = computeDisciplineTrajectory({ reports: [first, last] });

    // overtrading + strategy_switching were firing, now clear → resolved
    expect(r.resolvedModes.sort()).toEqual(["overtrading", "strategy_switching"]);
    // emotional_trading newly firing → regressed
    expect(r.regressedModes).toEqual(["emotional_trading"]);
    // not_journaling firing in both → persistent
    expect(r.persistentModes).toEqual(["not_journaling"]);

    const racing = r.modeTrends.find((m) => m.mode === "racing_the_target");
    expect(racing?.status).toBe("absent");
  });
});

describe("computeDisciplineTrajectory — stage bands", () => {
  test("low score → Stage 1 Tinkering", () => {
    const r = computeDisciplineTrajectory({
      reports: [report(0.3, ["overtrading", "strategy_switching"]), report(0.35)],
    });
    expect(r.stage).toBe(1);
    expect(r.stageName).toBe("Tinkering");
    expect(r.whatMovesYouForward).toContain("Build structure");
  });

  test("mid score improving → Stage 2 Blade Years", () => {
    const r = computeDisciplineTrajectory({
      reports: [report(0.5), report(0.58), report(0.65)],
    });
    expect(r.stage).toBe(2);
    expect(r.stageName).toBe("Blade Years");
  });

  test("high stable score with moderate consistency → Stage 3 Inflection", () => {
    const r = computeDisciplineTrajectory({
      reports: [report(0.78), report(0.8), report(0.79)],
      consistencyScores: [0.65, 0.68, 0.7],
    });
    expect(r.stage).toBe(3);
    expect(r.stageName).toBe("Inflection");
  });
});

describe("computeDisciplineTrajectory — Stage 4 gates", () => {
  const highScores = [report(0.88), report(0.9), report(0.89)];

  test("Stage 4 reached with multi-window low+falling dispersion and high consistency", () => {
    const r = computeDisciplineTrajectory({
      reports: highScores,
      consistencyScores: [0.82, 0.85, 0.86],
      returnDispersions: [0.05, 0.04, 0.03], // falling, latest ≤ median
    });
    expect(r.stage).toBe(4);
    expect(r.stageName).toBe("Surging Growth");
    expect(r.dispersionTrend).toBe("falling");
  });

  test("high score but no dispersion data → demoted to Stage 3", () => {
    const r = computeDisciplineTrajectory({
      reports: highScores,
      consistencyScores: [0.82, 0.85, 0.86],
    });
    expect(r.stage).toBe(3);
  });

  test("high score but rising dispersion → demoted to Stage 3", () => {
    const r = computeDisciplineTrajectory({
      reports: highScores,
      consistencyScores: [0.82, 0.85, 0.86],
      returnDispersions: [0.03, 0.05, 0.08], // rising variance
    });
    expect(r.stage).toBe(3);
    expect(r.dispersionTrend).toBe("rising");
  });

  test("high score but low consistency → demoted below Stage 4", () => {
    const r = computeDisciplineTrajectory({
      reports: highScores,
      consistencyScores: [0.4, 0.45, 0.5], // weak consistency
      returnDispersions: [0.05, 0.04, 0.03],
    });
    expect(r.stage).toBeLessThan(4);
  });

  test("high score but only 2 windows → cannot establish multi-window low variance", () => {
    const r = computeDisciplineTrajectory({
      reports: [report(0.88), report(0.9)],
      consistencyScores: [0.85, 0.86],
      returnDispersions: [0.04, 0.03],
    });
    expect(r.stage).toBe(3);
  });
});

describe("computeDisciplineTrajectory — Stage 3 demotion", () => {
  test("high score but declining discipline → demoted to Stage 2", () => {
    const r = computeDisciplineTrajectory({
      // latest score is still 0.78 (band 3) but the trend is clearly down
      reports: [report(0.95), report(0.88), report(0.82), report(0.78)],
      consistencyScores: [0.7, 0.68, 0.66, 0.64],
    });
    expect(r.disciplineDirection).toBe("declining");
    expect(r.stage).toBe(2);
  });

  test("high score but weak consistency → demoted to Stage 2", () => {
    const r = computeDisciplineTrajectory({
      reports: [report(0.78), report(0.8), report(0.79)],
      consistencyScores: [0.4, 0.45, 0.5],
    });
    expect(r.stage).toBe(2);
  });
});

describe("computeDisciplineTrajectory — confidence + dispersion + errors", () => {
  test("confidence scales with corroborating data", () => {
    const base = computeDisciplineTrajectory({ reports: [report(0.6)] });
    const richer = computeDisciplineTrajectory({
      reports: [report(0.6), report(0.62), report(0.64)],
      consistencyScores: [0.6, 0.62, 0.64],
      returnDispersions: [0.05, 0.04, 0.04],
    });
    expect(richer.stageConfidence).toBeGreaterThan(base.stageConfidence);
    expect(richer.stageConfidence).toBeCloseTo(1, 5);
  });

  test("dispersion trend is self-relative (unit-free)", () => {
    // Large absolute values but flat relative slope → flat.
    const r = computeDisciplineTrajectory({
      reports: [report(0.7), report(0.7), report(0.7)],
      returnDispersions: [1000, 1010, 990],
    });
    expect(r.dispersionTrend).toBe("flat");
  });

  test("falling dispersion detected regardless of scale", () => {
    const r = computeDisciplineTrajectory({
      reports: [report(0.7), report(0.7), report(0.7)],
      returnDispersions: [100, 60, 20],
    });
    expect(r.dispersionTrend).toBe("falling");
  });

  test("throws on empty reports", () => {
    expect(() => computeDisciplineTrajectory({ reports: [] })).toThrow(/at least one report/);
  });

  test("interpretation mentions stage + trend", () => {
    const r = computeDisciplineTrajectory({
      reports: [report(0.4), report(0.55), report(0.7)],
    });
    expect(r.interpretation).toContain("Stage");
    expect(r.interpretation).toContain("improving");
  });
});
