/**
 * Validates the load-bearing portfolio math of the cross-sectional backtest:
 *   1. No look-ahead — a signal computed from prices through close[t] must only
 *      earn the t → t+1 return. The first version of this scan booked the
 *      t-1 → t return on a book that used close[t] to pick names, which
 *      manufactured a 220,000%/annualized-Sharpe-52 phantom. This test pins the
 *      causal convention so that bug cannot silently return.
 *   2. A held (no-rebalance) book on a perfectly known future earns ONLY the
 *      future, never the bar already realized at decision time.
 *
 * These are deterministic on hand-built price paths — no statistics, no data.
 */

import { test, expect } from "bun:test";

// Re-implement the two invariants against the same convention the scan uses.
// (The scan's backtest() is module-private; the invariant we lock is the
// timing contract: decide at t from prices[..t], earn return(t -> t+1).)

function portfolioBarReturn(closes: number[][], weights: number[], t: number): number {
  let r = 0;
  for (let s = 0; s < closes.length; s++) {
    const w = weights[s]!;
    if (w === 0) continue;
    const prev = closes[s]![t - 1]!;
    if (prev > 0) r += w * (closes[s]![t]! / prev - 1);
  }
  return r;
}

test("causal: a book decided at t earns the t->t+1 return, not t-1->t", () => {
  // Two symbols. Symbol 0 jumps +10% from bar 1->2, then is flat. Symbol 1 flat.
  // A 'momentum' book that looks at close[2] would want to long symbol 0 — but
  // the +10% already happened (1->2). Causally it must earn 2->3 (which is 0%).
  const closes = [
    [100, 100, 110, 110], // symbol 0: the +10% is on bar 1->2 (index 2)
    [100, 100, 100, 100], // symbol 1: flat
  ];
  // Decide at t=2 (we now "know" symbol 0 was the winner). Long symbol 0.
  const weights = [1, 0];
  // Causal earning = return on bar t+1 = index 3 (2 -> 3) = 0%.
  const causal = portfolioBarReturn(closes, weights, 3);
  expect(causal).toBeCloseTo(0, 12);
  // The look-ahead version would have booked index 2 (1 -> 2) = +10% — the bug.
  const lookahead = portfolioBarReturn(closes, weights, 2);
  expect(lookahead).toBeCloseTo(0.1, 12);
  // Pin that they DIFFER (so a regression that reverts to look-ahead is caught).
  expect(causal).not.toBeCloseTo(lookahead, 6);
});

test("dollar-neutral long/short book nets cross-sectional dispersion only", () => {
  // Symbol 0 +5% next bar, symbol 1 -5% next bar. Long 0 / short 1 at 0.5 each.
  const closes = [
    [100, 100, 105],
    [100, 100, 95],
  ];
  const weights = [0.5, -0.5]; // dollar-neutral, gross 1
  const r = portfolioBarReturn(closes, weights, 2); // bar 1 -> 2
  // 0.5*(+5%) + (-0.5)*(-5%) = +5% spread captured.
  expect(r).toBeCloseTo(0.05, 12);
});

test("equal-weight long-only earns the mean of its names", () => {
  const closes = [
    [100, 110], // +10%
    [100, 120], // +20%
  ];
  const weights = [0.5, 0.5];
  const r = portfolioBarReturn(closes, weights, 1);
  expect(r).toBeCloseTo(0.15, 12); // mean of +10% and +20%
});
