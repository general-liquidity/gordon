---
name: crowd-trapped
description: Detect when the crowd is positioned wrong — one-sided funding, OI extreme, sentiment skew + liquidation imbalance. When user says "is the crowd trapped?", "any squeeze setup?", "where's everyone long/short?", "find me a contrarian setup", or wants to identify asymmetric R:R setups where positioning forces a directional move
arguments: [symbol]
argument-hint: Symbol to check for crowd positioning extremes (e.g., BTC, ETH, SOL)
tags: [microstructure, contrarian, perps, sentiment]
user-invocable: true
status: active
last-reviewed: 2026-05-26
---

Check whether the crowd is trapped on {symbol}. Crowded positioning produces asymmetric setups — when too many people are long, the squeeze direction is down; flush brings them out, sets up the better entry. The opposite for shorts. Hardest part: distinguishing real extremes from noise.

## Step 1: Gather positioning signals
- Funding rate + funding z-score: `get_market_data({ dataType: 'ticker', symbol: '{symbol}' })` + the venue's funding feed (most exchanges put it in the ticker payload)
- Open interest change: same source, 24h delta
- Recent liquidation imbalance: `get_market_data({ dataType: 'orderbook', symbol: '{symbol}' })` for context, plus any liquidation feed (Coinglass-equivalent if MCP plugin is installed)
- Sentiment score: `get_news({ source: 'crypto', symbol: '{symbol}', sinceMinutes: 240 })` — aggregate bullish/bearish/neutral

## Step 2: Run the crowd-positioning verdict
`compute_microstructure({ operation: 'crowd_positioning', params: { fundingRateAnnualized, fundingRateZ, openInterestChange, sentimentScore, recentLiquidationImbalance } })`

Verdict categories:
- `extreme_long` — funding very positive, OI spiking, sentiment euphoric. Squeeze risk DOWN.
- `extreme_short` — funding very negative, OI rising on weakness, sentiment fearful. Squeeze risk UP.
- `mild_long` / `mild_short` — directional bias present, not extreme. Lower-confidence signal.
- `balanced` — no contrarian edge; the price is the price.

## Step 3: Confirm with regime
`compute_regime({ symbol: '{symbol}' })` — a trapped-crowd setup is more reliable when the regime contradicts the crowd:
- Crowd extreme long + regime ranging or trending down → high-conviction short setup
- Crowd extreme short + regime ranging or trending up → high-conviction long setup
- Crowd extreme + regime aligned with crowd → crowd may be right; weaker contrarian signal

## Step 4: Size for the asymmetric R:R, not the regime
Crowd-trap trades work on liquidation cascades — the move can be violent and short-lived. Plan:
- Tight stop just above/below the level where the crowd's stops cluster (use book walls in step 2 of [[microstructure-dive]] to find them)
- TP at the prior consolidation / value area mean — these are mean-reversion plays, not trend plays
- Size such that the stop is < 0.5% of equity; the asymmetric R:R does the work

## Step 5: Verify with risk gate
`compute_risk({ symbol: '{symbol}', side: '<inverse of crowd>', notionalUsd: <size>, venue: '<perp venue>' })`
If risk tier is high/critical, reduce size or skip — contrarian conviction doesn't override drawdown caps.

## Step 6: Plan + audit
If everything aligns:
- `create_plan({ ... })` with the contrarian side, the tight stop, the mean-reversion TP, rationale citing the crowd-positioning verdict
- `audit_event({ action: 'OBSERVATION', summary: 'crowd-trapped setup on {symbol}: <verdict>, contrarian side', parameters: <key findings> })`

If no extreme is present, say so clearly. The contrarian framework only works when the crowd actually IS trapped — forcing the trade on mild bias is just a losing fade.
