---
name: pairs-trade
description: Full pairs trading workflow — from cointegration test to entry signal
when_to_use: When user says "pair X and Y", "spread trade", "stat arb on X and Y", "cointegration test", or wants pairs trading workflow
arguments: [symbolA, symbolB]
tags: [pairs, stat-arb, cointegration, spread]
user-invocable: true
---

Run the complete pairs trading analysis for {symbolA} / {symbolB}.

## Step 1: Correlation
Calculate the Pearson correlation between {symbolA} and {symbolB} over the last 90 days.
- If |correlation| < 0.5 → STOP. "These assets aren't correlated enough for pairs trading."

## Step 2: Cointegration Test
Run the Engle-Granger cointegration test:
- ADF statistic and critical values (1%, 5%, 10%)
- Hedge ratio (how many units of B per unit of A)
- Is the spread stationary?

If NOT cointegrated → STOP. "Pair is correlated but not cointegrated. The spread won't revert — no edge."

## Step 3: Granger Causality
Test both directions:
- Does {symbolA} Granger-cause {symbolB}?
- Does {symbolB} Granger-cause {symbolA}?
- Relationship: A_leads / B_leads / bidirectional / independent

This tells us which asset to watch for leading signals.

## Step 4: Hurst Exponent on the Spread
Compute Hurst exponent on the spread (residuals from the cointegrating regression).
- H < 0.5 confirms mean-reversion (good for pairs trading)
- H ≈ 0.5 → random walk (no edge)
- H > 0.5 → trending spread (don't pairs trade this)

## Step 5: Half-Life
What's the half-life of mean reversion for this spread?
- This tells us how long to expect to hold the trade
- Half-life > 30 days → "Spread reverts too slowly for active trading"
- Ideal: 3-15 days

## Step 6: Current Signal
- Current spread z-score
- Entry thresholds: ±2σ
- Exit threshold: 0.5σ (near mean)

Signal interpretation:
- Z < -2.0 → "Enter long spread (buy A, sell B)"
- Z > +2.0 → "Enter short spread (sell A, buy B)"  
- |Z| < 0.5 → "At mean — exit any existing position"
- Between → "Wait for better entry"

## Step 7: Trade Plan (if signal exists)
- Long leg: buy X units of {symbolA}
- Short leg: sell Y units of {symbolB} (using hedge ratio)
- Stop: if z-score hits ±3.5 (spread diverging, stop out)
- Target: z-score returns to 0 (mean reversion)
- Expected hold: half-life estimate from Step 5

## Summary Table
Show everything in one view:
```
PAIR: {symbolA} / {symbolB}
Correlation: X% | Cointegrated: YES/NO (p=X)
Hurst: X (mean-reverting/trending) | Half-life: X days
Granger: {relationship}
Current Z-score: X | Signal: {entry/exit/wait}
Hedge ratio: X {symbolB} per 1 {symbolA}
```
