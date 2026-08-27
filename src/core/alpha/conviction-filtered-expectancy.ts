/**
 * Conviction-Filtered Expectancy Simulator
 *
 * Operationalizes the empirical observation from intraday-trader
 * post-mortems: "147 trades / 83% losses, but when we isolated only
 * the top 20% highest-conviction setups, those were 62% winners."
 * The hidden edge buried in noise pattern.
 *
 * Given a trade ledger + a continuous conviction/quality score per
 * trade, sort trades by conviction descending, compute cumulative
 * expectancy at each threshold, and find the threshold that
 * maximizes total realized PnL while minimizing trade count.
 *
 * Distinct from:
 *   - `expectancy-by-tag.ts`     (categorical tags only, not
 *                                  continuous quality scores; no
 *                                  threshold optimization)
 *   - `constraint-identifier.ts` (EV-component decomposition; doesn't
 *                                  filter by quality)
 *   - `trade-consistency.ts`     (measures execution similarity, not
 *                                  quality-vs-outcome relationship)
 *
 * Pure function. Operator supplies conviction scores per trade
 * (could be a checklist tally, a model output, a self-assessed
 * grade, an indicator-stack sum — whatever the operator uses).
 *
 * Optimization objectives supported:
 *   - "total_pnl"     — maximize cumulative PnL across kept trades
 *   - "avg_pnl"       — maximize per-trade expected PnL
 *   - "sharpe"        — maximize mean/std of kept trades
 *   - "pnl_per_hour"  — maximize PnL given a fixed time budget per
 *                       trade (operator-supplied)
 */
import { sampleStd } from "./helpers.ts";

export interface TradeRecord {
  /** Identifier for the trade. */
  tradeId: string;
  /**
   * Conviction / quality score. Higher = higher quality. Operator
   * supplies the scale; the primitive only ranks relatively.
   */
  conviction: number;
  /**
   * Realized P&L on the trade. Sign convention: positive = winner.
   * Units don't matter (R-multiples, dollars, %) as long as the
   * caller is consistent.
   */
  pnl: number;
}

export interface ConvictionFilteredExpectancyOptions {
  /**
   * Optimization objective. Default "total_pnl".
   */
  objective?: "total_pnl" | "avg_pnl" | "sharpe" | "pnl_per_hour";
  /**
   * Minimum number of trades that must remain after filtering for
   * a threshold to be a valid candidate. Default 10 (so the optimal
   * subset isn't degenerate, e.g., one lucky trade).
   */
  minKeptTrades?: number;
  /**
   * Optional time-per-trade for the "pnl_per_hour" objective. Same
   * units as the operator wants the rate expressed in.
   */
  timePerTrade?: number;
  /**
   * Number of evenly-spaced conviction thresholds to evaluate.
   * Default = unique-conviction-values up to a cap of 200.
   */
  thresholdResolution?: number;
}

export interface ThresholdSimulation {
  /** Conviction threshold (trades with score ≥ this are kept). */
  threshold: number;
  /** Number of trades passing the filter. */
  keptCount: number;
  /** Fraction of original trades kept (0..1). */
  keptFraction: number;
  /** Sum of PnL across kept trades. */
  totalPnl: number;
  /** Mean PnL per kept trade. */
  avgPnl: number;
  /** Hit rate on kept trades. */
  hitRate: number;
  /** Std dev of kept-trade PnL (sample, Bessel-corrected). */
  stdPnl: number;
  /** Sharpe-like ratio = avgPnl / stdPnl (when std > 0). */
  sharpeRatio: number;
  /** PnL per hour (or unit-time), when timePerTrade is supplied. */
  pnlPerHour: number | null;
  /** Objective value used for ranking. */
  objectiveValue: number;
}

export type ConvictionVerdict =
  | "filtered_edge_found"
  | "no_edge_at_any_threshold"
  | "baseline_already_optimal"
  | "insufficient_data";

export interface ConvictionFilteredExpectancyResult {
  totalTrades: number;
  baselineMetrics: ThresholdSimulation;
  optimalThreshold: ThresholdSimulation | null;
  /**
   * Improvement in objective vs baseline (all trades). Positive when
   * filtering helps.
   */
  improvementOverBaseline: number;
  /**
   * Fraction of original trades that the optimal threshold keeps.
   * Operator interpretation: "if I only took my top X% by
   * conviction, here's how things would have looked."
   */
  optimalKeptFraction: number;
  /** Sample of thresholds simulated, sorted ascending by threshold. */
  thresholdCurve: ThresholdSimulation[];
  verdict: ConvictionVerdict;
  summary: string;
}

