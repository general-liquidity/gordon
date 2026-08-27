/**
 * Post-run enrichment — single entry point that runs the dormant analysis
 * and optimization layers (verdict, Monte Carlo, overfitting, alpha decay)
 * over an engine result so tool callers get screening + robustness stats
 * without composing the modules themselves.
 */

import type { BacktestEngineResult } from "./types.ts";
import {
  computeVerdict,
  DEFAULT_VERDICT_THRESHOLDS,
  type VerdictResult,
  type VerdictThresholds,
} from "./analysis/verdict.ts";
import {
  runMonteCarloSimulation,
  type MonteCarloConfig,
  type MonteCarloResult,
} from "./analysis/monte-carlo.ts";
import { analyzeAlphaDecay, type AlphaDecayResult } from "./analysis/alpha-decay.ts";
import {
  detectOverfitting,
  type OptimizationEntry,
  type OverfittingDetectionOptions,
  type OverfittingResult,
} from "./optimization/overfitting.ts";

export interface EnrichBacktestOptions {
  verdictThresholds?: VerdictThresholds;
  /** `false` skips the Monte Carlo pass entirely. */
  monteCarlo?: Partial<MonteCarloConfig> | false;
  /** Ranked parameter-sweep entries; presence triggers overfitting detection. */
  optimizationEntries?: OptimizationEntry[];
  overfittingOptions?: OverfittingDetectionOptions;
  /** Delay-keyed metric maps from delayed-entry re-runs; presence triggers alpha-decay analysis. */
  delayedResults?: Record<number, Record<string, unknown>>;
  alphaDecayMetric?: string;
}

export interface BacktestEnrichment {
  verdict: VerdictResult;
  monteCarlo?: MonteCarloResult;
  overfitting?: OverfittingResult;
  alphaDecay?: AlphaDecayResult | { error: string };
  /** One line per pass, machine-parseable, ready for tool output / journals. */
  summaryLines: string[];
}

export async function enrichBacktestResult(
  engineResult: BacktestEngineResult,
  options: EnrichBacktestOptions = {},
): Promise<BacktestEnrichment> {
  const windowDays = Math.max(1, (engineResult.endDate - engineResult.startDate) / 86_400_000);

  const verdict = computeVerdict(
    engineResult.metrics,
    options.verdictThresholds ?? DEFAULT_VERDICT_THRESHOLDS,
    windowDays,
  );
  const summaryLines: string[] = [verdict.verdictLine];

  let monteCarlo: MonteCarloResult | undefined;
  if (options.monteCarlo !== false && engineResult.trades.length > 0) {
    monteCarlo = await runMonteCarloSimulation(engineResult.trades, {
      initialCapital: engineResult.params.initialCapital,
      ...options.monteCarlo,
    });
    summaryLines.push(
      `[MONTE_CARLO] ${monteCarlo.robustness.verdict} — score ${monteCarlo.robustness.score}/100, ` +
        `P(profit) ${(monteCarlo.scenarios.profitProbability * 100).toFixed(0)}%, ` +
        `VaR5 ${monteCarlo.riskMetrics.valueAtRisk5.toFixed(1)}%`,
    );
  }

  let overfitting: OverfittingResult | undefined;
  if (options.optimizationEntries && options.optimizationEntries.length > 0) {
    overfitting = detectOverfitting(options.optimizationEntries, options.overfittingOptions);
    summaryLines.push(
      `[OVERFITTING] ${overfitting.severity} — score ${overfitting.overfitScore.toFixed(2)}, ` +
        `${overfitting.analysis.combinationsTested} combinations, ` +
        `${overfitting.analysis.profitablePercent.toFixed(0)}% profitable`,
    );
  }

  let alphaDecay: AlphaDecayResult | { error: string } | undefined;
  if (options.delayedResults && Object.keys(options.delayedResults).length > 0) {
    alphaDecay = analyzeAlphaDecay(options.delayedResults, options.alphaDecayMetric);
    summaryLines.push(
      "error" in alphaDecay
        ? `[ALPHA_DECAY] error — ${alphaDecay.error}`
        : `[ALPHA_DECAY] max decay ${alphaDecay.summary.maxDecayPercent.toFixed(1)}%, ` +
            `max tolerable delay ${alphaDecay.maxTolerableDelay ?? "none"}`,
    );
  }

  return { verdict, monteCarlo, overfitting, alphaDecay, summaryLines };
}
