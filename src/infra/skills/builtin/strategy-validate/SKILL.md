---
name: strategy-validate
description: Run the full validation gate on a strategy before deploying capital. When user says "validate this strategy", "is this edge real", "should I trust this backtest", "run the gate", "before I deploy" — chains MCPT + Vs Random + PSR/DSR/minTRL + synthetic augmentation + Q-stat + snapshot into a single ordered workflow. Skips no step, reports each verdict honestly.
arguments: [strategyId, symbol?, timeframe?, days?]
argument-hint: Strategy ID is required; the rest fall back to backtest defaults.
tags: [validation, backtest, robustness, pre-deploy]
user-invocable: true
status: active
last-reviewed: 2026-05-27
---

Run the full validation stack on a strategy. No step is optional. The point is to reject 99 strategies out of 100 — if all you wanted was a clean backtest, that's already shipped in `backtest`.

This skill composes existing primitives in the order they're meant to be run. Each gate answers a distinct question; passing one doesn't excuse another. The operator gets a final verdict only after the full sequence completes.

## The gate sequence

| # | Gate | Question it answers | Failure mode it catches |
|---|---|---|---|
| 1 | Baseline backtest | "What's the headline number?" | None — this is the anchor |
| 2 | MCPT (path edge) | "Is the path-dependent edge real, or could random shuffles of the data produce the same fit?" | Data-mining bias |
| 3 | Vs Random | "Could a random strategy on the same data beat this fitness?" | Strategy-mining bias (running many strategies, cherry-picking the winner) |
| 4 | PSR + DSR + minTRL | "Is the Sharpe distinguishable from luck, especially after accounting for N strategies tested?" | Multiple-testing bias |
| 5 | Synthetic augmentation | "Does the strategy survive alternate realities (shifted bars, permuted deltas, vol noise)?" | Path dependency, bar-boundary brittleness |
| 6 | Optimization Q-statistic | "Is the optimized parameter set statistically better than the baseline?" | Curve-fitting through parameter sweep |
| 7 | Snapshot the run | "Can we replay this exact validation later if something looks off in production?" | Drift without reproducibility |

If any single gate fails, the strategy fails. There's no "out of N, M passed so it's probably fine."

## Step 1 — Baseline backtest

```
backtest({
  strategyId: "{strategyId}",
  symbol: "{symbol}",
  timeframe: "{timeframe}",
  days: {days}
})
```

Record the `runId` — every subsequent gate references this anchor. Note the returned Sharpe, Sortino, win rate, profit factor, max drawdown.

If `metrics.error` is set or the result is empty, stop here and report the error. No point validating a strategy that doesn't run.

## Step 2 — MCPT (path-dependent edge real?)

Gordon runs MCPT by default during backtest (per CLAUDE.md defaults-on section). Check the backtest result for the MCPT verdict (`p-value`, `permutations`, `verdict`).

If MCPT isn't in the result, invoke explicitly via the backtest internals — `computeMCPT(strategySpec, data, nPermutations: 1000)`. The walk-forward variant (`startIndex = trainWindow`) is the stricter one; prefer it.

Pass criteria: p-value < 0.01 (≥ 2 years of data) or < 0.05 (< 1 year). Above 0.05 → FAIL the gate.

If FAIL: stop. Don't proceed to other gates. A strategy that can't beat shuffled-data versions of itself doesn't have path-dependent edge.

## Step 3 — Vs Random (beats best-of-random?)

```
compute_microstructure({
  operation: "vs_random",
  params: {
    closes: <bar closes from the backtest window>,
    actualFitness: <Sharpe from step 1>,
    fitness: "sharpe",
    exposureRate: <fraction of bars the strategy held a position>,
    nRandom: 1000,
    seed: 42
  }
})
```

Pass criteria: verdict === "pass" (actual strictly beats best random). "borderline" is FAIL for the gate — the article's own framework is unambiguous on this. Running N random strategies guarantees some look good; we benchmark against the survivor of N tries.

## Step 4 — PSR + DSR + minTRL (multiple-testing adjusted)

Call `assessBacktestCredibility` with the strategy's trade returns + the number of strategies the operator tested before finding this one (be honest — this is the heart of DSR).

Pass criteria:
- `psrSignificant === true` AND
- `dsrSignificant === true` AND
- `sufficientTrackRecord === true`

