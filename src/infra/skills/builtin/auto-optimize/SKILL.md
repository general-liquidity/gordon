---
name: auto-optimize
description: Autonomous strategy optimization — Gordon improves your strategy parameters overnight. When user says "optimize my strategy", "tune parameters", "run optimization overnight", or wants autonomous strategy improvement
arguments: [strategy, symbol]
tags: [optimization, autonomous, strategy, backtest]
user-invocable: true
---

Let's set up autonomous optimization for your {strategy} strategy on {symbol}.

## Step 1: Baseline
First, backtest the current strategy with its existing parameters to establish a baseline.
Show: Sharpe ratio, win rate, max drawdown, total return, trade count.

Run credibility tests (PSR, DSR) on the baseline — is the current performance statistically real?

## Step 2: Optimization Objective
Ask the user which preset to use:
- **maximize-sharpe** — best risk-adjusted returns (recommended)
- **minimize-drawdown** — safest possible strategy (max 10% DD)
- **maximize-winrate** — highest win rate (for consistency)
- **overnight-deep** — 8-hour deep search (200 iterations, run overnight)

Or let them customize: "What metric do you want to maximize? Any constraints?"

## Step 3: Parameters to Optimize
Identify the tunable parameters for this strategy type:
- Momentum: lookback period, entry threshold, exit threshold, position size %
- Mean-reversion: z-score entry/exit, Bollinger period/std, RSI period/thresholds
- Swing: EMA periods, stop %, take-profit %, ATR multiplier
- Pairs: lookback window, z-score entry, hedge ratio window, half-life max

Show current values for each parameter.

## Step 4: Run Optimization
Start the auto-optimizer loop:
- Hill-climbing with adaptive temperature (starts exploratory, narrows down)
- 5 mutations per iteration (one random restart for diversity)
- Keep improvements, discard regressions
- Report progress every 5 iterations

Show live updates:
```
Iteration 12/50 | Sharpe: 0.82 → 1.14 (+39%) | 60 backtests run | 4.2min elapsed
```

## Step 5: Results
When optimization completes, show:
- Before/after comparison for each metric
- Which parameters changed and by how much
- Whether the improvement is statistically credible (PSR, DSR)
- Stop reason (converged, max iterations, time limit)
- CPCV out-of-sample check on the optimized parameters

## Step 6: Apply or Discard
Ask: "Apply these optimized parameters to your live strategy?"
- If yes: update the strategy configuration
- If no: save results for later review

Warn if the improvement is NOT credible: "The improvement doesn't pass credibility tests. This may be overfitting. Consider running with more data or fewer iterations."
