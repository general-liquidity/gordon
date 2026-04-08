---
name: learn-analysis
description: Gordon's 22 quantitative modules explained — from Hurst exponent to Black-Litterman
when_to_use: When user asks about quantitative analysis, what analytical tools Gordon has, or wants to understand a specific module
tags: [learning, analysis, quant, modules]
user-invocable: true
---

Gordon has 22 quantitative modules. Here's what each one does and when to use it.

## Pre-Trade Filters (Is this worth trading?)

### Market Efficiency Tests
- **Ljung-Box**: Are returns autocorrelated? (Patterns exist?)
- **Variance Ratio**: Is price a random walk? (Predictable?)
- **Runs Test**: Is the up/down sequence random? (Momentum/reversion?)
- **Combined**: tradeabilityScore 0-100. ≥2 of 3 reject randomness → tradeable.

### Hurst Exponent
- H < 0.5 → mean-reverting (fade moves, range trade)
- H ≈ 0.5 → random walk (no edge, reduce size)
- H > 0.5 → trending (follow momentum, trail stops)

### Markov Chain Regime
- Predicts TRANSITIONS between Bull/Neutral/Bear states
- Transition probability matrix shows likelihood of regime change
- "60% chance of staying bullish" vs "40% reversal likely"

## Relationship Analysis (How do assets relate?)

### Correlation (Pearson)
- "Do X and Y move together?" (simultaneous relationship)

### Cointegration (Engle-Granger)
- "Are X and Y statistically bound?" (long-run relationship)
- If yes → pairs trading viable

### Granger Causality
- "Does X's past predict Y's future?" (directional, temporal)
- Useful for lead-lag relationships

## Risk Assessment (How dangerous is this?)

### Tail Risk (Taleb-style)
- Skewness, kurtosis, max drawdown, VaR, convexity score
- Classification: antifragile / robust / fragile / highly fragile

### Risk Classifier (11 dimensions)
- Position size, concentration, drawdown, daily loss, frequency, volatility, market hours, familiarity, vol-percentile, correlation, tail risk
- Mandatory before EVERY trade via Executor

## Position Sizing (How much?)

### Volatility-Percentile Sizing
- Where does current vol sit in historical distribution?
- 90th percentile vol → 60% of normal size

### Correlation-Adjusted Limits
- If new position correlates >0.8 with existing → halve the limit

### Drawdown Overlay
- Scale down when in drawdown or when vol exceeds target

## Valuation (Is it cheap?)

### Scenario DCF (Bear/Base/Bull)
- 3 DCF scenarios → weighted fair value → margin of safety

## Portfolio (What's optimal?)

### Black-Litterman
- Bayesian portfolio optimization combining market equilibrium with your views
- "I think BTC will outperform by 5%" → optimal allocation shifts

## Signal Processing

### Kalman Filter
- Adaptive noise reduction — superior to moving averages
- No lag at trend changes, smooth in noise

### Orderflow Delta
- Volume decomposition into buy/sell pressure at each price level
- Cumulative delta tracks running buying/selling pressure

## Validation (Is this real?)

### Backtest Credibility (PSR, DSR, minTRL, CPCV)
- Statistical tests that prevent backtesting self-deception

### Feedback Loop
- Tracks win/loss per pattern, adjusts confidence over time

Ask me about any specific module and I'll explain it in detail with a live example on any symbol.
