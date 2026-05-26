---
name: strategy-fit
description: Before picking a strategy class for a market, measure what KIND of memory it has — trending, mean-reverting, or random walk. When user says "should I trend-follow X", "is X mean reverting", "what strategy fits X", "check the memory of X", or any question about whether a strategy class matches the market they're about to deploy on. Prevents the most common quiet failure mode in trading: running mean-reversion on a trending name (or trend-following on a chopping one)
arguments: [symbol]
argument-hint: Symbol to diagnose (e.g., BTC/USDT, AAPL, SPY)
tags: [strategy, regime, diagnostic]
user-invocable: true
status: active
last-reviewed: 2026-05-26
---

Diagnose what kind of memory {symbol} carries, then prescribe a strategy class. The point: a trend-follower and a mean-reversion trader cannot both be right on the same series at the same time. One of them is trading a memory the market does not have, and the market will charge for the mistake.

## Step 1: Run the memory diagnostic
`compute_microstructure({ operation: 'market_memory', params: { symbol: '{symbol}', timeframe: '1d', lookbackBars: 600 } })`

Why these defaults:
- Daily timeframe matches how most operators size their holding period
- 600 bars puts reliability at "high" so the verdict is statistically meaningful
- Auto-collect fetches candles via the exchange — no need to feed prices manually

Report back:
- The verdict (trending / mean_reverting / random_walk)
- The corrected Hurst (with sign vs 0.5)
- The surrogate p-value
- The variance-ratio profile — does VR rise with horizon (trending) or fall (mean-reverting)?

## Step 2: Cross-check on a second timeframe
The verdict can flip between timeframes. A 1d-mean-reverter might be a 1h-trender. Run the same op on 4h:

`compute_microstructure({ operation: 'market_memory', params: { symbol: '{symbol}', timeframe: '4h', lookbackBars: 600 } })`

Compare verdicts. Disagreement is informative — it means the operator's holding period determines which strategy class fits, and the right answer depends on whether they're holding hours, days, or weeks.

## Step 3: Cross-check with current regime
The memory verdict is a long-window property. The current regime is a now-window property. Both matter:

`compute_regime({ symbol: '{symbol}', timeframe: '1d' })`

- market_memory says "this series has historically been [trending / mean-reverting / neither]"
- compute_regime says "right now the price action is [trending_up / ranging / volatile / ...]"

The right strategy fit is where the long-window memory and the current regime AGREE. A market with persistent memory currently in a ranging regime is still a trend-following market — just waiting for the next leg.

## Step 4: Prescribe the strategy class

| Memory verdict | Current regime | Prescription |
|---|---|---|
| trending | trending_up / trending_down | Momentum / breakout / trend-continuation playbooks. Backtest with persistent stops. |
| trending | ranging / contraction | Wait. Memory says trends work; current state says no trend. Watch for breakout. |
| mean_reverting | ranging | Mean-reversion / range-fade / pairs. Backtest with mean-target exits. |
| mean_reverting | trending | Caution. Mean-reversion in a trending regime gets trapped doubling into the move. |
| random_walk | any | Skip the daily-path strategy. Look for cross-sectional edge, event-driven setups, or microstructure plays — the level alone doesn't reward memory. |

## Step 5: If a strategy was already specified
If the operator asked "should I trend-follow {symbol}" and the verdict says mean_reverting, push back explicitly. Cite the corrected Hurst, the p-value, and the VR profile. Don't hedge — the data has a verdict.

If the operator asked "should I mean-revert {symbol}" and the verdict says random_walk, explain that mean-reversion on a memoryless series is paying spread to trade noise. Suggest one of: (a) a different instrument, (b) a different horizon, (c) a different edge mechanism (cross-section, event, microstructure).

## Step 6: Record + audit
`memory_write({ kind: 'observation', content: '{symbol} memory verdict: <verdict>, H_corrected=<h>, p=<p>. Prescribed: <class>.', symbol: '{symbol}', tags: ['memory', 'strategy-fit'] })`

`audit_event({ action: 'OBSERVATION', summary: 'strategy-fit on {symbol}: <verdict> → <prescription>', parameters: { verdict, hurst, p } })`

## Honest caveats
- Memory can flip when liquidity / venue structure changes. Re-run quarterly.
- The variance ratio is more robust under volatility clustering than raw H; trust it more when results disagree.
- "random_walk" is a verdict, not a failure mode. Most well-arbitraged daily series of liquid majors live there — the edge has to come from somewhere besides the path.
