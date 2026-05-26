---
name: recovery-trade
description: Structured response after a losing trade — review, regulate, reset before the next setup. When user says "just got stopped out", "lost on that one", "ready to make it back", "next trade", or any signal that the operator is about to put on a recovery / revenge / tilt trade — Gordon's job is to slow down, check discipline, and gate the next entry against the failure modes
arguments: [recentTradeId]
argument-hint: Recently closed trade ID (or skip if just talking through it)
tags: [discipline, recovery, psychology, risk]
user-invocable: true
status: active
last-reviewed: 2026-05-26
---

Respond to a recent losing trade. The operator is about to make one of the canonical mistakes — revenge size, tilt entry, reduced patience, premature re-entry, doubling down — unless the next trade goes through a structured gate. Gordon's job is to BE that gate, not to enable the trade.

## Step 1: Pull the closed-trade context
- `get_portfolio({ includeClosedToday: true })` — see recent closures and per-trade P&L
- `audit_event` is NOT needed here yet; we're reading, not writing

Identify:
- The trade that triggered this (entry, stop, what went wrong)
- Whether the stop was the rule-defined stop or a discretionary exit
- Time elapsed since close (< 30 min = tilt risk highest)

## Step 2: Discipline check — the 7 failure modes
`compute_microstructure({ operation: 'discipline_audit', params: { startTime: <-24h>, endTime: <now>, maxTradesPerDay: <mandate>, maxDistinctSlots: <mandate>, emotionalProximityMs: 1800000 } })`

This scores recent behavior against:
- Over-trading (count vs mandate)
- Strategy hopping (distinct slots)
- Revenge entries (proximity to losses)
- Mandate violations
- Size creep
- Stop violations
- Hours-of-day clustering

If any failure mode is flagged HIGH, that's a hard stop signal — `ask_user` to confirm they want to proceed despite the audit warning.

## Step 3: Adherence report
`compute_microstructure({ operation: 'adherence_report', params: { startTime: <-7d>, endTime: <now> } })`

Look at the deviation rate. If recent overrides are running > 20%, the operator is drifting from their stated rules — the next trade should be a RULE-PERFECT trade or no trade. No discretion.

## Step 4: Forced cooldown check (Gordon's discretion)
If proximity to the loss is < 15 minutes AND the loss exceeded 1.5% of equity → recommend a forced cooldown:
`ask_user({ question: 'Recent loss was significant. Recommend a 30-min cooldown before the next setup. Proceed anyway?', options: ['Cooldown', 'Proceed with reduced size (50%)', 'Proceed full size — I have a clear setup'] })`

Default suggestion: cooldown. Don't override the operator if they pick "full size" but make the choice explicit and audited.

## Step 5: If proceeding — the recovery trade MUST be a structured one
NO market-feel trades, NO doubling-down on the same symbol that just stopped out, NO oversize.

The next `create_plan` invocation should have:
- Different symbol from the loss (or 30+ min cooldown if same)
- Size ≤ 75% of normal mandate (recovery sizing)
- Stop placement that's rule-defined, not "wherever feels right"
- Rationale that explicitly names this as a post-loss trade

`compute_risk({ symbol, side, notionalUsd: <recovery-sized> })` BEFORE the plan — make sure the reduced size still passes the gate.

## Step 6: Audit the recovery cycle
`audit_event({ action: 'OBSERVATION', summary: 'Post-loss recovery flow run. Cooldown: <yes/no>. Next setup approved: <yes/no>.', parameters: { recentLossPct, cooldownRecommended, proceededWith } })`

This event aggregates into the discipline audit over time — repeated recovery-trade cycles are a behavioral signal worth tracking.

## Step 7: If declining the trade
That's a win, not a loss. `memory_write({ kind: 'lesson', content: 'Declined recovery trade after <loss> on <symbol> — preserved discipline.', tags: ['discipline', 'recovery'] })`

The operator's edge depends on what they DON'T trade as much as what they do. A losing trade plus a forced second loss is far worse than a single loss. Gordon's job here is to be the friend who tells you to put the keys away — politely, with structured reasoning, but firmly.