const DEFAULT_MIN_KEPT_TRADES = 10;
const DEFAULT_THRESHOLD_CAP = 200;

function simulateAtThreshold(
  trades: ReadonlyArray<TradeRecord>,
  threshold: number,
  objective: ConvictionFilteredExpectancyOptions["objective"],
  timePerTrade: number | undefined,
): ThresholdSimulation {
  const kept = trades.filter((t) => t.conviction >= threshold);
  const keptCount = kept.length;
  const keptFraction = trades.length > 0 ? keptCount / trades.length : 0;
  if (keptCount === 0) {
    return {
      threshold,
      keptCount: 0,
      keptFraction: 0,
      totalPnl: 0,
      avgPnl: 0,
      hitRate: 0,
      stdPnl: 0,
      sharpeRatio: 0,
      pnlPerHour: timePerTrade !== undefined ? 0 : null,
      objectiveValue: -Infinity,
    };
  }
  const pnls = kept.map((t) => t.pnl);
  const total = pnls.reduce((a, b) => a + b, 0);
  const avg = total / keptCount;
  const wins = kept.filter((t) => t.pnl > 0).length;
  const hitRate = wins / keptCount;
  const std = sampleStd(pnls);
  const sharpe = std > 0 ? avg / std : 0;
  const pnlPerHour =
    timePerTrade !== undefined && timePerTrade > 0 ? total / (keptCount * timePerTrade) : null;

  let objectiveValue: number;
  switch (objective) {
    case "avg_pnl":
      objectiveValue = avg;
      break;
    case "sharpe":
      objectiveValue = sharpe;
      break;
    case "pnl_per_hour":
      objectiveValue = pnlPerHour ?? -Infinity;
      break;
    default:
      objectiveValue = total;
      break;
  }

  return {
    threshold: parseFloat(threshold.toFixed(6)),
    keptCount,
    keptFraction: parseFloat(keptFraction.toFixed(6)),
    totalPnl: parseFloat(total.toFixed(6)),
    avgPnl: parseFloat(avg.toFixed(6)),
    hitRate: parseFloat(hitRate.toFixed(6)),
    stdPnl: parseFloat(std.toFixed(6)),
    sharpeRatio: parseFloat(sharpe.toFixed(6)),
    pnlPerHour: pnlPerHour === null ? null : parseFloat(pnlPerHour.toFixed(6)),
    objectiveValue: parseFloat(objectiveValue.toFixed(6)),
  };
}

export function simulateConvictionFilteredExpectancy(
  trades: ReadonlyArray<TradeRecord>,
  options: ConvictionFilteredExpectancyOptions = {},
): ConvictionFilteredExpectancyResult {
  const objective = options.objective ?? "total_pnl";
  const minKept = options.minKeptTrades ?? DEFAULT_MIN_KEPT_TRADES;
  const resolutionCap = options.thresholdResolution ?? DEFAULT_THRESHOLD_CAP;

  if (trades.length < minKept) {
    return {
      totalTrades: trades.length,
      baselineMetrics: simulateAtThreshold(trades, -Infinity, objective, options.timePerTrade),
      optimalThreshold: null,
      improvementOverBaseline: 0,
      optimalKeptFraction: 0,
      thresholdCurve: [],
      verdict: "insufficient_data",
      summary: `Insufficient trades (${trades.length} < ${minKept} minimum).`,
    };
  }

  // Baseline = keep all trades (threshold = -Infinity, i.e., min conviction).
  const minConviction = Math.min(...trades.map((t) => t.conviction));
  const baseline = simulateAtThreshold(trades, minConviction, objective, options.timePerTrade);

  // Build threshold candidate set: unique conviction values, capped at
  // resolutionCap evenly-spaced quantiles to avoid pathological cost
  // on huge ledgers.
  const sortedConvictions = [...new Set(trades.map((t) => t.conviction))].sort((a, b) => a - b);
  let candidates: number[];
  if (sortedConvictions.length <= resolutionCap) {
    candidates = sortedConvictions;
  } else {
    candidates = [];
    for (let i = 0; i < resolutionCap; i++) {
      const idx = Math.floor((i / (resolutionCap - 1)) * (sortedConvictions.length - 1));
      candidates.push(sortedConvictions[idx]!);
    }
  }

  const curve: ThresholdSimulation[] = [];
  let best: ThresholdSimulation | null = null;
  for (const t of candidates) {
    const sim = simulateAtThreshold(trades, t, objective, options.timePerTrade);
    if (sim.keptCount >= minKept) {
      curve.push(sim);
      if (best === null || sim.objectiveValue > best.objectiveValue) {
        best = sim;
      }
    }
  }

  if (best === null) {
    return {
      totalTrades: trades.length,
      baselineMetrics: baseline,
      optimalThreshold: null,
      improvementOverBaseline: 0,
      optimalKeptFraction: 0,
      thresholdCurve: curve,
      verdict: "insufficient_data",
      summary: `No threshold left ≥ ${minKept} trades. Lower minKeptTrades or supply more data.`,
    };
  }

  const improvement = best.objectiveValue - baseline.objectiveValue;
  let verdict: ConvictionVerdict;
  if (improvement <= 0) {
    verdict = "baseline_already_optimal";
  } else if (best.objectiveValue <= 0) {
    verdict = "no_edge_at_any_threshold";
  } else {
    verdict = "filtered_edge_found";
  }

  const summary =
    `${trades.length} trades analyzed. Baseline (keep all): ` +
    `${objective}=${baseline.objectiveValue.toFixed(4)}, ` +
    `hit ${(baseline.hitRate * 100).toFixed(0)}%, total PnL ${baseline.totalPnl.toFixed(2)}. ` +
    `Optimal threshold ${best.threshold.toFixed(4)}: keep ${best.keptCount} ` +
    `(${(best.keptFraction * 100).toFixed(0)}%), hit ${(best.hitRate * 100).toFixed(0)}%, ` +
    `total PnL ${best.totalPnl.toFixed(2)}. ` +
    `${objective} improvement: ${improvement >= 0 ? "+" : ""}${improvement.toFixed(4)}. → ${verdict}`;

  return {
    totalTrades: trades.length,
    baselineMetrics: baseline,
    optimalThreshold: best,
    improvementOverBaseline: parseFloat(improvement.toFixed(6)),
    optimalKeptFraction: best.keptFraction,
    thresholdCurve: curve,
    verdict,
    summary,
  };
}

