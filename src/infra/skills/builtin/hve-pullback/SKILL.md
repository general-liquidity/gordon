---
name: hve-pullback
description: "HVE first-pullback setup. When user says /hve-pullback, 'find HVE breakouts', 'scan for institutional volume spikes', 'is X setting up on the first pullback', or wants the Highest-Volume-Ever framework — detect HVE prints → confirm trend stack → wait for orderly pullback to the 8-week EMA → enter on breakout from the squat. Pure composition of compute_indicator primitives (highest_volume_ever + ema + tight_consolidation + resistance_tests). No new tools, no new code."
arguments: [symbol?]
argument-hint: Optional ticker (e.g., 'NVDA'). If omitted, ask the operator which name or watchlist to scan.
tags: [strategy, swing, breakout, volume, hve]
user-invocable: true
status: active
last-reviewed: 2026-05-29
---

Run the HVE first-pullback setup. Five steps: detect the historic-volume print, confirm the post-HVE trend hasn't broken, wait for the first orderly pullback to the 8-week EMA, confirm the squat, then enter on the breakout from the squat. Composes existing primitives — no new tools.

The framing from the source article: an HVE bar signals **institutional urgency** — funds caught underweight scrambling to build positions in a single session. Institutions then defend the baseline of that HVE day. The first orderly pullback to the 8-week EMA is the trade because that's where the buyers from the HVE day come back in.

This setup wants weekly bars for the EMA work and daily bars for the squat detection. Default to `1d` if the operator doesn't specify, but the article explicitly references the 8-WEEK EMA — translate that to a 40-period EMA on daily bars (8 weeks × 5 trading days).

## Step 1: Detect the HVE print

```
compute_indicator({
  indicator: 'highest_volume_ever',
  symbol: <ticker>,
  timeframe: '1d',
  params: { lookbackBars: 252, minBarsBeforeDetection: 20 }
})
```

`lookbackBars: 252` ≈ "highest volume in the last year of trading." Drop the field entirely for true HVE (highest in the entire series).

Read the result:
- `latestHveBarIndex === null` → no HVE in the window. Skip this name.
- `barsSinceLatestHve > 30` → the HVE print is stale. The first-pullback window has closed. Skip.
- `volumeMultipleOfMedian < 3` → HVE was a marginal record (≈3× median or less). The institutional-urgency reading is weak. Reduce conviction or skip.

Keep candidates where the HVE bar is recent (≤ 30 bars ago) and the volume multiple is ≥ 3× the window median.

## Step 2: Confirm the post-HVE trend is intact

The setup is invalid if price broke down after the HVE day. Check the 8/21 EMA stack hasn't inverted:

```
compute_indicator({ indicator: 'ema', symbol: <ticker>, timeframe: '1d', params: { period: 8 } })
compute_indicator({ indicator: 'ema', symbol: <ticker>, timeframe: '1d', params: { period: 21 } })
compute_indicator({ indicator: 'ema', symbol: <ticker>, timeframe: '1d', params: { period: 40 } })  // 8-week EMA
```

Conditions:
- Latest close above the 40 EMA (8-week EMA) → trend intact, proceed
- 8 EMA above 21 EMA above 40 EMA → ideal stack
- 8 EMA below 21 EMA but both above the 40 → first pullback in progress (this is what we want)
- Close below the 40 EMA → setup is invalid, the institutional bid didn't hold. Skip.

## Step 3: Wait for the orderly pullback to the 8-week EMA (the "squat")

The setup triggers on the **first** retest of the 40 EMA (8-week EMA) after the HVE day. Two questions:

**(a) Has price actually reached the 40 EMA?** Compare latest close + recent low to the 40 EMA value. Within 2% above the 40 EMA, or kissing/wicking below = the pullback is mature. More than 5% above = wait, not in zone yet.

**(b) Has consolidation tightened up at the EMA?** A clean pullback to the EMA is necessary but not sufficient — you want the squat (orderly volume-dry-up + price compression). Use the existing tight-consolidation scorer:

