/**
 * Trade Consistency Score
 *
 * Spicy's Stage 3 → Stage 2 gate: "before a strategy can be profitable
 * it must first be consistent." If every trade has different entry
 * timing, different stop placement, different target derivation, then
 * the data is noisy and the improvement process can't isolate variables.
 *
 * This primitive measures HOW SIMILAR the operator's recent trades are
 * to each other across four execution dimensions:
 *
 *   - Strategy-style stability   (single playbook vs mixing)
 *   - Entry-trigger similarity   (same trigger type recurring)
 *   - Stop-distance similarity   (CV on stop distance in R or %)
 *   - Target-distance similarity (CV on target distance)
 *
 * Each subscore is in [0, 1] (1 = perfectly consistent, 0 = maximum
 * divergence). The composite is a weighted average; verdict bands
 * are operator-tunable.
 *
 * INPUT: an array of TradeExecution objects — minimal shape with the
 * four execution dimensions. The operator extracts these from their
 * trade-ledger; the primitive doesn't read disk.
 *
 * Pure function.
 */
import { mean, sampleStd } from "./helpers.ts";

export interface TradeExecution {
  /** Strategy or playbook name — e.g. "breakout_long_resistance". */
  strategyId: string;
  /** Entry-trigger label — e.g. "limit_at_level", "market_on_breakout". */
  entryTriggerId: string;
  /**
   * Stop distance from entry. Either in R-multiples (preferred) OR a
   * percent-of-entry. Whatever the operator uses, just be consistent
   * across the array. The primitive measures CV, so units cancel.
   */
  stopDistance: number;
  /** Target distance from entry. Same convention as stopDistance. */
  targetDistance: number;
}

export interface TradeConsistencyOptions {
  /** Weight for strategy-style subscore. Default 0.30. */
  strategyWeight?: number;
  /** Weight for entry-trigger subscore. Default 0.25. */
  entryTriggerWeight?: number;
  /** Weight for stop-distance subscore. Default 0.225. */
  stopWeight?: number;
  /** Weight for target-distance subscore. Default 0.225. */
  targetWeight?: number;
  /** Minimum trades required for a verdict. Default 10. */
  minTrades?: number;
  /**
   * CV (coefficient of variation) above which the subscore collapses
   * to 0. Default 1.0 — std equal to mean is "max divergence".
   */
  cvCeiling?: number;
}

export type ConsistencyVerdict =
  | "highly_consistent"
  | "moderately_consistent"
  | "inconsistent"
  | "highly_inconsistent"
  | "insufficient_data";

export interface SubscoreBreakdown {
  strategy: number;
  entryTrigger: number;
  stopDistance: number;
  targetDistance: number;
}

export interface TradeConsistencyResult {
  sampleSize: number;
  strategyMode: string | null;
  strategyShare: number;
  entryTriggerMode: string | null;
  entryTriggerShare: number;
  stopCv: number;
  targetCv: number;
  subscores: SubscoreBreakdown;
  /** Weighted composite in [0, 1]. */
  compositeScore: number;
  verdict: ConsistencyVerdict;
  summary: string;
}

const DEFAULT_STRATEGY_WEIGHT = 0.30;
const DEFAULT_ENTRY_WEIGHT = 0.25;
const DEFAULT_STOP_WEIGHT = 0.225;
const DEFAULT_TARGET_WEIGHT = 0.225;
const DEFAULT_MIN_TRADES = 10;
const DEFAULT_CV_CEILING = 1.0;

function modeOf<T>(values: T[]): { mode: T | null; share: number } {
  if (values.length === 0) return { mode: null, share: 0 };
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let bestMode: T | null = null;
  let bestCount = 0;
  for (const [k, c] of counts) {
    if (c > bestCount) {
      bestCount = c;
      bestMode = k;
    }
  }
  return { mode: bestMode, share: bestCount / values.length };
}

function cv(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  if (m === 0) return 0;
  const s = sampleStd(values);
  return Math.abs(s / m);
}

function cvToSubscore(cvValue: number, ceiling: number): number {
  if (!Number.isFinite(cvValue)) return 0;
  if (cvValue <= 0) return 1;
  if (cvValue >= ceiling) return 0;
  return 1 - cvValue / ceiling;
}

function classifyVerdict(score: number): ConsistencyVerdict {
  if (score >= 0.80) return "highly_consistent";
  if (score >= 0.60) return "moderately_consistent";
  if (score >= 0.40) return "inconsistent";
  return "highly_inconsistent";
}

