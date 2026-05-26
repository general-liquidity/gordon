---
name: trim-check
description: Check whether a trim is due on an open momentum-swing position. When user says "should I trim NVDA", "is my swing trade still good", "check the EMA trail on <symbol>", "what stage of the trim ladder am I at" — runs the trim coach against the momentum-swing 8/21/50 EMA ladder.
arguments: [tradeIdOrSymbol]
argument-hint: Either an open tradeId or a symbol with operator-supplied entry context.
tags: [exit, trim, momentum, swing]
user-invocable: true
status: active
last-reviewed: 2026-05-26
---

Check the trim ladder for an open momentum-swing position. Reports which trim signal is currently active — coaching, not auto-execution.

## When to run this

The momentum-swing playbook ([[momentum-swing]]) prescribes a four-stage trim ladder:

1. **Stage 1** — first 25% off when the position reaches your first-resistance target. Stop moves to breakeven.
2. **Stage 2** — second 25% off when the daily closes below the 8 EMA.
3. **Stage 3** — third 25% off when the daily closes below the 21 EMA.
4. **Exit** — final 25% off when the daily closes below the 50 EMA.

Operators forget which stage they're at. The article's own diagnosis: the hardest part of trading is sitting in a winner. This skill removes the uncertainty about whether a trim is due — but never executes one. Operator decides.

## Step 1: Resolve the position

If `{tradeIdOrSymbol}` looks like a tradeId, fetch the trade:

```
memory_search({ kind: "trade", id: tradeIdOrSymbol })
```

If it's a symbol, ask the operator:
- Entry date or bar index?
- First-resistance level (the original first-trim target)?
- Which trim stages have already been executed (0–3)?

## Step 2: Fetch candles

```
get_market_data({ dataType: "candles", symbol: <ticker>, timeframe: "1d", limit: 120 })
```

120 bars covers the 50 EMA plus enough post-entry context for any reasonable swing horizon.

## Step 3: Run the trim-state indicator

```
compute_indicator({
  indicator: "trim_state",
  symbol: <ticker>,
  timeframe: "1d",
  params: {
    entryBarIndex: <bar index of entry, counting from the start of the returned candle array>,
    firstResistanceLevel: <operator-supplied first-resistance level>
  }
})
```

Returns:
- `severityLevel` (0–4) — highest-severity signal currently visible
- `ema8` / `ema21` / `ema50` — latest values
- `reachedFirstResistance` — boolean (or null if no level was provided)
- `latestCloseBelowEma8` / `21` / `50` — what fired on the most recent bar
- `closesBelowEma8SinceEntry` / `21` / `50` — historical context
- `recommendation` — one-line summary

## Step 4: Map indicator output → operator action

Cross-reference indicator `severityLevel` against the operator's recorded stage:

| Operator stage | Indicator severityLevel | Action |
|---|---|---|
| 0 (entry, no trims yet) | 0 | Hold. No trim signal active. |
| 0 | 1 | **First trim due** — peel 25%, move stop to breakeven. |
| 1 (first trim done) | ≤ 1 | Hold. Watching for 8 EMA close. |
| 1 | 2 | **Second trim due** — peel another 25%. |
| 2 (second trim done) | ≤ 2 | Hold. Watching for 21 EMA close. |
| 2 | 3 | **Third trim due** — peel another 25%. |
| 3 (third trim done) | ≤ 3 | Hold. Trailing the 50 EMA on the remaining 25%. |
| 3 | 4 | **Exit remaining** — close below 50 EMA confirmed. |

If the indicator skips a level (e.g. operator at stage 0, indicator at 3 because price gapped down through everything), the article's bias is: **don't try to catch up partials — get out**. A move that violates the 21 EMA without a chance to peel at the 8 EMA is a regime change, not a trim opportunity.

## Step 5: Surface the decision

If a trim is due, draft the partial-cancel call but **do not execute**. Hand it to the operator for approval:

```
cancel({
  target: "partial",
  id: <tradeId>,
  percentPct: 25,
  reason: "trim-check: <stage> reached on <ticker> — <recommendation>"
})
```

If no trim is due, report current state succinctly:
- Stage: N
- Latest close vs each EMA
- Days since entry
- Next watch level (which EMA is next in the ladder)

## Honest caveats

- The indicator is observational — it has no record of which trims the operator has already taken. Stage tracking is on the operator (or wired through `memory_write` notes on the trade).
- Daily-close timing matters. Don't trigger trims on intraday EMA breaks; wait for the bar to close.
- This is for the momentum-swing playbook specifically. A scalp or pairs trade has different exit logic; don't import the trim ladder onto unrelated setups.
- "No one is smarter than the moving averages" — Quallmaggie. The trail does the work; the operator just executes the peel.
