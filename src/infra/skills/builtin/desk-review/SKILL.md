---
name: desk-review
description: Walk a candidate trade through six desk roles in sequence — Market Scout, Data Scout, Probability Agent, Quant Agent, Risk Officer, Execution Guard. When user says "desk review on X", "run this trade through the committee", "full pre-trade workup", "is this trade ready", or wants the multi-role pattern the article describes applied to one specific setup. Each role can REJECT and any rejection kills the trade
arguments: [symbol]
argument-hint: Symbol the operator is considering (e.g., NVDA, BTC/USDT)
tags: [planning, governance, premortem]
user-invocable: true
status: active
last-reviewed: 2026-05-26
---

Run a structured six-role desk review on a candidate trade in {symbol}. The article's pattern — 6 specialists with veto power — applied to Gordon's tool surface. Each role is a tool sequence with explicit accept/reject criteria. **If any role rejects, the trade is dead. State the rejection plainly and stop.**

Ask the operator for the missing inputs at the start: direction (long/short), intended size in USD, and timeframe. Don't infer — ask once.

## Role 1: Market Scout — is this market worth researching at all?

```
get_market_data({ dataType: "ticker", symbol: "{symbol}" })
get_market_data({ dataType: "orderbook", symbol: "{symbol}", depth: 20 })
```

Accept if ALL of:
- Spread ≤ 0.1% of price (liquid instrument)
- Visible 20-level depth ≥ 5× intended size (book can absorb the trade)
- Recent 24h volume > $1M USD-equivalent

Reject and stop if ANY of:
- Spread > 0.5% of price → "Spread eats the edge. Skip."
- Visible depth < 2× intended size → "Liquidity cannot support size. Either reduce size or pick a different instrument."
- 24h volume < $500K → "Thin market. Slippage risk too high for swing position."

State the verdict explicitly: `MARKET SCOUT: ACCEPT — spread X%, depth $Y, vol $Z` or `MARKET SCOUT: REJECT — <reason>`.

## Role 2: Data Scout — does the data backing this decision exist and is it fresh?

For the candidate, pull and timestamp every data source used in the rationale:
```
get_market_data({ dataType: "candles", symbol: "{symbol}", timeframe: "1d", limit: 200 })
get_news({ source: <"crypto"|"stocks">, symbol: "{symbol}", sinceMinutes: 240 })
```
If equity: also `get_fundamentals` for `profile` + `earnings`.

Accept if:
- Latest candle close is within the last bar
- News fetched within the last 4 hours OR no news-driven thesis
- All fetched payloads carry a `fetchedAt` timestamp

Reject and stop if:
- Stale candles → "Data is stale. Refresh and re-run."
- News thesis but no recent headlines → "Operator's narrative not supported by current news."
- Any source returned `error` → "Source unavailable. Cannot build a ticket on missing data."

State: `DATA SCOUT: ACCEPT — N sources, freshest <timestamp>` or `DATA SCOUT: REJECT — <reason>`.

## Role 3: Probability Agent — what's the fair-value range?

```
compute_microstructure({
  operation: "monte_carlo_path",
  params: {
    symbol: "{symbol}",
    horizonBars: <operator's timeframe in bars>,
    timeframe: "1d",
    exceedanceLevels: [<intended_stop>, <current_price>, <intended_target>]
  }
})
```

Read out:
- p05 / p50 / p95 of terminal price
- P(terminal ≥ target) — the win probability for the trade
- P(terminal ≤ stop) — the stop-out probability

Accept if:
- p50 sits on the favorable side of current price (long: p50 > current; short: p50 < current)
- P(terminal hits target) ≥ 1 / (1 + R) where R is the risk-reward ratio of the plan

Reject if:
- p50 implies the model expects the trade goes the wrong way → "Probability Agent disagrees with the direction."
- Win probability × payout < loss probability × 1R → "Negative expected value. Skip."

State: `PROBABILITY AGENT: ACCEPT — p_win <X%>, p50 <price>` or `PROBABILITY AGENT: REJECT — <reason>`.

## Role 4: Quant Agent — does the size make sense after costs?

