---
name: swing-entry
description: Complete swing trade entry checklist — regime detection through position sizing to order placement
when_to_use: When user says "enter swing on X", "full setup check", "build a swing position", "complete entry checklist", or wants thorough swing trade workflow
arguments: [symbol]
tags: [swing, entry, checklist, execution]
user-invocable: true
---

Run the full swing entry checklist for {symbol}. Do NOT skip any step.

## Step 1: Market Regime
Detect the current market regime for {symbol}:
- Run Hurst exponent analysis. Is it trending (H > 0.5) or mean-reverting (H < 0.5)?
- Check market efficiency (Ljung-Box, Variance Ratio, Runs Test). Is it tradeable at all?
- Run Markov regime analysis. What's the transition probability? Is a reversal likely?

If the market is random walk (Hurst ≈ 0.5, all efficiency tests pass) → STOP. Say "No statistical edge detected. Wait for a better setup."

## Step 2: Technical Analysis
- Current price, 24h change, volume
- Key support and resistance levels (at least 2 each)
- RSI (14): overbought/oversold?
- Trend direction: EMA 20 vs EMA 50 vs EMA 200
- Apply Kalman filter to the price — what's the smoothed trend direction?
- Any active chart patterns (breakout, consolidation, reversal)?

## Step 3: Orderflow Check
Analyze orderflow delta on {symbol}:
- Is cumulative delta rising or falling?
- Delta ratio: is there strong directional conviction?
- Does the orderflow confirm or contradict the technical picture?

## Step 4: Correlation Check
Check {symbol} against my existing positions:
- What's the max correlation with anything I already hold?
- If correlation > 0.7, flag it and suggest reducing size
- Calculate the correlation-adjusted allocation limit

## Step 5: Tail Risk Assessment
Run tail risk scoring on {symbol}:
- Skewness and kurtosis
- Max historical drawdown
- Classification: antifragile / robust / fragile / highly fragile
- If fragile or worse → warn strongly, suggest smaller position

## Step 6: Position Sizing
Calculate the optimal position size:
- Use volatility-percentile sizing (where does current vol sit historically?)
- Apply drawdown overlay (am I in drawdown? Scale down if so)
- Apply correlation multiplier from Step 4
- Final recommended size in USD and quantity

## Step 7: Entry Plan
Create the trade plan:
- Entry type: market or limit? (Limit preferred for swing)
- Entry zone: specific price or range
- Stop loss: below nearest support (or above resistance for shorts)
- Take profit 1: first target (1:1 R:R minimum)
- Take profit 2: extended target (2:1 or higher)
- Risk/reward ratio: must be ≥ 1.5 or don't take the trade

## Step 8: Risk Classification
Run the full 11-dimension risk classifier on this proposed trade.
Show the composite score and tier. If critical → do NOT proceed.

## Step 9: Decision
Summarize everything in a clear table:
- ✓ or ✗ for each checklist item
- Overall: ENTER / WAIT / SKIP
- If ENTER: show the exact order details ready for approval

Ask: "Ready to place this order?"
