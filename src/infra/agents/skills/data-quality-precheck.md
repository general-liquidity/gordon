# Data Quality Precheck

Run before opening a new position or launching a backtest. Gordon's downstream primitives (LV1 liquidity gate, KF1 kalmanBeta, KF2 kalmanVolatility, IS decomposition, regime classifiers) all *assume* clean upstream data. When the assumption breaks silently, the agent acts on bad numbers and the failure surfaces downstream as a confusing P&L event rather than an attributable data problem.

## When to use

- Immediately before submitting a new plan to the permission engine
- At the start of any backtest run
- After a long Gordon-idle period (overnight, weekend) — data sources may have stalled
- When two Gordon primitives disagree about the same market state (regime says bull, vol says expansion)
- User asks "is this data clean?" or notices a stale-looking dashboard

## The flow

1. **Freshness** — for each data source the upcoming workflow will consume, compute (now − last_observation_timestamp). Flag any source older than the symbol's typical bar interval × 3.
   - Spot/perp candles: should be within ~2 minutes for 1-minute strategies, ~5 minutes for hourly
   - On-chain data: depends on chain block time
   - News feed: should have at least one event in the last 24h
2. **Gap detection** — over the most recent rolling window (default last 100 candles), check for missing bars or zero-volume bars. Two consecutive zero-volume bars on a non-stablecoin perp is almost always a data feed issue, not market behavior.
3. **Sanity bounds on the recent series**:
   - No NaN or Infinity in price or volume fields
   - No negative volumes
   - No prices ≤ 0
   - No single-bar return larger than ±50% (likely a bad print or stock split that wasn't adjusted)
4. **LV1 USD volume gate** — call `evaluate_usd_volume_gate` on the candidate symbol. If verdict is `skip`, the data may technically be present but the symbol isn't tradeable; abort before LV1 fires downstream and wastes context.
5. **Cross-venue consistency** — if the symbol trades on multiple venues Gordon can read, call `crossVenueDivergence` (or its equivalent) over the recent window. A mid divergence above the configured threshold means at least one source is giving misleading prices; flag which one looks like the outlier.
6. **Compose the verdict**:
   - **all green** → proceed
   - **any warning** → surface the specific failure with source attribution + the affected check, and let the operator decide
   - **any block-class failure** (NaN/Inf, all-zero volume, LV1 skip) → refuse to proceed and recommend the upstream fix (switch venue, widen window, wait for next bar)
7. **Record the precheck outcome** as a structured observation tagged `data_quality_precheck` so a later signal-postmortem can attribute "we acted on stale data" cleanly if it ever applies.

## Tools used

- `get_candles` — pull the recent OHLCV window
- `evaluate_usd_volume_gate` (LV1) — liquidity gate
- `compare_venues` — multi-venue price comparison
- Structured observation recording — log the precheck result

## What good output looks like

```
Precheck for BTCUSDT @ 2026-05-19 14:22 UTC

✓ Freshness: last candle 14:21:00, age 67s (threshold 180s)
✓ Gaps: 0 missing bars in last 100
✓ Sanity: no NaN, no zero-vol, no >|50%| bars
✓ LV1: tradeable ($487K avg)
⚠ Cross-venue: Bybit mid is 0.07% above Binance mid; both within typical spread (warning, not block)
✓ News: 3 events in last 6h, sentiment classifier responsive

VERDICT: proceed with warning — note Bybit pricing if routing there
```

Or a block:

```
Precheck for $LOWCAP @ 2026-05-19 14:22 UTC

✓ Freshness: last candle 14:20:00, age 119s
✗ Sanity: 4 zero-volume bars in last 10 — likely feed issue
✗ LV1: skip ($23K avg, threshold $100K)
- (cross-venue and news checks not run; halted on first block)

VERDICT: refuse — symbol is illiquid AND the feed is suspect.
Recommended: pick a different symbol, or wait 1h and re-run.
```

## Common failure modes

- Treating "I got data back" as success — a returning API call with stale or partial data is the most common cause of bad agent decisions
- Running the precheck once at session start, then trusting it for hours — freshness has to be checked at each new entry
- Ignoring the cross-venue divergence warning because "both prices look fine in isolation" — divergence is a relative signal, not an absolute one
- Setting LV1 threshold too loose so it never blocks — the threshold should be the *operator's* minimum tradeable size, not a default
- Not recording the precheck outcome — without it, signal-postmortem can't tell whether a bad trade was a data-quality problem or a strategy problem
