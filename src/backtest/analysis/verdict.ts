/**
 * Backtest Verdict — Two-Layer Screening
 *
 * Inspired by autotrade-main's [VERDICT] pattern: a single machine-parseable
 * verdict line that summarizes whether a backtest result should be kept,
 * discarded, or treated as a crash. Gordon's backtest tools return rich
 * metrics; this module reduces them to a single decision using two layers:
 *
 *   Layer 1 — Statistical validity (fail-fast):
 *     - Minimum trade count (reject if too few to trust statistics)
 *     - Minimum approximate exposure (reject if strategy barely trades)
 *
 *   Layer 2 — Risk-adjusted returns (only if Layer 1 passed):
 *     - Minimum Sharpe ratio
 *     - Minimum Calmar ratio
 *     - Maximum drawdown cap
 *
 * A CRASH verdict fires when the result is structurally invalid (zero trades,
 * NaN metrics). Prevents the classic "100% return on 3 trades" trap and makes
 * the auto-optimizer's decisions more robust.
 */

import type { BacktestMetrics } from "../types.ts";

// ============================================================================
// Types
// ============================================================================

export type BacktestVerdict =
  | "ELIGIBLE"
  | "DISCARD_SAMPLE_SIZE"
  | "DISCARD_RISK"
  | "DISCARD_PROFIT"
  | "CRASH";

export interface VerdictThresholds {
  /** Minimum trades required before trusting risk-adjusted metrics. */
  minTrades: number;
  /** Minimum approximate exposure percentage (time in market). */
  minExposurePct: number;
  /** Minimum Sharpe ratio. */
  minSharpe: number;
  /** Minimum Calmar ratio (annualized return / max drawdown). */
  minCalmar: number;
  /** Maximum allowed drawdown percentage (positive number, e.g. 30 = 30%). */
  maxDrawdownPct: number;
  /** Maximum allowed profit factor NaN tolerance — if unset, missing is fine. */
  requireProfitFactor?: boolean;
}

export interface VerdictResult {
  verdict: BacktestVerdict;
  /** Human-readable line for logs / journals — machine-parseable. */
  verdictLine: string;
  /** Reasons the result failed (empty when ELIGIBLE). */
  violations: string[];
  /** Per-check pass/fail breakdown. */
  checks: {
    sampleSize: boolean;
    exposure: boolean;
    drawdownCap: boolean;
    sharpe: boolean;
    calmar: boolean;
  };
  /** Thresholds that were applied (echoed for audit). */
  thresholds: VerdictThresholds;
}

// ============================================================================
// Defaults
// ============================================================================

export const DEFAULT_VERDICT_THRESHOLDS: VerdictThresholds = {
  minTrades: 20,
  minExposurePct: 20,
  minSharpe: 1.0,
  minCalmar: 0.5,
  maxDrawdownPct: 30,
};

/**
 * Conservative thresholds for live-eligible strategies. Higher bars than default.
 */
export const STRICT_VERDICT_THRESHOLDS: VerdictThresholds = {
  minTrades: 50,
  minExposurePct: 30,
  minSharpe: 1.5,
  minCalmar: 1.0,
  maxDrawdownPct: 20,
};

// ============================================================================
// Main
// ============================================================================

/**
 * Compute a verdict for a backtest result. Pure function — no I/O.
 *
 * Order of checks:
 *   1. CRASH — zero trades or NaN metrics → cannot evaluate
 *   2. DISCARD_SAMPLE_SIZE — too few trades or no exposure
 *   3. DISCARD_RISK — drawdown cap exceeded
 *   4. DISCARD_PROFIT — Sharpe or Calmar below threshold
 *   5. ELIGIBLE — all checks passed
 *
 * Exposure is approximated as `(avgTradeDuration * totalTrades) / totalBars`
 * when available; otherwise we fall back to a cheap heuristic that treats
 * exposure as "did the strategy trade at all on most days of the window."
 */
