# Deep Due Diligence

Comprehensive single-symbol research pass: technical analysis, regime classification, risk assessment, and sentiment integration in one structured output. Used when the user wants a full read on one symbol before committing capital.

## When to use

- User picks a symbol after a `/quick-scan` and wants to go deeper
- User mentions a specific ticker and asks what Gordon thinks
- Before opening a swing position — pairs naturally with `/swing-entry` after
- User wants a second opinion on a position they already hold

## The flow

1. **Instrument resolution** — confirm the symbol, venue, and market type
2. **Multi-timeframe technical read** — call `get_technical_analysis` on at least 1h and 4h
3. **Regime classification** — call `detect_market_regime` to ground the read (trending up/down, ranging, volatile)
4. **SMC pattern overlay** — if the user trades structural patterns, run `detect_smc_patterns` for FVG / Order Block / Liquidity Sweep context
5. **Risk layer** — check volatility (ATR), correlation with user's existing positions, and tail risk
6. **Social + news** — `analyze_x_narrative` for the symbol, `get_news_sentiment` for stocks, check recent scan:opportunity events
7. **Synthesize** — one-page output with: thesis, setup, entry area, stop, invalidation, sizing hint, alternative scenarios

## Tools used

- `get_technical_analysis`
- `detect_market_regime`
- `detect_smc_patterns` (for SMC traders)
- `analyze_coin` / `run_full_analysis`
- `analyze_x_narrative`
- `get_news_sentiment` (stocks via Finnhub)
- `classify_trade_risk`

## What good output looks like

- Thesis in 1-2 sentences
- Current regime + confidence
- Key levels (support, resistance, invalidation)
- 2-3 entry scenarios with conditions, not a single price
- Stop logic tied to structure, not a fixed percent
- Honest disagreement if the signals conflict — don't force a verdict

## Common failure modes

- Only reading one timeframe
- Ignoring regime context ("breakout setup" in a ranging regime is usually a fade)
- Confirmation bias — if the user hinted they're bullish, double-check by looking for the bear case
- Missing the sentiment layer on stocks — analyst ratings and insider activity matter
