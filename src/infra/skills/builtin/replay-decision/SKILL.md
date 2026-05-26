---
name: replay-decision
description: Reconstruct the exact analyst view that produced a plan. When user says "replay this plan", "what did we see when we created plan X", "show the chart at decision time", or wants a post-trade walkthrough of the inputs that converged on a plan — load the plan, read its candleSnapshotRef + synthesis manifest, replay the candles + indicators the LLM saw at decision time.
arguments: [planId]
argument-hint: Plan ID (e.g. "pln_a1b2c3d4"). Required.
tags: [review, replay, post-trade, audit]
user-invocable: true
status: active
last-reviewed: 2026-05-26
---

Replay the analyst view at plan creation time.

This skill closes the loop on the "edge in the void" thesis: synthesis is built from heterogeneous inputs (regime + news + observation count + ACE lessons + actual candles), and a post-trade review needs to see EXACTLY what the LLM saw, not a refreshed-this-second snapshot.

## Step 1: Load the plan

```
memory_search({ query: "plan:{planId}" })
```

If `{planId}` doesn't look like a plan ID (`pln_*` prefix), ask the operator for clarification before continuing — there's no point replaying against a misidentified plan.

Pull the plan record. The fields you need:

- `id`, `createdAt`, `symbol`, `direction`, `strategy`, `reasoning`
- `synthesisManifest` (added in the synthesis-manifest build)
  - `candleSnapshotRef` — the pointer into the OHLCV cache
  - `regime`, `news`, `observationCount`, `matchedLessonIds`
- `mentalState` (if captured)

If `synthesisManifest` is missing, the plan predates the manifest feature. Tell the operator and offer the next-best reconstruction: pull current candles + run a fresh analysis (clearly marked "current-state, not decision-time").

## Step 2: Reconstruct the candle view

If `candleSnapshotRef` is present, replay the exact bars the LLM saw:

```
get_market_data({
  dataType: "candles",
  symbol: <ref.symbol>,
  timeframe: <ref.timeframe>,
  asOf: <ISO string of ref.asOfStoredAt>
})
```

The `asOf` flag short-circuits the live exchange fetch and reads only from the local OHLCV cache, filtered to rows whose `stored_at <= asOf`. The result is the **exact** candles available to Gordon at the moment of plan creation.

If `candleSnapshotRef` is null (no cached candles existed at plan time), say so explicitly. Don't fabricate a "close approximation" — the value of replay is fidelity, not best-effort.

## Step 3: Re-run the indicators that fired

Run the indicators on the replayed candles (NOT live data). At minimum:

```
compute_regime({ symbol: <ref.symbol>, timeframe: <ref.timeframe>, candles: <replayed candles> })
compute_indicator({ indicator: "ema", symbol, timeframe, params: { period: 8 } })
compute_indicator({ indicator: "ema", symbol, timeframe, params: { period: 21 } })
compute_indicator({ indicator: "ema", symbol, timeframe, params: { period: 50 } })
compute_indicator({ indicator: "tight_consolidation", ... })
```

Compare the regime / EMA stack / consolidation read NOW (on these replayed candles) against the `synthesisManifest.regime` field as it was captured at plan time. If they differ, the indicators have been changed since the plan was created — flag this as a code-drift warning.

## Step 4: Surface the synthesis context

From `synthesisManifest`, surface:

- **Regime at decision time**: `regime.label` (confidence `regime.confidence`)
- **News context**: `news.headlinesCount` headlines, net sentiment `news.netSentiment`, top bullish/bearish headlines
- **Observations**: how many data tools had been called on this symbol in the 4h before plan creation
- **ACE lessons**: which lessons fired on this symbol — these are the "void wiring" inputs the LLM was pattern-matching against
- **Mental state**: if captured, the operator's mood / confidence / focus at plan time

## Step 5: Present the replay

Output structure:

```
Plan {planId} — created at {createdAt}
Symbol: {symbol} ({direction} {strategy})
Rationale at entry: "{reasoning}"

— Decision-time inputs —
Regime:           {regime.label} ({regime.confidence})
News:             {headlinesCount} headlines, net sentiment {netSentiment}
                  ↑ "{topBullish}"
                  ↓ "{topBearish}"
Observations:     {observationCount} data reads in prior 4h
ACE lessons fired: {matchedLessonIds.length}
Mental state:     {mood}, confidence {confidence}/10, focus {focus}/10

— Replayed candles ({candleSnapshotRef.barCount} bars, {timeframe}) —
{candle table or chart-style summary}

— Re-run analytics (on replayed candles, NOT live) —
Regime now:       {recomputed regime}
EMA stack:        8={ema8}, 21={ema21}, 50={ema50}
Consolidation:    {tight_consolidation result}

— Drift check —
{if recomputed regime differs from manifest.regime:
  "⚠ Drift detected: regime at plan time was X, recomputed Y. Indicator logic may have changed."
else:
  "✓ No drift. Indicator output reproduces manifest."}
```

## Honest caveats

- `asOf` replay only works for symbols whose candles flowed through `get_market_data` at some point before plan creation. If the operator pasted a chart or used a different data source, there's nothing to replay.
- The OHLCV cache stores what Gordon saw — not what was true. If a venue restated a bar after plan creation, the cache holds the original (first-write-wins), which is what we want for replay fidelity.
- Drift detection compares CURRENT indicator code against PAST manifest values. If indicators have been improved, "drift" doesn't mean the past decision was wrong — it means the past indicator output was different. Interpret accordingly.
- This is a read-only skill — it never writes plans, executes orders, or modifies the cache.
