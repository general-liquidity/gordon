---
name: dd
description: Full due diligence on a symbol — technicals, fundamentals, risk, and trade plan. When user says "do DD on X", "deep dive X", "full analysis on X", "tell me everything about X", or wants thorough due diligence before trading
arguments: [symbol]
argument-hint: Symbol to analyze (e.g., BTC, ETH, AAPL)
tags: [analysis, planning, risk]
user-invocable: true
---

Run full due diligence on {symbol}:

## Step 1: Technical Analysis
- Current price, 24h change, volume
- Key support/resistance levels
- RSI, MACD, trend direction
- Any active chart patterns (breakout, breakdown, consolidation)

## Step 2: Market Context
- How does {symbol} compare to the broader market today?
- Any correlated assets moving significantly?
- Current market regime (trending, ranging, volatile?)

## Step 3: Risk Assessment
- Classify risk of entering a position now (low/medium/high)
- What could go wrong? Key invalidation levels
- Position sizing suggestion based on my risk rules

## Step 4: Trade Plan (if setup exists)
- Entry zone, stop loss, take profit targets
- Risk/reward ratio
- Recommended order type (market, limit, bracket)

If no good setup exists, say so clearly. Don't force a trade.
