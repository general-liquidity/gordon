---
id: mean-reversion
name: Mean Reversion RSI Bounce
version: 1.0.0
author: Gordon Built-in
tier: 1
risk: low
markets: [crypto]
symbols: [BTC/USDT, ETH/USDT]
timeframes: [1h, 4h]
tags: [mean-reversion, oversold, support, beginner]
---

# Mean Reversion RSI Bounce

A beginner-friendly strategy that buys oversold conditions at key support levels. The thesis is simple: when RSI drops below 30 while price sits on a support level that has held multiple times, the probability of a bounce is high. This strategy favors patience over aggression -- wait for the setup rather than chasing.

## Trigger

Scanner watches for these conditions on the 1h timeframe:
- RSI crosses below 30 (oversold)
- Price is within 2% of a support level with at least 2 touches
- Volume is above the 20-period average (buyers stepping in)

## Analysis

Analyst validates:
- Support level has held at least 2 times in the last 30 days
- No bearish divergence on the 4h chart
- Bitcoin correlation is neutral or positive (not dragging the market down)
- Bollinger Band width is above 2% (enough volatility for a bounce)

Trade is invalidated if:
- Support level was recently broken and reclaimed (weakened)
- RSI has been below 30 for more than 6 candles (momentum, not reversal)
- Major negative news event in the last 24h
- Price is in a strong downtrend on the daily (SMA 20 below SMA 50)

## Execution

- **Entry**: Limit order at the support level, or market order if RSI ticks back above 30
- **Stop Loss**: 1.5% below the support level
- **Take Profit**: First target at the 20-period SMA (mean), full exit at Bollinger middle band (R:R minimum 2:1)
- **Position Size**: Risk 0.5% of portfolio per trade (conservative)

## Management

1. If RSI recovers above 40 → Move stop to entry price (breakeven)
2. At 1R profit → Scale out 30% at 20-period SMA
3. At 2R profit → Scale out another 40%
4. Trail remaining 30% with stop at the 20-period low
5. If RSI reaches 60 → Close remaining position (mean achieved)

## Review

After close, Teacher evaluates:
- Did the support level hold as expected?
- Was the RSI reading a genuine reversal signal or a false bottom?
- Was the entry timed correctly (limit at support vs. market chase)?
- Did the trade reach the mean (20 SMA / Bollinger middle)?

Score based on:
- Entry precision relative to support
- Patience in waiting for confirmation
- Risk management discipline
- Profit capture efficiency
