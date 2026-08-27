/**
 * Discipline Trajectory — longitudinal projection over windowed
 * discipline-audit reports.
 *
 * Operationalizes the "Hockey Stick Growth Curve of Trading" article.
 * `disciplineAudit.ts` gives a POINT-IN-TIME scorecard (which of the 7
 * failure modes fired this window). This module reads a SEQUENCE of
 * those scorecards (oldest → newest) plus optional consistency and
 * return-dispersion series, and answers the question the article is
 * actually about: where is the operator on the four-stage curve, and is
 * the curve sloping up?
 *
 *   Stage 1 — Tinkering       (chaos; many modes firing; low score)
 *   Stage 2 — Blade Years     (internal alignment; score improving; not
 *                              yet ready to scale)
 *   Stage 3 — Inflection      (breakthrough; clean repeatable execution;
 *                              high stable score; trust the process)
 *   Stage 4 — Surging Growth  (elite; multi-window low variance; scalable)
 *
 * The article's central claim is that progress is NON-LINEAR — "what
 * appears stagnant is often compounding below the surface." So this is
 * deliberately a TREND read, not a snapshot: the discipline slope across
 * windows is the primary signal, with consistency and return-dispersion
 * as corroborating evidence. Higher stages require MORE than a clean
 * snapshot — Stage 4 specifically requires multi-window low variance,
 * which a single audit window cannot establish.
 *
 * Pure function. No I/O, no Date.now (callers supply the windowed
 * reports). Deterministic given its inputs.
 */

import type { DisciplineAuditReport, DisciplineFailureMode } from "./disciplineAudit.ts";

export type TrajectoryDirection = "improving" | "flat" | "declining";
export type DispersionTrend = "rising" | "flat" | "falling";
export type TraderStage = 1 | 2 | 3 | 4;
export type ModeTrendStatus = "resolved" | "regressed" | "persistent" | "absent";

export interface DisciplineTrajectoryInput {
  /** Windowed discipline reports, OLDEST FIRST. At least one required. */
  reports: DisciplineAuditReport[];
  /**
   * Optional trade-consistency composite per window ([0..1], 1 = perfectly
   * consistent), aligned to `reports` oldest-first. Length need not match;
   * only the trend + latest value are read.
   */
  consistencyScores?: number[];
  /**
   * Optional return-dispersion per window (e.g. stddev of daily returns —
   * lower = tighter), aligned oldest-first. Stage 4 ("low variance") is
   * judged against this series, self-relative so the unit does not matter.
   */
  returnDispersions?: number[];
  /**
   * Absolute per-window slope of a [0..1] score below which the trend is
   * called "flat". Applies to discipline + consistency. Default 0.02.
   */
  flatThreshold?: number;
  /**
   * Relative per-window slope (slope / mean) below which the dispersion
   * trend is called "flat". Default 0.05 (5% per window).
   */
  dispersionFlatThreshold?: number;
}

export interface ModeTrend {
  mode: DisciplineFailureMode;
  firstTriggered: boolean;
  lastTriggered: boolean;
  status: ModeTrendStatus;
}

export interface DisciplineTrajectoryResult {
  windowCount: number;
  disciplineScores: number[];
  /** Least-squares slope of discipline score per window. */
  disciplineSlope: number;
  disciplineDirection: TrajectoryDirection;
  latestScore: number;
  /** Null when no consistency series was provided. */
  consistencyDirection: TrajectoryDirection | null;
  latestConsistency: number | null;
  /** Null when no dispersion series was provided. */
  dispersionTrend: DispersionTrend | null;
  latestDispersion: number | null;
  modeTrends: ModeTrend[];
  resolvedModes: DisciplineFailureMode[];
  regressedModes: DisciplineFailureMode[];
  persistentModes: DisciplineFailureMode[];
  stage: TraderStage;
  stageName: string;
  /** [0..1] — scales with how much corroborating data was available. */
  stageConfidence: number;
  whatMovesYouForward: string;
  interpretation: string;
}

const DEFAULT_FLAT_THRESHOLD = 0.02;
const DEFAULT_DISPERSION_FLAT_THRESHOLD = 0.05;

const STAGE_NAMES: Record<TraderStage, string> = {
  1: "Tinkering",
  2: "Blade Years",
  3: "Inflection",
  4: "Surging Growth",
};