export function computeTradeConsistency(
  trades: ReadonlyArray<TradeExecution>,
  options: TradeConsistencyOptions = {},
): TradeConsistencyResult {
  const minTrades = options.minTrades ?? DEFAULT_MIN_TRADES;
  const cvCeiling = options.cvCeiling ?? DEFAULT_CV_CEILING;
  const wStrategy = options.strategyWeight ?? DEFAULT_STRATEGY_WEIGHT;
  const wEntry = options.entryTriggerWeight ?? DEFAULT_ENTRY_WEIGHT;
  const wStop = options.stopWeight ?? DEFAULT_STOP_WEIGHT;
  const wTarget = options.targetWeight ?? DEFAULT_TARGET_WEIGHT;

  if (trades.length < minTrades) {
    return {
      sampleSize: trades.length,
      strategyMode: null,
      strategyShare: 0,
      entryTriggerMode: null,
      entryTriggerShare: 0,
      stopCv: 0,
      targetCv: 0,
      subscores: { strategy: 0, entryTrigger: 0, stopDistance: 0, targetDistance: 0 },
      compositeScore: 0,
      verdict: "insufficient_data",
      summary: `Insufficient trades (${trades.length} < ${minTrades}).`,
    };
  }

  const { mode: strategyMode, share: strategyShare } = modeOf(trades.map((t) => t.strategyId));
  const { mode: entryMode, share: entryShare } = modeOf(trades.map((t) => t.entryTriggerId));
  const stopCv = cv(trades.map((t) => t.stopDistance));
  const targetCv = cv(trades.map((t) => t.targetDistance));

  const subscores: SubscoreBreakdown = {
    strategy: strategyShare,
    entryTrigger: entryShare,
    stopDistance: cvToSubscore(stopCv, cvCeiling),
    targetDistance: cvToSubscore(targetCv, cvCeiling),
  };

  const totalWeight = wStrategy + wEntry + wStop + wTarget;
  const composite =
    (subscores.strategy * wStrategy +
      subscores.entryTrigger * wEntry +
      subscores.stopDistance * wStop +
      subscores.targetDistance * wTarget) /
    totalWeight;

  const verdict = classifyVerdict(composite);

  const summary =
    `${trades.length} trades. ` +
    `Strategy "${strategyMode}" (${(strategyShare * 100).toFixed(0)}% share), ` +
    `entry "${entryMode}" (${(entryShare * 100).toFixed(0)}% share). ` +
    `Stop CV: ${stopCv.toFixed(2)}, target CV: ${targetCv.toFixed(2)}. ` +
    `Composite ${composite.toFixed(2)} → ${verdict}.`;

  return {
    sampleSize: trades.length,
    strategyMode: strategyMode as string,
    strategyShare: parseFloat(strategyShare.toFixed(4)),
    entryTriggerMode: entryMode as string,
    entryTriggerShare: parseFloat(entryShare.toFixed(4)),
    stopCv: parseFloat(stopCv.toFixed(4)),
    targetCv: parseFloat(targetCv.toFixed(4)),
    subscores: {
      strategy: parseFloat(subscores.strategy.toFixed(4)),
      entryTrigger: parseFloat(subscores.entryTrigger.toFixed(4)),
      stopDistance: parseFloat(subscores.stopDistance.toFixed(4)),
      targetDistance: parseFloat(subscores.targetDistance.toFixed(4)),
    },
    compositeScore: parseFloat(composite.toFixed(4)),
    verdict,
    summary,
  };
}

export function formatTradeConsistency(result: TradeConsistencyResult): string {
  const lines = [
    `Trade Consistency — ${result.verdict.toUpperCase()}`,
    "",
    `  Sample size: ${result.sampleSize}`,
    `  Strategy mode: ${result.strategyMode ?? "—"} (${(result.strategyShare * 100).toFixed(0)}%)`,
    `  Entry-trigger mode: ${result.entryTriggerMode ?? "—"} (${(result.entryTriggerShare * 100).toFixed(0)}%)`,
    `  Stop-distance CV: ${result.stopCv.toFixed(2)}`,
    `  Target-distance CV: ${result.targetCv.toFixed(2)}`,
    "",
    "  Subscores:",
    `    Strategy:        ${result.subscores.strategy.toFixed(2)}`,
    `    Entry trigger:   ${result.subscores.entryTrigger.toFixed(2)}`,
    `    Stop distance:   ${result.subscores.stopDistance.toFixed(2)}`,
    `    Target distance: ${result.subscores.targetDistance.toFixed(2)}`,
    "",
    `  Composite: ${result.compositeScore.toFixed(2)}`,
    "",
    `Summary: ${result.summary}`,
  ];
  return lines.join("\n");
}
