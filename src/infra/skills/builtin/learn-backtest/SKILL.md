---
name: learn-backtest
description: How to backtest strategies and validate results with credibility tests
when_to_use: When user asks "how do I backtest?", "is this backtest real?", "what's a credible Sharpe?", or about backtest validation
tags: [learning, backtest, validation, credibility]
user-invocable: true
---

Backtesting tells you how a strategy WOULD have performed. But most backtests lie. Here's how to do it right.

## Running a Backtest

Basic command: `/backtest <strategy> <symbol>`

Gordon's backtester computes:
- Total return and annualized return
- Sharpe ratio and Sortino ratio
- Max drawdown ($ and %)
- Win rate and average R:R
- Trade count and average hold duration

## The Problem: Most Backtests Are Unreliable

A Sharpe of 2.0 looks amazing. But:
- Did you test 50 strategies and pick the best one? (Data mining)
- Is the track record long enough? (Small sample)
- Are returns normally distributed? (Fat tails distort Sharpe)
- Does it work out-of-sample? (Overfitting)

## Gordon's 4 Credibility Tests

After every backtest, run these to check if the result is real:

### 1. Probabilistic Sharpe Ratio (PSR)
- "Is this Sharpe significantly > 0?"
- Accounts for non-normal returns (skewness + kurtosis)
- Passes at 95% confidence → result is probably real

### 2. Deflated Sharpe Ratio (DSR)
- "Is this Sharpe real after trying N strategies?"
- If you tested 20 strategies and picked the best Sharpe, DSR adjusts for that
- Computes expected max Sharpe under null (no skill) → compares to observed

### 3. Minimum Track Record Length (minTRL)
- "How many periods needed before this Sharpe is credible?"
- With fat-tailed returns, you need MORE data than you think
- If minTRL says 200 and you have 50 → not enough data

### 4. Combinatorial Purged Cross-Validation (CPCV)
- Splits data into folds, tests each as out-of-sample
- Purge gap prevents data leakage between train and test
- PBO (Probability of Backtest Overfitting) > 50% → likely overfit

## How to Use

After backtesting:
```
"Run credibility tests on this backtest. I tested 5 strategies total."
```

Gordon will run all 4 tests and give a verdict:
- **CREDIBLE**: All tests pass. Strategy likely has real edge.
- **NOT CREDIBLE**: Failed on PSR, DSR, or minTRL. May be noise.
- **OVERFIT**: CPCV shows poor out-of-sample performance.

## Best Practices

1. Always test at least 2 years of data (more for crypto — 365 trading days/year)
2. Report how many strategies you tried (DSR needs this)
3. Use walk-forward testing: train on first 70%, test on last 30%
4. If Sharpe < 0.5 after DSR deflation → probably no edge
5. A boring Sharpe of 0.8 that passes all credibility tests > exciting Sharpe of 3.0 that fails
