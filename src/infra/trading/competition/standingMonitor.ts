/**
 * Live competition STANDING monitor — our real-time position in the scoring, computed from
 * the running 15-minute equity curve, so we can ACT (arm the sleeve, tighten, hold) on where
 * we actually stand instead of guessing.
 *
 * It composes the exact §11–17 metrics (`competition-scoring.ts`) with the tournament field
 * model (`rankTracker.ts`) into one readout: our Return / 15-min Sharpe / max-DD / risk-
 * discipline, each turned into an estimated rank vs the field, the weighted composite +
 * estimated overall finish, the bang-bang stance, and whether the sleeve would arm.
 *
 * HONESTY about the rank estimates:
 *   - RETURN percentile is empirical when a live leaderboard of peer returns is supplied
 *     (rounds 1–3 expose peer returns at 5-min latency, §8); otherwise it's modelled off the
 *     field Normal.
 *   - SHARPE and DRAWDOWN percentiles are MODEL estimates (we can't see peers' 15-min equity
 *     curves), using field distributions whose defaults encode "most of the ~500 entrants
 *     gamble for the return rank" → a positive, smooth, low-DD book ranks high on those.
 *   Mark them as estimates in any operator-facing surface.
 *
 * The point it makes concrete: with the 70%-weight Return rank ≈ median for a no-edge book,
 * the composite is capped near the middle no matter how good the other three are — which is
 * exactly why the late lottery sleeve (to move RETURN) is the only path to a TOP finish, and
 * why the smooth book's value is the ~25% non-return score it takes for free by surviving.
 *
 * Pure compute. No I/O. Caller supplies the equity samples + (optional) live board + risk state.
 */

import {
  computeReturn,
  computeMaxDrawdown,
  computeNonAnnualizedSharpe,
  computeRiskDiscipline,
  COMPETITION_INITIAL_EQUITY,
  COMPETITION_SCORE_WEIGHTS,
  MIN_SHARPE_OBSERVATIONS,
  type RiskSample,
} from "../../../core/risk-management/competition-scoring.ts";
import {
  estimatePercentile,
  percentileFromBoard,
  normalCdf,
  type FieldModel,
  DEFAULT_FIELD,
  type RiskStance,
} from "./rankTracker.ts";

/** Field distribution for a single metric (Normal). */
export interface MetricField {
  mean: number;
  std: number;
}

/**
 * Default SHARPE field — most entrants gamble: 15-min Sharpe centred slightly negative,
 * moderately dispersed. A genuinely positive, smooth Sharpe ranks well against it.
 */
export const DEFAULT_SHARPE_FIELD: MetricField = { mean: -0.01, std: 0.04 };
/**
 * Default DRAWDOWN field — leveraged gamblers run deep drawdowns (mean ~30%, wide). A 2–4%
 * book lands in the top decile here. Lower drawdown = higher rank.
 */
export const DEFAULT_DRAWDOWN_FIELD: MetricField = { mean: 0.3, std: 0.18 };

export interface StandingInput {
  /** Our 15-minute equity samples (first = round/contest open equity). */
  equity15m: number[];
  /** Sampled risk metrics for the §13 discipline score; omit → assume 100 (clean). */
  riskSamples?: RiskSample[];
  /** Sampling interval (minutes) for the discipline run-length math. Default 15. */
  riskIntervalMinutes?: number;
  startingEquity?: number;
  phase: "pre_cut" | "post_cut";
  /** Bars until the decisive Top-100 cut — enables the pre-finals endgame sleeve readout. */
  barsToCut?: number;
  /** Endgame window (bars before the cut) within which the sleeve may fire if below it. Default 48. */
  sleeveEndgameWindow?: number;
  /** Cut line as a percentile (Top-100 of 500 ⇒ 0.8). Default 0.8. */
  cutPercentile?: number;
  field?: FieldModel; // return field
  sharpeField?: MetricField;
  drawdownField?: MetricField;
  /** Live leaderboard (rounds 1–3): peer returns for an EMPIRICAL return rank. */
  board?: { returns: number[] };
  /** Current live risk state for the headroom readout (not the per-round discipline score). */
  liveRisk?: { marginUsage: number; leverage: number };
  weights?: typeof COMPETITION_SCORE_WEIGHTS;
  /** Field size + label for rank estimates. */
  fieldN?: number;
  asOf?: string;
}

