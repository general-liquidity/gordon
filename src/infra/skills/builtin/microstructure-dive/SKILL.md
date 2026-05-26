---
name: microstructure-dive
description: Deep order-book and microstructure analysis on a symbol. When user says "is the book healthy?", "any size imbalance on X?", "where's the fair value?", "microstructure check on X", or wants to understand execution conditions before placing a sized order or to spot anomalies that mid-price misses
arguments: [symbol]
argument-hint: Symbol to analyze (e.g., BTC/USDT, ETH/USDT)
tags: [microstructure, execution, liquidity]
user-invocable: true
status: active
last-reviewed: 2026-05-26
---

Run a microstructure dive on {symbol}. The order book tells you things the candle chart can't — fair-value drift, hidden size, liquidity walls, imbalance signals. Use when sizing a non-trivial order, or when something feels off but technicals look normal.

## Step 1: Snapshot the book + ticker
- `get_market_data({ dataType: 'orderbook', symbol: '{symbol}', depth: 50 })` — top 50 levels each side
- `get_market_data({ dataType: 'ticker', symbol: '{symbol}' })` — 24h context for the regime
- Note: spread in ticks, top-level imbalance, depth at ±0.5% and ±1%, any single level holding > 10% of cumulative depth (a wall)

## Step 2: Microprice (Stoikov fair-value)
For a snapshot-history calculation, pass a sequence of book snapshots:
`compute_microstructure({ operation: 'microprice', params: { snapshots: [...], tickSize: <symbol-tick> } })`

Interpretation:
- microprice = mid → no info; book is balanced
- microprice > mid → buying pressure builds; expect mid to drift up
- microprice < mid → selling pressure; mid drift down
- `reliable: false` → sparse history; treat as no signal, NOT as zero adjustment

## Step 3: Inventory-adjusted reference (if you hold a position)
`compute_microstructure({ operation: 'inventory_adjusted_price', params: { mid, inventory, volatility, horizon } })` — Avellaneda-Stoikov reservation price.

Use this to decide:
- Bias your stop / entry away from the AS reservation by spread/2 to reduce inventory risk
- Detect when your existing position is on the wrong side of the AS bias (asymmetric exit signal)

## Step 4: Correlation breakdown check
If {symbol} usually moves with a peer (e.g. BTC/ETH, AAPL/QQQ), check whether the correlation is breaking down:
`compute_microstructure({ operation: 'correlation_breakdown', params: { series: [...] } })`

A broken correlation around a regime shift is high-information — either {symbol} is leading the move or being left behind. Both are tradeable.

## Step 5: Crowd positioning (perps only)
If {symbol} has funding / open interest:
`compute_microstructure({ operation: 'crowd_positioning', params: { fundingRateAnnualized, fundingRateZ, openInterestChange, sentimentScore, recentLiquidationImbalance } })`

The verdict identifies one-sided positioning — when too many traders are long, the squeeze direction is down (and vice versa). Asymmetric R:R setup.

## Step 6: Synthesis + verdict
- Healthy book + balanced microprice → execute normally, no special routing
- Heavy imbalance + microprice diverging from mid → split order, work passively into the thinner side
- Wall on opposing side + low depth on your side → use TWAP or wait for refill
- Crowd-positioning extreme → consider reduced size / asymmetric stop

## Step 7: Record
`audit_event({ action: 'OBSERVATION', summary: 'microstructure dive on {symbol}: <verdict>', parameters: <key findings> })`

Don't use this skill to justify size you shouldn't take — microstructure favorable doesn't override regime / risk / mandate gates. It refines HOW to execute, not WHETHER.