export function formatConvictionFilteredExpectancy(
  result: ConvictionFilteredExpectancyResult,
): string {
  const lines = [
    `Conviction-Filtered Expectancy — ${result.verdict.toUpperCase()}`,
    "",
    `  Total trades analyzed: ${result.totalTrades}`,
    "",
    "  Baseline (keep all trades):",
    `    Hit rate:    ${(result.baselineMetrics.hitRate * 100).toFixed(1)}%`,
    `    Total PnL:   ${result.baselineMetrics.totalPnl.toFixed(2)}`,
    `    Avg PnL:     ${result.baselineMetrics.avgPnl.toFixed(4)}`,
    `    Sharpe:      ${result.baselineMetrics.sharpeRatio.toFixed(3)}`,
  ];
  if (result.optimalThreshold !== null) {
    lines.push("");
    lines.push(`  Optimal threshold: ${result.optimalThreshold.threshold.toFixed(4)}`);
    lines.push(
      `    Kept count:  ${result.optimalThreshold.keptCount} (${(result.optimalThreshold.keptFraction * 100).toFixed(1)}% of original)`,
    );
    lines.push(`    Hit rate:    ${(result.optimalThreshold.hitRate * 100).toFixed(1)}%`);
    lines.push(`    Total PnL:   ${result.optimalThreshold.totalPnl.toFixed(2)}`);
    lines.push(`    Avg PnL:     ${result.optimalThreshold.avgPnl.toFixed(4)}`);
    lines.push(`    Sharpe:      ${result.optimalThreshold.sharpeRatio.toFixed(3)}`);
    lines.push("");
    lines.push(
      `  Improvement over baseline: ${result.improvementOverBaseline >= 0 ? "+" : ""}${result.improvementOverBaseline.toFixed(4)}`,
    );
  }
  lines.push("");
  lines.push(`Summary: ${result.summary}`);
  if (result.verdict === "filtered_edge_found") {
    lines.push("");
    lines.push("→ A hidden edge exists in the top-conviction subset. The operator");
    lines.push("  is likely diluting it by taking lower-conviction trades.");
  } else if (result.verdict === "no_edge_at_any_threshold") {
    lines.push("");
    lines.push("⚠ No threshold produces positive PnL. The conviction scoring may");
    lines.push("  be uncorrelated with outcomes, or the underlying strategy may");
    lines.push("  be unprofitable regardless of filtering.");
  } else if (result.verdict === "baseline_already_optimal") {
    lines.push("");
    lines.push("→ Filtering by conviction does not improve outcomes. Either the");
    lines.push("  operator is already disciplined or the conviction signal carries");
    lines.push("  no information about outcomes.");
  }
  return lines.join("\n");
}