export interface CompetitionStanding {
  return: number;
  returnPercentile: number;
  returnSource: "board" | "model";
  sharpe: number;
  sharpeObs: number;
  sharpePercentile: number;
  maxDrawdown: number;
  drawdownPercentile: number;
  riskDiscipline: number;
  /** Weighted composite of the four rank-scores (0–100), in the §11 weights. */
  finalScoreEst: number;
  overallPercentileEst: number;
  overallRankEst: number;
  fieldN: number;
  clearsCut: boolean;
  stance: RiskStance;
  sleeveArmed: boolean;
  sleeveReason: string;
  liveRisk?: { marginUsage: number; leverage: number };
  asOf: string;
  summary: string;
}

const clamp01 = (x: number): number => (!Number.isFinite(x) ? 0.5 : x < 0 ? 0 : x > 1 ? 1 : x);

/** Percentile (0–1, higher better) → estimated 1-based rank in a field of n. */
function percentileToRank(p: number, n: number): number {
  if (n <= 1) return 1;
  return Math.min(n, Math.max(1, Math.round((1 - clamp01(p)) * (n - 1)) + 1));
}

/** Φ-based percentile for a "higher is better" metric vs a Normal field. */
function higherIsBetterPercentile(value: number, field: MetricField): number {
  if (!(field.std > 0)) return value > field.mean ? 1 : value < field.mean ? 0 : 0.5;
  return clamp01(normalCdf((value - field.mean) / field.std));
}
/** Φ-based percentile for a "lower is better" metric (e.g. drawdown). */
function lowerIsBetterPercentile(value: number, field: MetricField): number {
  if (!(field.std > 0)) return value < field.mean ? 1 : value > field.mean ? 0 : 0.5;
  return clamp01(normalCdf((field.mean - value) / field.std));
}

/** Compute our live competition standing from the running equity curve. */
export function computeStanding(input: StandingInput): CompetitionStanding {
  const initial = input.startingEquity ?? COMPETITION_INITIAL_EQUITY;
  const w = input.weights ?? COMPETITION_SCORE_WEIGHTS;
  const n = Number.isFinite(input.fieldN) && (input.fieldN as number) > 1 ? Math.floor(input.fieldN as number) : 500;
  const cutPercentile = clamp01(input.cutPercentile ?? 0.8);

  const finalEquity = input.equity15m.length ? input.equity15m[input.equity15m.length - 1]! : initial;
  const ret = computeReturn(finalEquity, initial);
  const dd = computeMaxDrawdown(input.equity15m);
  const { sharpe, nObs } = computeNonAnnualizedSharpe(input.equity15m);

  // RETURN percentile: empirical from the live board if present, else the field model.
  const returnSource: "board" | "model" = input.board && input.board.returns.length > 0 ? "board" : "model";
  const returnPercentile =
    returnSource === "board" ? percentileFromBoard(ret, input.board!.returns) : estimatePercentile(ret, input.field ?? DEFAULT_FIELD);

  const sharpePercentile = higherIsBetterPercentile(sharpe, input.sharpeField ?? DEFAULT_SHARPE_FIELD);
  const drawdownPercentile = lowerIsBetterPercentile(dd, input.drawdownField ?? DEFAULT_DRAWDOWN_FIELD);

  const riskDiscipline = input.riskSamples
    ? computeRiskDiscipline(input.riskSamples, input.riskIntervalMinutes ?? 15).score
    : 100;

  // §12.5 sparse-data cap on the SHARPE rank-score.
  let sharpeRankScore = sharpePercentile * 100;
  if (nObs < MIN_SHARPE_OBSERVATIONS) sharpeRankScore = Math.min(sharpeRankScore, 50);

  const finalScoreEst =
    w.returnRank * (returnPercentile * 100) +
    w.drawdownRank * (drawdownPercentile * 100) +
    w.sharpeRank * sharpeRankScore +
    w.riskDiscipline * riskDiscipline;

  const overallPercentileEst = clamp01(finalScoreEst / 100);
  const overallRankEst = percentileToRank(overallPercentileEst, n);
  const clearsCut = returnPercentile >= cutPercentile;

  // Bang-bang stance (mirrors rankTracker.assessStanding, driven by the RETURN percentile —
  // the only one that decides survival/standing in the tournament sense).
  const { stance } = deriveStance(returnPercentile, cutPercentile, input.phase);
  // Mirror barbellStrategy's sleeve gating: finals swing OR pre-finals endgame climb-into-cut.
  const inFinals = input.phase === "post_cut";
  const endgameWindow = input.sleeveEndgameWindow ?? 48;
  const nearCut = !inFinals && input.barsToCut !== undefined && input.barsToCut <= endgameWindow;
  const swingForFinals = inFinals && stance === "max_variance";
  const swingToClearCut = nearCut && !clearsCut;
  const sleeveArmed = swingForFinals || swingToClearCut;
  const sleeveReason = swingForFinals
    ? "finals & lagging → swing for #1 (final gating: reserve + liquidation-safe)"
    : swingToClearCut
      ? "endgame & below the cut → swing to climb into the Top-100"
      : inFinals
        ? `finals & ${stance} → lock in the prize slot`
        : nearCut
          ? "endgame but clearing the cut → lock in the finals slot, save the one-shot"
          : "pre-cut, not the endgame → hold (preserve the one-shot)";

  const standing: CompetitionStanding = {
    return: ret,
    returnPercentile,
    returnSource,
    sharpe,
    sharpeObs: nObs,
    sharpePercentile,
    maxDrawdown: dd,
    drawdownPercentile,
    riskDiscipline,
    finalScoreEst,
    overallPercentileEst,
    overallRankEst,
    fieldN: n,
    clearsCut,
    stance,
    sleeveArmed,
    sleeveReason,
    ...(input.liveRisk ? { liveRisk: input.liveRisk } : {}),
    asOf: input.asOf ?? "now",
    summary: "",
  };
  standing.summary = formatStanding(standing);
  return standing;
}

