/**
 * Replay verdict — pass/fail logic for the four required outputs from
 * a replay run.
 *
 * Pass criteria (from the post):
 *
 *   1. Maximum event drawdown ≤ strategy's 99th-percentile backtested
 *      DD (the strategy must behave like itself even in stress).
 *   2. Risk-engine response time < duration of the vol expansion
 *      (sizing must react before the move completes).
 *   3. Maximum single-trade slippage ≤ operator-set ceiling (default
 *      200 bps — strategies that gap through stops by more than 2%
 *      of position notional should be flagged regardless of P&L).
 *
 * All thresholds are operator-supplied; the verdict module just
 * applies them. Failing ANY criterion fails the verdict; reasons are
 * accumulated so the operator sees all the failure modes at once.
 *
 * Conservative bias: when a threshold isn't supplied, the criterion
 * is treated as "not yet evaluated" rather than "passed by default" —
 * the verdict result records which criteria were actually tested.
 */

import type { ReplayMetrics, ReplayVerdict, VerdictThresholds } from "./types.ts";

const DEFAULT_MAX_SLIPPAGE_BPS = 200;

/**
 * Evaluate a replay's metrics against operator-supplied thresholds.
 *
 * @param metrics  Output from runEventReplay
 * @param thresholds Operator thresholds (any combination of the three)
 * @returns Verdict with passed flag + reasons
 */
export function evaluateReplay(
  metrics: ReplayMetrics,
  thresholds: VerdictThresholds = {},
): ReplayVerdict {
  const reasons: string[] = [];
  let passed = true;
  const evaluated: VerdictThresholds = {};

  // 1. Drawdown check
  if (thresholds.baseline99thPctDrawdown !== undefined) {
    evaluated.baseline99thPctDrawdown = thresholds.baseline99thPctDrawdown;
    if (metrics.maxIntradayDrawdown > thresholds.baseline99thPctDrawdown) {
      passed = false;
      reasons.push(
        `Drawdown ${(metrics.maxIntradayDrawdown * 100).toFixed(2)}% exceeded 99th-pct baseline ` +
          `${(thresholds.baseline99thPctDrawdown * 100).toFixed(2)}%`,
      );
    } else {
      reasons.push(
        `Drawdown ${(metrics.maxIntradayDrawdown * 100).toFixed(2)}% within 99th-pct baseline ` +
          `${(thresholds.baseline99thPctDrawdown * 100).toFixed(2)}%`,
      );
    }
  }

  // 2. Risk response time
  if (thresholds.responseTimeBudgetSeconds !== undefined) {
    evaluated.responseTimeBudgetSeconds = thresholds.responseTimeBudgetSeconds;
    if (metrics.riskResponseTimeSeconds === null) {
      passed = false;
      reasons.push(
        `Strategy never reduced exposure during the event — response time budget ` +
          `${thresholds.responseTimeBudgetSeconds}s exceeded indefinitely`,
      );
    } else if (metrics.riskResponseTimeSeconds > thresholds.responseTimeBudgetSeconds) {
      passed = false;
      reasons.push(
        `Risk response ${metrics.riskResponseTimeSeconds.toFixed(0)}s exceeded budget ` +
          `${thresholds.responseTimeBudgetSeconds}s`,
      );
    } else {
      reasons.push(
        `Risk response ${metrics.riskResponseTimeSeconds.toFixed(0)}s within budget ` +
          `${thresholds.responseTimeBudgetSeconds}s`,
      );
    }
  }

  // 3. Slippage ceiling
  const slippageCeiling = thresholds.maxAcceptableSlippageBps ?? DEFAULT_MAX_SLIPPAGE_BPS;
  evaluated.maxAcceptableSlippageBps = slippageCeiling;
  if (metrics.maxSingleTradeSlippage > slippageCeiling) {
    passed = false;
    reasons.push(
      `Worst single-trade slippage ${metrics.maxSingleTradeSlippage.toFixed(1)}bps exceeded ` +
        `${slippageCeiling}bps ceiling`,
    );
  } else {
    reasons.push(
      `Worst single-trade slippage ${metrics.maxSingleTradeSlippage.toFixed(1)}bps within ` +
        `${slippageCeiling}bps ceiling`,
    );
  }

  // 0 evaluated thresholds is an edge case — operator gets a verdict
  // with no signal. Report as passed-but-untested so they backfill.
  if (
    thresholds.baseline99thPctDrawdown === undefined &&
    thresholds.responseTimeBudgetSeconds === undefined &&
    thresholds.maxAcceptableSlippageBps === undefined
  ) {
    reasons.unshift(
      "No thresholds supplied — verdict reflects only the default 200bps slippage ceiling",
    );
  }

  return {
    passed,
    eventId: metrics.eventId,
    reasons,
    metrics,
    comparedTo: evaluated,
  };
}

/**
 * Format a verdict as operator-readable text. Used by audit / report
 * surfaces; the structured verdict is the source of truth.
 */
export function formatVerdict(verdict: ReplayVerdict): string {
  const status = verdict.passed ? "PASS" : "FAIL";
  const lines = [
    `Event Replay: ${verdict.eventId} — ${status}`,
    "",
    `  Max DD:           ${(verdict.metrics.maxIntradayDrawdown * 100).toFixed(2)}%`,
    `  Event PnL:        ${verdict.metrics.eventWindowPnl.toFixed(2)}`,
    `  Max slippage:     ${verdict.metrics.maxSingleTradeSlippage.toFixed(1)} bps`,
    `  Risk response:    ${
      verdict.metrics.riskResponseTimeSeconds === null
        ? "never reduced"
        : `${verdict.metrics.riskResponseTimeSeconds.toFixed(0)}s`
    }`,
    "",
    "Reasons:",
    ...verdict.reasons.map((r) => `  - ${r}`),
  ];
  return lines.join("\n");
}