export function computeVerdict(
  metrics: BacktestMetrics,
  thresholds: VerdictThresholds = DEFAULT_VERDICT_THRESHOLDS,
  windowDays?: number,
): VerdictResult {
  const violations: string[] = [];

  const checks = {
    sampleSize: false,
    exposure: false,
    drawdownCap: false,
    sharpe: false,
    calmar: false,
  };

  // ---- CRASH detection ----
  const metricsHaveNaN =
    !Number.isFinite(metrics.sharpeRatio) ||
    !Number.isFinite(metrics.totalReturn) ||
    !Number.isFinite(metrics.maxDrawdown);

  if (metrics.totalTrades === 0 || metricsHaveNaN) {
    return {
      verdict: "CRASH",
      verdictLine: "[VERDICT] CRASH — zero trades or invalid metrics",
      violations: ["crash: zero trades or non-finite metrics"],
      checks,
      thresholds,
    };
  }

  // ---- Layer 1: sample size + exposure ----
  checks.sampleSize = metrics.totalTrades >= thresholds.minTrades;
  if (!checks.sampleSize) {
    violations.push(
      `sample_size: ${metrics.totalTrades} trades < ${thresholds.minTrades} minimum`,
    );
  }

  const exposurePct = approximateExposurePct(metrics, windowDays);
  checks.exposure = exposurePct >= thresholds.minExposurePct;
  if (!checks.exposure) {
    violations.push(
      `exposure: ${exposurePct.toFixed(1)}% < ${thresholds.minExposurePct}% minimum`,
    );
  }

  if (!checks.sampleSize || !checks.exposure) {
    return {
      verdict: "DISCARD_SAMPLE_SIZE",
      verdictLine: `[VERDICT] DISCARD (sample_size) — ${violations.join("; ")}`,
      violations,
      checks,
      thresholds,
    };
  }

  // ---- Layer 2a: risk (drawdown cap) ----
  const absDrawdown = Math.abs(metrics.maxDrawdown);
  checks.drawdownCap = absDrawdown <= thresholds.maxDrawdownPct;
  if (!checks.drawdownCap) {
    violations.push(
      `drawdown: ${absDrawdown.toFixed(1)}% > ${thresholds.maxDrawdownPct}% cap`,
    );
    return {
      verdict: "DISCARD_RISK",
      verdictLine: `[VERDICT] DISCARD (risk) — ${violations.join("; ")}`,
      violations,
      checks,
      thresholds,
    };
  }

  // ---- Layer 2b: profit (risk-adjusted) ----
  checks.sharpe = metrics.sharpeRatio >= thresholds.minSharpe;
  if (!checks.sharpe) {
    violations.push(
      `sharpe: ${metrics.sharpeRatio.toFixed(2)} < ${thresholds.minSharpe} minimum`,
    );
  }

  // Calmar can be missing on short runs; treat missing as fail
  const calmar = Number.isFinite(metrics.calmarRatio) ? metrics.calmarRatio : 0;
  checks.calmar = calmar >= thresholds.minCalmar;
  if (!checks.calmar) {
    violations.push(
      `calmar: ${calmar.toFixed(2)} < ${thresholds.minCalmar} minimum`,
    );
  }

  if (!checks.sharpe || !checks.calmar) {
    return {
      verdict: "DISCARD_PROFIT",
      verdictLine: `[VERDICT] DISCARD (profit) — ${violations.join("; ")}`,
      violations,
      checks,
      thresholds,
    };
  }

  return {
    verdict: "ELIGIBLE",
    verdictLine:
      `[VERDICT] ELIGIBLE — ${metrics.totalTrades} trades, ` +
      `Sharpe ${metrics.sharpeRatio.toFixed(2)}, Calmar ${calmar.toFixed(2)}, ` +
      `DD ${absDrawdown.toFixed(1)}%`,
    violations: [],
    checks,
    thresholds,
  };
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Approximate exposure percentage from metrics. Gordon's BacktestMetrics does
 * not currently carry an exposure field, so we estimate:
 *
 *   exposure_pct ≈ (avgTradeDuration_hours * totalTrades) / window_hours * 100
 *
 * Falls back to `(totalTrades / max(windowDays, 1)) * 4` when duration is
 * unavailable — assumes roughly 4% of window is spent in-trade per trade, a
 * loose heuristic tuned to typical 4h-timeframe strategies.
 */
function approximateExposurePct(
  metrics: BacktestMetrics,
  windowDays?: number,
): number {
  const days = windowDays ?? 90;
  const windowHours = days * 24;
  const avgDuration = metrics.avgTradeDuration ?? metrics.avgHoldingPeriod ?? 0;
  if (avgDuration > 0 && windowHours > 0) {
    return Math.min(100, (avgDuration * metrics.totalTrades) / windowHours * 100);
  }
  // Fallback heuristic — assumes each trade takes ~4% of a 90-day window
  return Math.min(100, metrics.totalTrades * 4);
}

/**
 * Short one-line summary suitable for display. Not machine-parseable — use
 * `verdictLine` for parsing. This is for UIs and logs.
 */
export function formatVerdictSummary(result: VerdictResult): string {
  const icon =
    result.verdict === "ELIGIBLE" ? "✓" :
    result.verdict === "CRASH" ? "✗" : "⚠";
  return `${icon} ${result.verdict}${result.violations.length ? ` — ${result.violations[0]}` : ""}`;
}