const PRE_CUT_SAFE_MARGIN = 0.1;
const POST_CUT_PRIZE_PERCENTILE = 0.9;

function deriveStance(percentile: number, cut: number, phase: "pre_cut" | "post_cut"): { stance: RiskStance; stanceReason: string } {
  if (phase === "pre_cut") {
    if (percentile < cut) return { stance: "max_variance", stanceReason: "below the cut — climb or be eliminated" };
    if (percentile < cut + PRE_CUT_SAFE_MARGIN) return { stance: "neutral", stanceReason: "just above the cut — thin margin, hold" };
    return { stance: "lock_in", stanceReason: "comfortably above the cut — lock in" };
  }
  if (percentile >= POST_CUT_PRIZE_PERCENTILE) return { stance: "lock_in", stanceReason: "top of the field post-cut — protect a prize slot" };
  return { stance: "max_variance", stanceReason: "mid/low post-cut — swing for #1" };
}

const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;
const signed = (x: number): string => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(2)}%`;

/** Operator-facing standing report. */
export function formatStanding(s: CompetitionStanding): string {
  const stanceLabel: Record<RiskStance, string> = {
    lock_in: "LOCK IN (min variance)",
    neutral: "NEUTRAL (hold)",
    max_variance: "MAX VARIANCE (swing)",
  };
  const riskLine = s.liveRisk ? `margin ${pct(s.liveRisk.marginUsage)} / lev ${s.liveRisk.leverage.toFixed(1)}x` : "—";
  const sharpeCap = s.sharpeObs < MIN_SHARPE_OBSERVATIONS ? ` (rank capped 50: <${MIN_SHARPE_OBSERVATIONS} obs)` : "";
  return [
    `STANDING @ ${s.asOf}`,
    `  return        ${signed(s.return).padStart(8)}   rank ~#${percentileToRank(s.returnPercentile, s.fieldN)}/${s.fieldN} (p${(s.returnPercentile * 100).toFixed(0)}, ${s.returnSource})`,
    `  15m Sharpe    ${(s.sharpe >= 0 ? "+" : "") + s.sharpe.toFixed(4)}   est rank ~#${percentileToRank(s.sharpePercentile, s.fieldN)} (model)${sharpeCap}`,
    `  max DD        ${pct(s.maxDrawdown).padStart(7)}   est rank ~#${percentileToRank(s.drawdownPercentile, s.fieldN)} (model)`,
    `  risk-disc     ${s.riskDiscipline}/100      ${riskLine}`,
    `  stance: ${stanceLabel[s.stance]} ${s.clearsCut ? "— clears cut" : "— below cut"}`,
    `  → ${s.sleeveArmed ? "SLEEVE ELIGIBLE" : "sleeve held"}: ${s.sleeveReason}`,
    `  est. final score ${s.finalScoreEst.toFixed(1)} → overall ~#${s.overallRankEst}/${s.fieldN}`,
  ].join("\n");
}
