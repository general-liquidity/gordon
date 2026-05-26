---
name: audit-plan
description: Hostile pre-mortem on a candidate or approved plan. When user says "audit this plan", "what's wrong with this trade", "stress test", "before I approve", "find the failure modes", or wants an adversarial-reviewer pass that actively tries to break the plan before money moves. Returns fatal issues, fixable issues, final decision, and the evidence that would change the verdict
arguments: [planId]
argument-hint: Plan ID to audit (e.g., pln_d6agj4mk)
tags: [risk, audit, premortem, governance]
user-invocable: true
status: active
last-reviewed: 2026-05-26
---

Adversarial review of plan {planId}. The point: a plan that survives a hostile reviewer is materially less likely to blow up than one that survived only its own author's review. The Risk Officer in `verify_plan` checks rules. This skill checks the operator's reasoning, the data freshness, and the stress cases the original sizing didn't consider.

## Step 1: Pull the plan + recent context

Don't trust the plan as written — pull the actual record. Get the plan's current state, the rationale, the size, and any prior verify_plan output.

Use `memory_search` with the plan ID as the query. Use `audit_event` to inspect recent CREATE_PLAN / VERIFY_PLAN entries. Read the audit log JSONL directly if needed — `~/.gordon/audit.jsonl`.

If the plan is older than 4 hours, flag it as **stale-plan risk**. The market that produced the setup may no longer exist.

## Step 2: Re-run verify_plan with current state

`verify_plan({ planId: "{planId}" })` — fresh evaluation against the live exchange.

If the verdict was `approve` at creation but is now `conditional` or `reject`, that's a **regime drift** flag. The plan was good when it was made; it's no longer good. Surface this explicitly.

## Step 3: Stress-test sizing

Re-run `compute_risk` with progressively larger positions:
- `compute_risk({ symbol, side, notionalUsd: <plan.sizeUsd> })` → baseline
- `compute_risk({ symbol, side, notionalUsd: <plan.sizeUsd * 2> })` → 2× stress
- `compute_risk({ symbol, side, notionalUsd: <plan.sizeUsd * 5> })` → 5× stress

The point isn't whether the operator would size at 5× — it's at what multiple the plan flips from low → high → critical. A plan that only works at exactly its nominal size is brittle. A plan that survives 2× is sturdy.

## Step 4: Memory check — has this kind of plan failed before?

`memory_search({ query: "<symbol> <strategy> stop", scope: "lessons" })` — pull lessons from prior failures on this symbol or strategy.

Specifically look for:
- ACE-distilled `execution_failure` lessons mentioning this venue
- ACE-distilled `cancel_rationale` entries on similar setups
- Discipline-audit flags that match the plan's characteristics

Quote any lesson verbatim in the output. The operator should see "you wrote this down 3 weeks ago" rather than a generic warning.

## Step 5: Market-memory cross-check

`compute_microstructure({ operation: "market_memory", params: { symbol, timeframe: "1d", lookbackBars: 600 } })`

The plan's strategy class is implied by the rationale. If the rationale describes a momentum/breakout play, the verdict should be `trending`. If mean-reversion, `mean_reverting`. If they don't match, surface as **strategy-class mismatch**.

## Step 6: Concentration + correlation

`get_portfolio()` — see what's already open.

If the plan's symbol is correlated to existing positions (e.g. another tech name when NVDA is already open), flag as **correlated exposure**. Use `compute_microstructure({ operation: "correlation_breakdown", params: { symbols: [<plan-symbol>, <existing-positions>], timeframe: "1d", lookbackBars: 200 } })` to confirm.

## Step 7: Discipline audit cross-reference

`compute_microstructure({ operation: "discipline_audit", params: { startTime: <-7d-ISO>, endTime: <now-ISO> } })`

If the operator is currently flagged for any of the 7 failure modes (overtrading, emotional trading, etc.), surface that as a **behavioral risk** independent of the trade's merits. A good plan taken under bad discipline is still a bad operator decision.

## Step 8: The hostile reviewer summary

Return the article's audit-prompt output shape — exactly this structure:

```
FATAL ISSUES (any one of these = reject):
  - <issue>: <evidence>
  - ...

FIXABLE ISSUES (operator can address before execute):
  - <issue>: <evidence + fix>
  - ...

FINAL DECISION: REJECT | NEEDS_REVISION | APPROVE_WITH_CAVEATS | APPROVE

EVIDENCE THAT WOULD CHANGE THE DECISION:
  - <specific data point or condition>
  - ...
```

The harshest section is FATAL ISSUES. If there's nothing fatal, say so — but don't soften the fixable issues to make the operator feel better. The whole point of this skill is to be the friend who tells you the trade is wrong, not the one who agrees with you to be nice.

## Step 9: Record the audit

`audit_event({ action: "OBSERVATION", summary: "audit-plan on {planId}: <final-decision>", parameters: { planId, fatal_count, fixable_count, verdict } })`

`memory_write({ kind: "observation", content: "Audit verdict on {planId}: <decision>. Fatal: <list>. Fixable: <list>.", tags: ["audit-plan"] })`

The audit becomes part of the plan's provenance. If the operator approves despite a hostile verdict, that's a `RULE_OVERRIDE` audit event waiting to happen — `approve_plan({ overrideVerifyVerdict: true, rationale: "..." })`.

## Tone

Stay direct. The operator paid for honesty, not encouragement. Phrases like "this could work but..." are softer than the audit deserves. Use:
- "FATAL: [reason]" instead of "concern: [reason]"
- "EVIDENCE NEEDED: [data]" instead of "consider checking [data]"
- Quote prior failures verbatim rather than paraphrasing — the operator's own words from 3 weeks ago hit harder than your summary

If the audit finds nothing wrong, that's a valid outcome — say it cleanly. But before declaring a plan clean, look one more time at Step 7 (discipline audit). A clean plan under poor discipline is still a behavioral risk.