Use the win probability from Role 3 + the R-multiple of the intended plan:
```
compute_microstructure({
  operation: "kelly_size",
  params: {
    winProbability: <p_win from Role 3>,
    bankrollUsd: <operator's bankroll>,
    payoutRatio: <intended_target_distance / intended_stop_distance>,
    mode: "rr",
    fractionMultiplier: 0.25
  }
})
```

Then `compute_risk({ symbol, side, notionalUsd: <operator's intended size> })` for the 15-dim classifier (8 base + 7 optional).

Accept if BOTH:
- Quarter-Kelly recommends a non-zero size
- `compute_risk` returns tier `low` or `medium`
- Operator's intended size ≤ 1.5× the quarter-Kelly recommendation (no over-sizing)

Reject if:
- Quarter-Kelly verdict is `skip` → "No edge after the math. Skip."
- `compute_risk` returns tier `high` or `critical` → "Risk classifier flags. Reduce size or skip."
- Operator's intended size > 2× quarter-Kelly recommendation → "Over-sized. Reduce to ≤ <recommended>."

State: `QUANT AGENT: ACCEPT — Kelly recommends $X, intended $Y, tier <T>` or `QUANT AGENT: REJECT — <reason>`.

## Role 5: Risk Officer — formal veto via verify_plan

At this point, propose the actual plan to `create_plan` using the parameters that survived Roles 1-4. Use the Kelly-recommended size, not the operator's original number if it was larger. Set `routingPolicy: "maker_first"` by default.

Then immediately `verify_plan({ planId: <returned-id> })`.

Accept if verdict is `approve` or `conditional` with constitutionViolations empty after routing policy.

Reject if verdict is `reject`, OR if constitutionViolations contains `ROUTING_VIOLATION`, OR if riskTier is `critical`. Each rejection cites the violating rule.

State: `RISK OFFICER: ACCEPT — verdict <V>, tier <T>` or `RISK OFFICER: REJECT — <violation>`.

## Role 6: Execution Guard — is the plan ready to actually execute?

The Execution Guard is the last gate before money moves. Check ALL of:
- Plan has a stop loss set (not null, not zero)
- Plan has at least one take-profit level
- Plan rationale ≥ 10 chars (already enforced by schema, double-check)
- `routingPolicy: "maker_first"` (or operator explicitly chose `"any"` with a recorded rationale)
- Operator is not currently flagged by `discipline_audit` for emotional trading or overtrading in the last 24h
- For the first 30 days of using Gordon: paper mode preferred. Suggest paper if the operator hasn't already enabled it.

Run a quick discipline check:
```
compute_microstructure({
  operation: "discipline_audit",
  params: { startTime: <-24h ISO>, endTime: <now ISO> }
})
```

Accept if no high-severity flags fired in the last 24h.

Reject if:
- Discipline audit shows alert-level emotional trading or stop violations → "Operator is in a flagged state. Wait."
- Operator is on a loss streak in the last 24h → "Recommend cooldown before next entry."

State: `EXECUTION GUARD: ACCEPT — ready for approve_plan` or `EXECUTION GUARD: REJECT — <reason>`.

## Summary verdict

If all six roles accepted, output:
```
DESK REVIEW: APPROVED — 6/6 roles cleared.
Plan ID: <pln_X>
Next step: approve_plan({ planId: "<pln_X>", rationale: "<one-sentence operator confirmation>" })
                       then execute_plan when ready.
```

If any role rejected, output:
```
DESK REVIEW: REJECTED at Role <N> (<role name>).
Reason: <verbatim reject reason>
Fix: <what would change the verdict>
```

Audit-trail every desk review at the end:
```
audit_event({
  action: "OBSERVATION",
  summary: "desk-review on {symbol}: <APPROVED|REJECTED at role N>",
  parameters: { symbol, roles_passed: [...], reject_role: <N or null>, plan_id: <if created> }
})
```

## Why this exists

Six roles, each with veto power, run in sequence. The first reject ends the review. The point isn't to find a reason to take the trade — it's to find the cheapest reason to skip it. **Most outputs should be rejections at one of the six gates. That is the system working.**
