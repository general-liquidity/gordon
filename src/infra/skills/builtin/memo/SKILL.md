---
name: memo
description: Render an investment memo for a plan. Composes the synthesis manifest, replay-decision view, journal entries, audit trail, reluctance score, and DCF (if computed) into a templated markdown memo with citations back to the source data. When user says "write me a memo on plan X", "investment memo for <planId>", "memo this trade", "draft a write-up of the position".
arguments: [planId]
argument-hint: Plan ID (e.g. "pln_a1b2c3d4"). Required.
tags: [memo, review, post-trade, audit, deliverable]
user-invocable: true
status: active
last-reviewed: 2026-05-27
---

Render an investment memo for a plan. Every claim cites back to Gordon's audit substrate — no fabricated reasoning, no decoration.

This is the operator-facing artifact that makes this session's primitives compose. The memo doesn't say "trust me, the regime was bullish" — it cites the synthesis manifest field that recorded the regime at plan time. It doesn't summarize the trade rationale; it quotes the audit log. Every section traces.

## Step 1: Load the plan + provenance

```
memory_search({ query: "plan:{planId}", asOf: <plan createdAt> })
audit_event({ action: "OBSERVATION", summary: "Memo render started for {planId}" })
```

Pull:
- `plan` from SQLite (symbol, direction, strategy, entry, stop, takeProfit, sizing, reasoning, status, createdAt)
- `synthesisManifest` field on the plan (regime, news, observationCount, matchedLessonIds, candleSnapshotRef, mentalState)
- Journal entries for the symbol scoped to `[plan.createdAt, now]` via `memory_search({ symbol, asOf })`
- Audit chain entries with this `planId` — verify, approve, execute, cancel events with rationales

If the plan predates the synthesis manifest (no `synthesisManifest` field), say so in the memo header. Don't fabricate the missing context.

## Step 2: Reconstruct decision-time view

If `candleSnapshotRef` is present, invoke the [[replay-decision]] workflow to get the exact candles + indicator values the LLM saw at plan creation. This becomes the "what we saw" section.

```
get_market_data({
  dataType: "candles",
  symbol: <ref.symbol>,
  timeframe: <ref.timeframe>,
  asOf: <ISO of ref.asOfStoredAt>
})
```

## Step 3: Run optional analytical layers

These are the "DCF appears in the memo if the operator asked for it" extras. Skip silently if not applicable.

- **DCF (equity plans only)**: if the operator has supplied FCF projections or wants intrinsic valuation, run:
  ```
  compute_microstructure({
    operation: "dcf",
    params: {
      fcfProjections: [...],
      netCash: ...,
      sharesOutstanding: ...,
      base: { wacc, terminalGrowthPct },
      bear: { ... },
      bull: { ... }
    }
  })
  ```
  Include base / bear / bull price targets in the memo with their assumptions cited.

- **Reluctance score (post-trade only)**: if the plan has been executed, pull the trade's execution timestamp from the trade ledger + post-trade journal entries, then compute the reluctance signal. Use [[exit-review]] step 4 logic.

- **Risk verdict**: the most recent `verify_plan` audit event holds the 11-dim classifier output. Cite tier + warnings verbatim.

## Step 4: Render the memo

Markdown template. Every `[ref:...]` is a real citation back to a Gordon record — keep them inline, don't strip:

```markdown
# Investment Memo — {symbol} ({direction})
**Plan:** `{planId}` · **Created:** {createdAt} · **Status:** {status}
**Strategy:** {strategy} · **Routing:** {routingPolicy}

## Thesis
{plan.reasoning verbatim} [ref:plan-rationale]

## Decision-time context (synthesis manifest)
- **Regime:** {regime.label} (confidence {regime.confidence}) [ref:synthesis-manifest]
- **News at entry:** {news.headlinesCount} headlines, net sentiment {news.netSentiment}
  - ↑ top bullish: "{news.topBullish}"
  - ↓ top bearish: "{news.topBearish}" [ref:synthesis-manifest]
- **Data observations in prior 4h:** {observationCount} [ref:symbol-observation-tracker]
- **ACE lessons that fired on this symbol:** {matchedLessonIds.length}
  {for each lessonId: "- [ref:ace-lesson-{id}]"}
- **Operator mental state:** {mood}, confidence {confidence}/10, focus {focus}/10 [ref:plan.mentalState]
- **Candles available at decision time:** {barCount}@{timeframe}, from {fromTs} to {toTs} [ref:candle-snapshot]

## Sizing + risk
- **Allocation:** ${plan.allocation.amount} ({plan.allocation.percentOfPortfolio * 100}%)
- **Entry:** {plan.entry.type} @ {plan.entry.price}
- **Stop:** {plan.stopLoss.price}
- **Take-profit:** {plan.takeProfit list}
- **Verify verdict:** {risk.verdict} · tier {risk.tier} [ref:audit-event-{verifyId}]
  {if warnings: list each as bullet}

## Approval chain
- **Approved:** {approveTimestamp} — "{approvalRationale}" [ref:audit-event-{approveId}]
  {if overrideRecorded: "⚠ OPERATOR OVERRIDE — verify verdict was {verdict}, approved anyway"}
- **Executed:** {executeTimestamp} — "{executionRationale}" [ref:audit-event-{executeId}]

## Replayed view (decision-time candles)
{Inline chart-style summary of replayed candles. NOT current-state — frozen as of {asOfStoredAt}.}

## Valuation (if DCF run)
- **Base case:** ${base.pricePerShare} (WACC {base.wacc}, terminal growth {base.terminalGrowthPct})
- **Bear:** ${bear.pricePerShare} · **Bull:** ${bull.pricePerShare}
- **Terminal value fraction:** {base.terminalFraction * 100}% [ref:dcf-run]
  ({if > 70%: "⚠ High terminal sensitivity — small assumption changes shift price materially"})

## Post-trade signals (if executed)
- **Reluctance score:** {bucket} ({score.toFixed(2)}) — logged {latency} after execution [ref:reluctance-score]
  ({if bucket >= slow: "⚠ Reluctance signal: this trade may have been off-process"})
- **Current trim state:** stage {stage}, severity {severityLevel} [ref:trim-state-output]

## Upstream / downstream classification
{One sentence: was the issue (if any) setup-level (upstream) or execution-level (downstream)?}

## Open questions
{Anything the operator asked for that couldn't be answered with current data.}

---
*Memo rendered {now}. All citations resolve against Gordon's audit chain + journal.*
```

## Step 5: Write to journal + audit

```
memory_write({
  kind: "note",
  content: "Memo rendered for plan {planId}",
  symbol: <plan.symbol>,
  tags: ["memo", "review", <plan.strategy>]
})

audit_event({
  action: "OBSERVATION",
  summary: "Memo rendered for plan {planId}",
  planId: {planId}
})
```

## Honest caveats

- **No fabrication.** If a section's data is missing (e.g. no `candleSnapshotRef`, no DCF run, plan predates synthesis manifest), the memo says "not captured" — never makes up plausible-sounding values.
- **Decision-time only for the replay sections.** Current chart, current regime, current news → live data, clearly labeled. Don't conflate.
- **Citations are real refs.** Every `[ref:...]` should resolve to an audit event id, journal entry id, plan field, or synthesis manifest field. If you write a reference, make sure the operator can pull the source.
- **Templates aren't moats.** This skill isn't trying to compete with PDF pitch decks. The value is provenance, not aesthetics. Markdown is sufficient.
- **Read-only.** The memo skill does not modify plans, place orders, or change permissions. The two writes it does are non-mutating audit/journal entries (memo-rendered marker).
