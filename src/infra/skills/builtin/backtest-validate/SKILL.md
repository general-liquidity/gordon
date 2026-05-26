---
name: backtest-validate
description: Validate a backtest result before trusting it. When user says "validate this backtest", "is this backtest realistic", "check the backtest", "before I go live with X", or wants to stress-test a strategy's edge against overfitting / regime-dependence / look-ahead bias before deploying capital
arguments: [strategyId]
argument-hint: Strategy ID or backtest run reference
tags: [backtest, validation, risk, strategy]
user-invocable: true
status: active
last-reviewed: 2026-05-25
---

Validate the backtest for {strategyId}. Backtests lie by default — overfit, regime-narrow, hindsight-biased. Confirm the edge survives reasonable stress before any live deployment.

## Step 1: Re-read the headline metrics
Call `backtest` once for the canonical period to confirm:
- Sharpe / Sortino — sane (Sharpe > 1.0 minimum, > 2.0 suspicious)
- Max drawdown — operator-tolerable?
- Win rate + profit factor — consistent (high WR + low PF = small wins big losses = blow-up risk)
- Trade count — under 30 trades is statistically thin; flag it

## Step 2: Walk-forward partitioning
Re-run `backtest` with `walkForward: true` if not already. Compare:
- In-sample vs out-of-sample Sharpe. Out-of-sample < 50% of in-sample = overfit.
- Did the strategy degrade in the most recent OOS slice? That's the deployment-equivalent signal.

## Step 3: Regime conditioning
Use `compute_regime` on the test universe and bucket trades by regime. Run `backtest` over subsets:
- Trending-up only, trending-down only, ranging only, high-vol only.
- A strategy with edge in 1 regime but bleeds in 2 is a regime-conditional play, not a generalist. Document that gate.

## Step 4: Parameter robustness
Re-run `backtest` with parameters perturbed ±20% on each tunable knob. If Sharpe collapses with small perturbations the surface is needle-thin → curve-fit.

## Step 5: Transaction cost sensitivity
Re-run with realistic slippage + fees vs idealized. If edge disappears at realistic costs, it's a paper edge.

## Step 6: P&L shape
Call `compute_microstructure` with `operation: 'pnl_distribution_shape'`. Check for:
- Convex (good — small losses, occasional large wins)
- Concave (caution — many small wins, occasional large losses = picking up nickels)
- Fat-tailed left = risk of ruin under leverage

## Step 7: Audit + verdict
Use `audit_event` to record the validation result (`action: 'BACKTEST_VALIDATED'`) with summary covering: did it pass walk-forward, regime breakdown, parameter robustness, cost sensitivity, P&L shape. Either: APPROVE for live deployment with caveats, REJECT (curve-fit / regime-narrow / cost-sensitive), or CONDITIONAL (e.g. trade only in trending-up regime).

Never approve a backtest that hasn't survived walk-forward + cost sensitivity. Operator pays in real dollars for skipped due diligence here.
