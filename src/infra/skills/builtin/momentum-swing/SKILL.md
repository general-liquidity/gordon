---
name: momentum-swing
description: Find and execute momentum swing-trade setups in leading stocks. When user says "find me a swing trade", "scan for breakouts", "what's setting up", "any momentum names", "is the market in a tradeable environment", or wants the full momentum-leader playbook — market environment check → leader screen → tight-base detection → breakout / undercut entry → trim-and-trail exit. The article's strategy formalized into a recipe that composes Gordon's surface primitives
arguments: [universe?]
argument-hint: Optional ticker list, comma-separated (e.g., "NVDA,ARM,RKLB"). Default: ask the operator.
tags: [strategy, swing, momentum, breakout]
user-invocable: true
status: active
last-reviewed: 2026-05-26
---

Run the momentum swing-trade playbook. Five steps: confirm the market environment, find leaders, qualify the setup, enter on trigger, manage the exit. Skip the search if the environment is bad — patience is the strategy.

## Step 1: Is the market in a tradeable environment?

The single best filter: SPY/QQQ above the 8/21/50 EMAs. When the indexes are below their moving-average stack, momentum playbooks underperform. The right move is to wait, not to force.

```
compute_indicator({ indicator: 'ema', symbol: 'SPY', timeframe: '1d', params: { period: 8 } })
compute_indicator({ indicator: 'ema', symbol: 'SPY', timeframe: '1d', params: { period: 21 } })
compute_indicator({ indicator: 'ema', symbol: 'SPY', timeframe: '1d', params: { period: 50 } })
```

Repeat for `QQQ`. Rule:
- SPY AND QQQ both above all three EMAs → full-size momentum playbook is live
- Either index below the 21 EMA → reduce size to 1/3, prefer undercut-rally setups over clean breakouts
- Either index below the 50 EMA → SKIP. Tell the operator the environment doesn't favor this playbook. Suggest waiting.

Honest about regime alignment: if the operator asks for a swing trade but the indexes are broken, say so. Don't force a trade because they asked.

## Step 2: Find leading stocks

If a universe was provided via `{universe}`, use it. Otherwise ask the operator which list to scan (their existing watchlist, a sector ETF holdings, a market-cap band, etc.).

For each candidate, in parallel:

```
get_market_data({ dataType: 'candles', symbol: <ticker>, timeframe: '1d', limit: 60 })
get_market_data({ dataType: 'ticker', symbol: <ticker> })
```

Rank by:
1. Above all three EMAs (8/21/50) on the daily — if no, drop
2. Relative strength vs SPY over the last 20 bars (return > SPY's return)
3. Recent volume vs 20-day avg — want ≥ 1.0 (rising attention)

Keep the top 4–5 candidates. This is your focus list.

## Step 3: Qualify the setup — tight consolidation

For each focus-list name:

```
compute_indicator({ indicator: 'tight_consolidation', symbol: <ticker>, timeframe: '1d', params: { window: 20, maxRangePct: 0.08, minDays: 5 } })
```

Keep candidates with:
- `inConsolidation: true`
- `tightnessScore >= 0.6`
- `volumeTrend === 'declining'` (the classic bull-flag signature)

This is the highest-conviction subset. If none qualify, the operator should wait for setups to develop — don't fish in the next-best names.

For the surviving candidates, validate the breakout level has actually rejected before — the article emphasizes that meaningful breakouts come from levels sellers defended multiple times:

```
compute_indicator({
  indicator: "resistance_tests",
  symbol: <ticker>,
  timeframe: "1d",
  params: { level: <breakoutLevel from tight_consolidation>, windowBars: 60 }
})
```

A single test (`confidence < 0.5`) means the level is fresh — the breakout is more "noise filter" than "buyer-overpowers-seller." Prefer levels with `testCount >= 2` for higher-conviction entries.

## Step 4: Wait for the trigger, then enter

Two entry styles, both built on a clear breakout level (the `breakoutLevel` from step 3).

### A. Clean breakout

When price closes above `breakoutLevel` with above-average volume. Plan structure:

```
create_plan({
  symbol: <ticker>,
  side: 'buy',
  entryPrice: <breakoutLevel>,           // limit at the trigger
  stopLossPrice: <breakdownLevel>,        // below the base
  sizeUsd: <per-trade size>,
  rationale: 'Momentum swing: <ticker> breaking <breakoutLevel> after N-bar tight base, vol declining during base. SPY/QQQ above 8/21/50 EMAs.',
  routingPolicy: 'maker_first',           // captures the +1.12% maker edge
  timeHorizonHours: 168                   // 1 week — swing horizon
})
```

Then `verify_plan` and `approve_plan` per the standard flow.

### B. Undercut-and-rally (tighter risk, advanced)

When step 3 + an undercut-rally signal coincide. Detect with:

```
compute_indicator({ indicator: 'undercut_rally', symbol: <ticker>, timeframe: '1d' })
```

If `detected: true` AND `volumeConfirmed: true` AND `confidence >= 60`:

```
create_plan({
  symbol: <ticker>,
  side: 'buy',
  entryPrice: <reclaimClose>,             // entry at the reclaim
  stopLossPrice: <undercutLow * 0.997>,   // just below the undercut wick
  sizeUsd: <per-trade size>,
  rationale: 'Undercut-rally: <ticker> reclaimed <support> after shakeout at <undercutLow>. Confidence <conf>/100.',
  routingPolicy: 'maker_first',
  timeHorizonHours: 168
})
```

Risk on this style is materially tighter than a clean breakout — operator size can stay normal even though stop distance is smaller.

## Step 5: Trim and trail (the part most operators get wrong)

Don't sell the full position at the first target. The point of swing-trading momentum is that a small fraction of trades produce most of the year's P&L — you need to hold winners.

The exit policy is operator-discretion today (no automated exit-policy on Plan yet). The trim ladder:

1. **First trim — 25% at first resistance**. Move stop to breakeven on the remaining 75%.
2. **Second trim — 25% on close below 8 EMA**.
3. **Third trim — 25% on close below 21 EMA**.
4. **Final 25% — trail the 50 EMA**. Exit on close below.

For active checks of "is a trim due right now?", invoke [[trim-check]] — it runs `compute_indicator({ indicator: "trim_state" })` and maps the result to the operator's recorded stage. Coaching only — never auto-executes.

Why moving averages: as the operator pointed out, in a strong trend the moving averages bring fresh demand higher — they're a better trail than fixed levels because they adapt. "No one is smarter than the moving averages."

## Step 6: Record + audit

```
audit_event({
  action: 'OBSERVATION',
  summary: 'momentum-swing setup taken on <ticker>: <breakout|undercut>, base <N>d, confidence <X>',
  parameters: { ticker, base_days, tightness_score, volume_trend, environment }
})
memory_write({
  kind: 'observation',
  content: 'Took momentum-swing trade on <ticker>. Setup: <breakout|undercut>. Plan: <planId>. Watching for trim at <T1>.',
  symbol: <ticker>,
  tags: ['momentum-swing', 'breakout' | 'undercut']
})
```

## Honest caveats

- This is a system, not a holy grail. Strong markets reward it; chop punishes it. Step 1 is non-negotiable.
- Don't chase. If the focus list moved without you, mark levels and wait for the next staircase.
- One outsized winner beats a dozen base hits. Cutting winners short is the most common operator failure.
- Pair this with `/strategy-fit <symbol>` periodically — if a name has gone from trending to mean-reverting, the playbook stops working on it and you need to swap it out of the focus list.
