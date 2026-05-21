---
name: dca-setup
description: Set up dollar-cost averaging — recurring buys with smart timing
when_to_use: When user says "DCA into X", "set up recurring buys", "accumulate gradually", "ladder in", or wants dollar-cost averaging
arguments: [symbol]
tags: [dca, accumulate, recurring, long-term]
user-invocable: true
---

Set up a DCA plan for {symbol}.

## Step 1: Current Context
- What is {symbol} currently trading at?
- 52-week high and low (or ATH for crypto)
- How far from ATH? (This tells us if we're buying at a discount)
- Current market regime (trending, ranging, volatile?)

## Step 2: DCA Parameters
Ask the user (or use defaults):
- **Amount per buy**: How much USD per interval? (default: $100)
- **Frequency**: Daily / Weekly / Bi-weekly / Monthly (default: weekly)
- **Duration**: How long? 4 weeks / 3 months / 6 months / 1 year / indefinite
- **Smart timing**: Should buys adjust based on conditions? (default: yes)

## Step 3: Smart Timing Rules (if enabled)
Explain the smart DCA approach:
- **RSI < 30** (oversold): Buy 1.5x the normal amount
- **RSI > 70** (overbought): Buy 0.5x the normal amount
- **Price > ATH × 0.95** (near all-time high): Buy 0.5x
- **Price < ATH × 0.50** (50%+ drawdown from ATH): Buy 2x
- **Volatility extreme** (90th percentile): Split buy into 2 smaller buys

## Step 4: Cost Projection
Calculate projections:
- Total capital needed over the duration
- Average cost basis if price stays flat
- Best case: if price drops 20% during DCA (lower avg cost)
- Worst case: if price rises 20% during DCA (higher avg cost)

## Step 5: Set Up
If using scheduled automation:
- Create a HEARTBEAT.md entry for the recurring buy
- Or set up via the scheduler (/scheduler)

Show the complete plan:
```
DCA PLAN: {symbol}
Amount: $X per {frequency}
Duration: {duration} ({N} total buys, ${total} total)
Smart timing: ON/OFF
First buy: now / next {day}
```

Ask: "Start this DCA plan?"
