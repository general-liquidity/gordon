---
id: momentum-breakout
name: Momentum Breakout
version: 1.0.0
author: Gordon Built-in
tier: 2
risk: medium
markets: [crypto]
symbols: [BTC/USDT, ETH/USDT, SOL/USDT]
timeframes: [15m, 1h]
tags: [momentum, breakout, volume]
---

# Momentum Breakout

A breakout strategy that identifies strong momentum moves with volume confirmation. Works best during high-activity sessions when price breaks out of a consolidation range with conviction. The key insight is that genuine breakouts are always accompanied by a surge in volume -- without volume, most breakouts fail.

## Trigger

Scanner watches for these conditions on the 15m timeframe:
- Price closes above the 20-period high
- Volume is greater than 2x the 20-period average
- RSI is between 55 and 75 (strong but not overbought)

## Analysis

Analyst validates:
- 4h trend must be bullish (price above 50 EMA)
- No major resistance within 2% of entry price
- Sector momentum is positive
- Volume is genuine (not a single large order)

Trade is invalidated if:
- 4h trend is bearish
- Price is within 1% of major resistance
- Funding rate is extreme (>0.05%)

## Execution

- **Entry**: Market order on trigger candle close
- **Stop Loss**: Below the trigger candle low (typically 1-2%)
- **Take Profit**: 2.5x the risk (R:R minimum 2.5:1)
- **Position Size**: Risk 1% of portfolio per trade

## Management

1. At 1.5R profit → Move stop to breakeven
2. At 2R profit → Scale out 50%
3. Trail remaining stop at 20-period low on 15m
4. If volume drops below average for 3 candles → Tighten stop to 1R

## Review

After close, Teacher evaluates:
- Was the breakout genuine or a fakeout?
- Did volume sustain after entry?
- Was entry timing optimal?
- Was the stop placement appropriate?

Score based on:
- Entry timing accuracy
- Position sizing discipline
- Management rule adherence
- Overall trade thesis validity
