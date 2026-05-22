---
name: scalp
description: Quick scalp workflow — orderflow + Kalman filter + tight stops for fast in-and-out trades. When user says "scalp X", "quick trade on X", "intraday momentum", "fast entry/exit", or wants a fast in-and-out trade
arguments: [symbol]
tags: [scalp, intraday, fast, orderflow]
user-invocable: true
status: active
last-reviewed: 2026-05-23
---

Run a quick scalp analysis for {symbol}. Speed matters — be concise.

## Step 1: Pulse Check (10 seconds)
- Current price, bid/ask spread, 1-minute volume
- Is the spread tight enough to scalp? (If spread > 0.1% of price, STOP — too expensive)
- Is volume sufficient? (If below average, STOP — no liquidity)

## Step 2: Orderflow Read
Analyze the most recent orderflow delta:
- Is cumulative delta surging in one direction?
- Delta ratio > 0.15? (Strong directional conviction)
- Signal: strong_buying / buying / neutral / selling / strong_selling

If neutral → STOP. "No clear direction for a scalp."

## Step 3: Kalman Trend
Apply Kalman filter to recent price action:
- What's the smoothed trend direction?
- Is the Kalman slope aligned with the orderflow signal?
- If they disagree → STOP. "Conflicting signals."

## Step 4: Entry
- Entry: market order (scalps don't wait for fills)
- Size: small — max 1% of portfolio (scalps are high-frequency, low-size)
- Stop: tight — 0.3% to 0.5% from entry (ATR-based)
- Target: 0.5% to 1.0% from entry (2:1 R:R minimum even on scalps)
- Time limit: close after 15 minutes regardless of P&L

## Step 5: Execute or Pass
Show a compact summary:
```
SCALP: {symbol} | {BUY/SELL} | Entry: $X | Stop: $Y | Target: $Z
Size: $N (0.5% of portfolio) | R:R 2.1:1 | Time limit: 15min
Orderflow: {signal} | Kalman: {direction} | Spread: {bps}bps
```

Ask: "Execute this scalp?"