Any of these false → FAIL. The DSR check is the strictest — it asks "is this Sharpe real after accounting for the N strategies you tested before finding it?" If you tested 100 variants and one looks great, DSR likely fails.

Ask the operator: "How many strategy variants did you test before this one?" If they don't know, log this as a meta-failure (can't honestly compute DSR without trial count) and surface it in the final verdict.

## Step 5 — Synthetic augmentation (survives alternate paths?)

Run the strategy on 3 augmented variants and compare:

```
compute_microstructure({ operation: "synthetic_augment", params: { method: "shift_bars", candles: <window>, params: { offsetBars: 2 } } })
compute_microstructure({ operation: "synthetic_augment", params: { method: "mcp_permute", candles: <window>, params: { seed: 7 } } })
compute_microstructure({ operation: "synthetic_augment", params: { method: "noise_bands", candles: <window>, params: { volPct: 0.2, seed: 11 } } })
```

For each augmented series, re-backtest the strategy and record the resulting Sharpe.

Pass criteria: median augmented Sharpe ≥ 0.7 × baseline Sharpe. If augmented results collapse, the strategy was tuned to the one realized path.

## Step 6 — Optimization Q-statistic

If the strategy involved parameter optimization, run the Q-statistic to test whether the optimized Sharpe is significantly better than the baseline (unoptimized) Sharpe:

```
computeOptimizationQuality({
  optimizedReturns: <strategy returns with chosen params>,
  baselineReturns: <strategy returns with default params>
})
```

Pass criteria: |Q| > 1.96 (95% confidence) AND in the favorable direction. If Q is below noise, the optimization was a coin flip.

If no parameter optimization was performed, skip this step and note in the report.

## Step 7 — Snapshot the run

```
// runId from step 1 already snapshotted via the backtest tool's automatic recording.
// Confirm:
audit_event({
  action: "BACKTEST_VALIDATED",
  summary: "Strategy {strategyId} passed full validation gate",
  parameters: {
    strategyId: "{strategyId}",
    runId: <from step 1>,
    gates: { mcpt, vs_random, psr_dsr, augmented, q_stat },
    overall_verdict: "pass" | "fail"
  }
})
```

The audit event is the durable record. If the operator later asks "was this strategy validated?", the audit chain has the answer.

## Final report

```
# Strategy Validation Report — {strategyId}
Run ID: {runId}
Window: {symbol} {timeframe} {days}d

| Gate | Verdict | Detail |
|---|---|---|
| 1. Baseline backtest | <ok/err> | Sharpe {x}, Sortino {y}, MaxDD {z}% |
| 2. MCPT (path edge) | <pass/fail> | p-value {p}, {N} permutations |
| 3. Vs Random | <pass/borderline/fail> | actual {a} vs best random {b}, percentile {pct}% |
| 4. PSR + DSR + minTRL | <pass/fail> | PSR sig: {y/n}, DSR sig: {y/n}, TRL ok: {y/n} |
| 5. Synthetic augmentation | <pass/fail> | median augmented Sharpe {x}, baseline {y}, ratio {r} |
| 6. Optimization Q-stat | <pass/skip/fail> | Q = {q}, p-value {p} |

OVERALL VERDICT: PASS / FAIL
{If FAIL: list the failed gates verbatim. Do not soften.}
{If PASS: surface the weakest gate's margin so the operator knows the closest call.}
```

## Honest caveats

- **A passing strategy is not a guaranteed winner.** Passing the gate means it cleared the bar that catches the most common failure modes. Live PnL is the only real test.
- **Trial count honesty is critical for DSR.** If the operator says "I only tested one strategy" but actually iterated through 50 variants in their head, DSR is meaningless. The skill asks; the operator's honesty is the input quality.
- **Augmented backtests use augmented data, not augmented venues.** Slippage, exchange downtime, regime changes mid-trade — these aren't captured here. Paper-trade the strategy for two weeks before deploying capital, even if it passes.
- **No gate replaces real out-of-sample testing.** This is in-sample validation; reserve a strict OOS window the strategy has never seen and verify there before going live.

## When to skip this skill

- During exploration / strategy brainstorming, validation friction is noise. Use vanilla `backtest` for rapid iteration.
- When the operator is debugging a known strategy (modifying one param to fix a bug), the full gate is overkill.

This skill is for the moment BEFORE capital. Not during exploration, not during debugging.