const WHAT_MOVES_YOU_FORWARD: Record<TraderStage, string> = {
  1: "Build structure before chasing results. Journal every trade, review weekly, simplify to one or two setups, and stop attaching identity to short-term outcomes. The turning point is accepting that performance comes from process, not from being right.",
  2: "Reinforce consistency. Trade your defined playbook, embrace boredom, and sit out non-aligned conditions. You are not ready to scale yet — prove the edge is repeatable across windows before adding size.",
  3: "Operate like a professional: manage mental capital, track metrics, and scale size only when conviction is high. To reach Stage 4, scale discipline alongside size without disrupting execution.",
  4: "Maintain edge integrity. Review at a higher level, evolve without overcomplicating, and protect your mindset the way you protect capital. Correct small mistakes fast and keep large ones rare.",
};

const ALL_MODES: DisciplineFailureMode[] = [
  "racing_the_target",
  "trading_without_plan",
  "risk_per_trade_too_high",
  "overtrading",
  "not_journaling",
  "strategy_switching",
  "emotional_trading",
];

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/** Least-squares slope of y over x = 0..n-1. Returns 0 for n < 2. */
function slope(ys: number[]): number {
  const n = ys.length;
  if (n < 2) return 0;
  const mx = (n - 1) / 2;
  const my = mean(ys);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    const dx = i - mx;
    num += dx * (ys[i]! - my);
    den += dx * dx;
  }
  return den === 0 ? 0 : num / den;
}

function directionOf(s: number, flat: number): TrajectoryDirection {
  if (s > flat) return "improving";
  if (s < -flat) return "declining";
  return "flat";
}

function modeTrendStatus(first: boolean, last: boolean): ModeTrendStatus {
  if (first && last) return "persistent";
  if (first && !last) return "resolved";
  if (!first && last) return "regressed";
  return "absent";
}

function triggeredMap(report: DisciplineAuditReport): Map<DisciplineFailureMode, boolean> {
  const m = new Map<DisciplineFailureMode, boolean>();
  for (const r of report.modes) m.set(r.mode, r.triggered);
  return m;
}

/**
 * Classify the operator's stage by banding on the latest discipline
 * score, then demoting if the higher-stage gates aren't met. Demotion-
 * only keeps the call conservative: a clean snapshot never gets credit
 * for a maturity the trajectory hasn't earned.
 */
function classifyStage(args: {
  latestScore: number;
  disciplineDirection: TrajectoryDirection;
  latestConsistency: number | null;
  windowCount: number;
  dispersions: number[] | null;
  latestDispersion: number | null;
  dispersionTrend: DispersionTrend | null;
}): TraderStage {
  const {
    latestScore,
    disciplineDirection,
    latestConsistency,
    windowCount,
    dispersions,
    latestDispersion,
    dispersionTrend,
  } = args;

  // Band by latest discipline score.
  let stage: TraderStage =
    latestScore < 0.5 ? 1 : latestScore < 0.7 ? 2 : latestScore < 0.85 ? 3 : 4;

  // Stage 4 gate: the article requires MULTI-WINDOW low variance. Demote
  // to 3 unless we can actually see tight, non-rising dispersion across
  // ≥3 windows, discipline isn't declining, and (if known) consistency
  // is high.
  if (stage === 4) {
    const lowDispersionEstablished =
      dispersions !== null &&
      dispersions.length >= 3 &&
      latestDispersion !== null &&
      latestDispersion <= median(dispersions) &&
      (dispersionTrend === "falling" || dispersionTrend === "flat");
    const consistencyOk = latestConsistency === null || latestConsistency >= 0.8;
    const disciplineOk = disciplineDirection !== "declining";
    if (!(windowCount >= 3 && lowDispersionEstablished && consistencyOk && disciplineOk)) {
      stage = 3;
    }
  }

  // Stage 3 gate: breakthrough requires execution that isn't deteriorating
  // and (if known) at least moderate consistency. Otherwise it's still
  // Blade-Years alignment work.
  if (stage === 3) {
    const consistencyOk = latestConsistency === null || latestConsistency >= 0.6;
    const disciplineOk = disciplineDirection !== "declining";
    if (!(consistencyOk && disciplineOk)) {
      stage = 2;
    }
  }

  return stage;
}