```
compute_indicator({
  indicator: 'tight_consolidation',
  symbol: <ticker>,
  timeframe: '1d',
  params: { window: 10, maxRangePct: 0.06, minDays: 3 }
})
```

Tighter thresholds than `momentum-swing` Step 3 because this is a mid-trend squat, not a base. Want:
- `inConsolidation: true`
- `tightnessScore >= 0.5`
- `volumeTrend === 'declining'` (volume dry-up = no supply hitting the bid = the squat)

If the pullback is in zone but consolidation hasn't formed yet, **wait**. The squat is the operator's edge — entering before it forms is buying a falling knife.

## Step 4: Enter on the breakout from the squat

Once the squat is confirmed, the trigger is identical to `momentum-swing` Step 4A — a clean break above the squat high on rising volume. The article calls this the "HVE first-pullback entry":

```
create_plan({
  symbol: <ticker>,
  side: 'buy',
  entryPrice: <squatHigh from tight_consolidation>,
  stopLossPrice: <squatLow * 0.99>,            // just below the squat low; tight stop is the edge
  sizeUsd: <per-trade size>,
  rationale: 'HVE first-pullback: <ticker> printed HVE <Nbars> ago (vol <Xx> median), held the 40 EMA (8w), squat formed at <squatLow>-<squatHigh>, volume drying up. Entry on breakout from squat.',
  routingPolicy: 'maker_first',
  timeHorizonHours: 168
})
```

Verify and approve per standard flow. Risk on this entry is materially tighter than a flat-base breakout because the squat low gives a clear invalidation. The article emphasizes this as the asymmetric edge — 1:5+ R/R is realistic when the squat is tight.

If `resistance_tests` shows the squat-high level has been touched + rejected ≥ 1 time before, conviction is higher (the squat is a confirmed level, not a fresh one). Optional check:

```
compute_indicator({
  indicator: 'resistance_tests',
  symbol: <ticker>,
  timeframe: '1d',
  params: { level: <squatHigh>, windowBars: 60 }
})
```

## Step 5: Manage the exit

Same trim ladder as `momentum-swing` Step 5 — 25% at first resistance, move stop to breakeven, then trail by 8/21/50 EMA. Cross-reference [[trim-check]] for active "is a trim due?" checks during the hold.

## Step 6: Audit + journal

```
audit_event({
  action: 'OBSERVATION',
  summary: 'HVE first-pullback setup taken on <ticker>: HVE <Nbars>d ago, vol <Xx> median, squat <low>-<high>',
  parameters: { ticker, hve_bars_ago, hve_volume_multiple, squat_range_pct, tightness_score }
})
memory_write({
  kind: 'observation',
  content: 'Took HVE first-pullback on <ticker>. Plan: <planId>. Watching for first trim at the next resistance level.',
  symbol: <ticker>,
  tags: ['hve-pullback', 'first-pullback', 'institutional-urgency']
})
```

## Honest caveats

- **The window is narrow.** This is a first-pullback setup. If the HVE is > 30 bars old or you've missed the squat, the institutional defenders may have already redeployed. Skip — don't force a late entry.
- **Volume multiple is the conviction dial.** An HVE that's only 3× median is a weaker signal than 10× median. Adjust size accordingly.
- **The squat is non-negotiable.** Pullback to the EMA without volume-dry-up + price compression = not the setup. Wait or skip.
- **Bounded lookback is a parameter, not a value.** `lookbackBars: 252` = "highest in the last year." For longer-horizon plays use 504 (2y) or omit for true HVE. Read the operator's intent before choosing.
- Composes with [[momentum-swing]] (same Step 4A entry shape, same Step 5 exit) and [[trim-check]]. If the broader environment is broken (see momentum-swing Step 1), this setup degrades too — confirm SPY/QQQ above the 50 EMA before sizing up.
