---
id: trend-following
name: EMA Crossover Trend Follow
version: 1.0.0
author: Gordon Built-in
tier: 2
risk: medium
markets: [crypto, forex]
timeframes: [1h, 4h, 1d]
tags: [trend, ema, crossover, adx, momentum]
---

# EMA Crossover Trend Follow

A trend-following strategy that uses EMA crossovers confirmed by ADX strength to ride established trends. The 9/21 EMA crossover catches trend initiations, while ADX above 25 filters out choppy, range-bound markets where crossovers generate false signals. This strategy wins by letting profits run and cutting losers early.

## Trigger

Scanner watches for these conditions on the 4h timeframe:
- EMA 9 crosses above EMA 21 (bullish crossover)
- ADX is above 25 (confirming trend strength)
- Price is above the 50 EMA (higher timeframe trend alignment)
- Volume is above the 20-period average

## Analysis

Analyst validates:
- Daily trend is bullish (price above 50 EMA on daily)
- ADX is rising, not falling (trend is strengthening)
- No major resistance within 3% above current price
- MACD histogram is positive and growing
- No bearish divergence between price and RSI on the 4h

Trade is invalidated if:
- ADX is below 20 (no trend, choppy market)
- Daily trend is bearish (price below 50 EMA on daily)
- Recent EMA crossover was a whipsaw (crossed and re-crossed within 3 candles)
- Funding rate is above 0.03% (crowded long trade)

## Execution

- **Entry**: Market order on the candle close after EMA 9 crosses above EMA 21
- **Stop Loss**: Below the most recent swing low, or 1.5x ATR below entry (whichever is tighter)
- **Take Profit**: No fixed target -- trail the position. Initial target at 3x risk for partial exit (R:R minimum 3:1)
- **Position Size**: Risk 1% of portfolio per trade

## Management

1. At 1R profit → Move stop to breakeven
2. At 2R profit → Scale out 25%
3. At 3R profit → Scale out another 25%
4. Trail remaining 50% with stop at the 21 EMA on the 4h
5. If ADX drops below 20 → Close remaining position (trend lost)
6. If EMA 9 crosses below EMA 21 → Close all remaining position

## Review

After close, Teacher evaluates:
- Was the trend genuine or a false start?
- Did ADX correctly filter the signal quality?
- Was the trailing stop effective at capturing the trend?
- Was position sizing appropriate for the volatility?
- Could the entry have been improved with a pullback to the 21 EMA?

Score based on:
- Trend capture efficiency (% of move captured)
- Stop management discipline
- Scaling execution quality
- Overall risk-adjusted return