export function computeDisciplineTrajectory(
  input: DisciplineTrajectoryInput,
): DisciplineTrajectoryResult {
  const reports = input.reports ?? [];
  if (reports.length === 0) {
    throw new Error("computeDisciplineTrajectory: at least one report is required");
  }
  const flat = input.flatThreshold ?? DEFAULT_FLAT_THRESHOLD;
  const dispFlat = input.dispersionFlatThreshold ?? DEFAULT_DISPERSION_FLAT_THRESHOLD;
  const windowCount = reports.length;

  const disciplineScores = reports.map((r) => r.score);
  const disciplineSlope = slope(disciplineScores);
  const disciplineDirection = directionOf(disciplineSlope, flat);
  const latestScore = disciplineScores[disciplineScores.length - 1]!;

  let consistencyDirection: TrajectoryDirection | null = null;
  let latestConsistency: number | null = null;
  if (input.consistencyScores && input.consistencyScores.length > 0) {
    const cs = input.consistencyScores;
    consistencyDirection = directionOf(slope(cs), flat);
    latestConsistency = cs[cs.length - 1]!;
  }

  let dispersionTrend: DispersionTrend | null = null;
  let latestDispersion: number | null = null;
  let dispersions: number[] | null = null;
  if (input.returnDispersions && input.returnDispersions.length > 0) {
    dispersions = input.returnDispersions;
    latestDispersion = dispersions[dispersions.length - 1]!;
    const dSlope = slope(dispersions);
    const dMean = mean(dispersions.map((d) => Math.abs(d)));
    const relSlope = dMean === 0 ? 0 : dSlope / dMean;
    dispersionTrend = relSlope > dispFlat ? "rising" : relSlope < -dispFlat ? "falling" : "flat";
  }

  // Per-mode trend: earliest window vs latest window.
  const firstMap = triggeredMap(reports[0]!);
  const lastMap = triggeredMap(reports[reports.length - 1]!);
  const modeTrends: ModeTrend[] = ALL_MODES.map((mode) => {
    const firstTriggered = firstMap.get(mode) ?? false;
    const lastTriggered = lastMap.get(mode) ?? false;
    return {
      mode,
      firstTriggered,
      lastTriggered,
      status: modeTrendStatus(firstTriggered, lastTriggered),
    };
  });
  const resolvedModes = modeTrends.filter((m) => m.status === "resolved").map((m) => m.mode);
  const regressedModes = modeTrends.filter((m) => m.status === "regressed").map((m) => m.mode);
  const persistentModes = modeTrends.filter((m) => m.status === "persistent").map((m) => m.mode);

  const stage = classifyStage({
    latestScore,
    disciplineDirection,
    latestConsistency,
    windowCount,
    dispersions,
    latestDispersion,
    dispersionTrend,
  });

  // Confidence scales with corroborating evidence + window depth.
  let stageConfidence = 0.3;
  if (windowCount >= 2) stageConfidence += 0.1;
  if (windowCount >= 3) stageConfidence += 0.1;
  if (latestConsistency !== null) stageConfidence += 0.25;
  if (latestDispersion !== null) stageConfidence += 0.25;
  stageConfidence = Math.min(1, stageConfidence);

  const trendWord =
    disciplineDirection === "improving"
      ? "improving"
      : disciplineDirection === "declining"
        ? "declining"
        : "flat";
  const interpretation =
    `Stage ${stage} (${STAGE_NAMES[stage]}). Discipline score ${latestScore.toFixed(2)} ` +
    `over ${windowCount} window(s), trend ${trendWord} (slope ${disciplineSlope.toFixed(3)}/window).` +
    (latestConsistency !== null
      ? ` Consistency ${latestConsistency.toFixed(2)} (${consistencyDirection}).`
      : "") +
    (latestDispersion !== null ? ` Return dispersion ${dispersionTrend}.` : "") +
    (resolvedModes.length > 0 ? ` Resolved: ${resolvedModes.join(", ")}.` : "") +
    (regressedModes.length > 0 ? ` Regressed: ${regressedModes.join(", ")}.` : "") +
    (persistentModes.length > 0 ? ` Persistent: ${persistentModes.join(", ")}.` : "") +
    ` Confidence ${stageConfidence.toFixed(2)}.`;

  return {
    windowCount,
    disciplineScores,
    disciplineSlope,
    disciplineDirection,
    latestScore,
    consistencyDirection,
    latestConsistency,
    dispersionTrend,
    latestDispersion,
    modeTrends,
    resolvedModes,
    regressedModes,
    persistentModes,
    stage,
    stageName: STAGE_NAMES[stage],
    stageConfidence,
    whatMovesYouForward: WHAT_MOVES_YOU_FORWARD[stage],
    interpretation,
  };
}
