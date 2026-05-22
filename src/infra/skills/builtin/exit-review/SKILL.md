---
name: exit-review
description: Review all open positions — which to hold, trim, or close based on current conditions. When user says "review my positions", "what should I close?", "clean up my book", or wants to assess all open trades
tags: [review, exit, positions, cleanup]
user-invocable: true
status: active
last-reviewed: 2026-05-23
---

Review every open position and give me an honest recommendation.

## For Each Position

Get all my open positions and for each one:

### 1. Current Status
- Symbol, side (long/short), entry price, current price
- Unrealized P&L ($ and %)
- How long held (days since entry)
- Stop loss and take profit levels (if set)

### 2. Technical Health
- Is the original setup still valid?
- Has the trend changed since entry?
- RSI: has it gone from oversold to overbought (or vice versa)?
- Is price near stop loss or take profit?

### 3. Risk Check
- Run tail risk on this position
- Has volatility increased since entry? (vol-percentile now vs at entry)
- Correlation with other positions (concentration risk)

### 4. Recommendation
For each position, give ONE of:
- **HOLD** — setup intact, no reason to exit. Keep current stops.
- **TRIM** — take partial profits. Reduce by X%. Reason: [why]
- **CLOSE** — setup invalidated or target hit. Close entirely. Reason: [why]
- **TIGHTEN** — move stop loss to breakeven or trail closer. Reason: [why]

## Summary Table

Show all positions in one table:
```
Symbol    Side   Entry    Current   P&L      Days   Action    Reason
BTC       Long   $95,000  $97,500   +2.6%    5      HOLD      Trend intact
ETH       Long   $3,800   $3,650    -3.9%    12     TIGHTEN   Approaching stop
SOL       Long   $145     $138      -4.8%    8      CLOSE     Support broken
```

## Net Action
- Total positions: X
- Hold: X | Trim: X | Close: X | Tighten: X
- Estimated realized P&L from closures: $X
- Portfolio freed up: $X

Ask: "Execute these recommendations?" (Only the closes and trims need approval)
