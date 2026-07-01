---
name: trade-performance-coach
description: "Review a batch of closed trades, tag recurring behavioral patterns, and emit a prescriptive next-session operating-rules artifact a later session can ingest. When user says /trade-performance-coach, 'coach me on my trading', 'what am I doing wrong lately', 'review my last N trades for patterns', or after a losing week. Distinct from hindsight-check (which judges one proposed rule change against decision-time context) and exit-review (which acts on open positions). This one is forward-looking: it turns retrospective closed-trade data into rules the NEXT session operates under."
arguments: [window]
argument-hint: Lookback window for closed trades (e.g. 20 for last 20 trades, or 7d/30d). Defaults to the last 20 closed trades.
tags: [review, coaching, behavioral, operating-rules, learning]
user-invocable: true
status: active
last-reviewed: 2026-07-01
---

Coach the operator on their recent trading behavior. Gordon's existing reviews are retrospective (they explain what happened); this skill closes the loop by producing a PRESCRIPTIVE artifact: a short set of `next_session_operating_rules` that a later session reads before proposing trades. Behavioral change, not another post-mortem.

This is a pure-composition skill. No new tools. It reads closed trades + their plans + journal entries via `memory_search` and `audit_event` lookups, tags the patterns, and writes the rules back via `memory_write`.

## Step 1: Pull the closed-trade batch

```
memory_search({ kind: 'trade_execution', since: <window>, limit: 50 })
```

For each closed trade recover, where available:
- entry / exit / realized PnL (R multiple if the plan recorded a stop)
- hold duration vs the plan's `timeHorizonHours`
- the plan's `rationale` and setup tags (via the matching `plan` entry)
- whether the planned trim / stop was honored (from `audit_event` order records)

If fewer than 5 closed trades are recoverable in the window, say so and widen the window before drawing conclusions. Small samples produce superstitions, not patterns.

## Step 2: Tag behavioral patterns

Score the batch for these recurring patterns. Emit only the tags the DATA supports (with the count that fired each), not a generic checklist:

- `cut_winners_early` - median winner closed well before the plan target while losers ran to stop.
- `let_losers_run` - realized losses exceed the planned per-trade risk (stop widened or ignored) on 2+ trades.
- `revenge_sizing` - position size stepped UP on the trade immediately after a loss.
- `overtrading_chop` - cluster of entries while the regime read (see [[morning-brief]]) was range/neutral.
- `no_plan_entries` - trades with no recoverable plan (discretionary / off-process).
- `trim_discipline_ok` - planned trims honored on most winners (a POSITIVE tag; name strengths too).
- `stop_discipline_ok` - stops honored on losers.
- `thesis_drift` - hold duration ran well past `timeHorizonHours` with no thesis update (cross-reference the thesis-lifecycle review queue if present).

Each tag carries: pattern id, count / n, one-line evidence, and direction (strength vs leak).

## Step 3: Derive next-session operating rules

Convert the leak tags into a SHORT (max 5) list of prescriptive, checkable rules for the next session. Rules must be operational, not aspirational:

- Good: "Do not increase size on the trade immediately following a realized loss; hold base size until two green closes." (from `revenge_sizing`)
- Good: "Require a regime read of trend-up or trend-down before any momentum entry; skip range days." (from `overtrading_chop`)
- Bad: "Be more disciplined." (not checkable)

Each rule states the pattern it answers and the condition that retires it (e.g. "retire after 10 trades with no recurrence").

## Step 4: Persist the artifact

Write the coaching output so the next session ingests it:

```
memory_write({
  kind: 'observation',
  content: 'Trade-performance coaching (<window>, n=<N>): tags=[...]. Next-session operating rules: 1) ... 2) ...',
  tags: ['trade-performance-coach', 'next-session-operating-rules', '<each behavioral tag>']
})
audit_event({
  action: 'OBSERVATION',
  summary: 'trade-performance-coach over <N> closed trades',
  parameters: { window, n, behavioral_tags, next_session_operating_rules }
})
```

Tagging the memory with `next-session-operating-rules` is what lets a future session retrieve the rules via `memory_search({ tags: ['next-session-operating-rules'] })` at session start.

## Output

Give the operator:
1. A compact table of behavioral tags (pattern, count/n, strength or leak, evidence).
2. The `next_session_operating_rules` list (max 5), each with the pattern it answers and its retire condition.
3. One-line net read: the single highest-leverage behavior to change this week.

## Honest caveats

- Behavioral tags are hypotheses over a small sample, not verdicts. A tag firing on 2 of 6 trades is a watch item, not a proven leak.
- This skill does NOT change the strategy or risk limits. Operating rules govern the OPERATOR's next-session behavior; strategy edits go through [[hindsight-check]] (per-rule) or [[backtest-validate]] (whole-strategy).
- Composes with [[weekend-review]] (surfaces the closed batch), [[exit-review]] (acts on the open book), and the setup [[setup-model-book]] (validates which setups actually carry edge). Run those alongside for the full loop.
