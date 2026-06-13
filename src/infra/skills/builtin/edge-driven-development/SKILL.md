---
name: edge-driven-development
description: Drive a trading idea from a falsifiable edge instead of vibe-trading it. When user says "I have an edge", "let's do this properly", "run EDD on X", "write the edge first", "spec the edge before we trade", or wants the disciplined edge → verify → execute → monitor flow that gates capital behind a verified, machine-checkable thesis
arguments: [idea]
argument-hint: One-line edge idea (e.g., "trapped late longs get squeezed on BTC chop reversals")
tags: [methodology, edge, planning, backtest, risk, monitoring]
user-invocable: true
status: active
last-reviewed: 2026-06-14
---

Don't vibe-trade — write an edge, and let the **edge** be the source of truth. This is the trading-native analogue of Spec-Driven Development: SDD makes the spec authoritative; EDD makes the *edge* authoritative. The **edge** is the falsifiable input (the "spec"); **alpha** is the realized output (the "shipped feature"). You drive on the edge, not on the P&L.

The one rule SDD doesn't need and EDD lives by: **edges decay, code doesn't.** A spec is validated once at implementation. An edge must keep being true in a live market, so EDD validates *continuously* (Phase 5).

## Two artifacts

- **`EDGE.md`** — the *what*. A falsifiable thesis: a **mechanism** (who is on the wrong side and why the inefficiency exists), machine-readable **invariants** (conditions that must hold for the edge to be real), and **kill conditions** (what falsifies it). This is the new layer EDD adds.
- **`STRATEGY.md`** — the *how*. The execution rules. This already exists as a Gordon **playbook** (`src/core/playbooks/builtin/*.md`). EDD does not reinvent it — the edge *drives* a playbook.

## EDGE.md format

A sibling parser consumes this exactly. Keep the table shape; the parser reads `id | metric | comparator | threshold | description` rows.

```markdown
---
name: <edge name>
strategy: <playbook-id this edge drives>     # e.g. mean-reversion
status: proposed | verified | live | retired
regime: [ranging, chop]
instruments: [BTC/USDT]
---
## Hypothesis
<the edge + mechanism: who is trapped/wrong, why the inefficiency exists>
## Invariants
| id | metric | comparator | threshold | description |
|---|---|---|---|---|
| ev-net-positive | netEdgeBps | > | 0 | survives round-trip cost |
## Kill Conditions
| id | metric | comparator | threshold | description |
|---|---|---|---|---|
| ev-decayed | netEdgeBps | <= | 0 | edge no longer clears cost — retire |
## Verification
<the gauntlet record>
```

**Comparators:** `>` `>=` `<` `<=` `==` `!=` `in` `not-in`. The set operators (`in` / `not-in`) take a comma-separated set as the threshold (e.g. `regime` `in` `ranging,chop`).

## The 5-phase flow

Each phase uses primitives that already exist. EDD's contribution is the *sequence* and the gate between phases — no idea gets capital until it has survived the one before.

### 1. Specify the edge → `EDGE.md`
Write the falsifiable thesis. The Hypothesis must name the **mechanism** — who is trapped, why the inefficiency persists. "RSI is low" is not a mechanism; "late longs entered on the prior leg and are now offside, forced to puke into the reversal" is. No mechanism = no edge = stop here.
- Define **invariants** (what must be true) and **kill conditions** (what would prove it false) as machine-checkable rows.
- Governed by the trading **constitution** — deny-list, risk limits, kill-switch are non-negotiable and bound every later phase. An edge cannot spec its way around them.

### 2. Plan the strategy → `STRATEGY.md`
Bind the edge to a playbook (the `strategy:` field) and draft execution rules with `create_plan` — entry/exit triggers, stop invalidation, sizing, regime gate. The playbook is the *how*; the edge stays the *why*.

### 3. Verify the edge — BEFORE any capital (the gauntlet)
This is the heart of EDD. Three layers, all run before a single dollar is risked.

- **Deterministic floor** — does the edge clear the bar on history?
  - `backtest` over the canonical window + walk-forward (in-sample vs out-of-sample).
  - IC / cost gate: `core/alpha/ic-tracker.ts` — net edge *after* round-trip cost (this is `netEdgeBps`; it backs `ev-net-positive`).
  - Permutation test: `barPermutation` / `mcpt` — is the result distinguishable from noise?
  - Overfitting: `robustness-metrics.ts` — deflated Sharpe / PBO.
- **Adversarial ceiling** — try to *break* the edge with an **independent, cross-family** check. A model reviewing its own thesis is not a check — self-review rubber-stamps.
  - `verify_plan` (15-dimension risk gate) + the **critique phase** + the eval-harness **tri-judge panel** (cross-family, so one model family can't self-prefer its own reasoning).
  - Verdict: **TRADE / NEEDS-WORK / DO-NOT-TRADE**. Anything but TRADE loops back to Phase 1.
- **Incubation** — out-of-sample in the wild, still no real size.
  - `shadowMode`, paper mode, event-replay. The edge must survive data it has never seen before it earns capital.

Record the outcome in the `## Verification` section of `EDGE.md` and flip `status:` to `verified` only if all three layers pass.

### 4. Execute under the constitution
Only a **verified** edge gets capital. `approve_plan` → `execute_plan`, gated by the deny-list + kill-switch. A `proposed` edge reaching for execution is a bug — the gate should refuse it. Set `status: live`.

### 5. Monitor invariants live
The phase SDD has no analogue for, because **edges decay and code doesn't.** The `EDGE.md` invariants and kill conditions are not paperwork — they become **live monitors**.
- `core/edge/monitor.ts` (`evaluateEdgeInvariants`) evaluates each invariant/kill-condition row against live metrics; `infra/trading/ops/edgeStatus.ts` (`assessEdge`) folds that verdict with the statistical `edgeDecayMonitor.ts` — the more severe of "invariant broke" and "realized R decayed" wins.
- When a **kill condition fires**, the edge is **retired automatically** — `status: retired`, capital pulled. No human in the loop to rationalize "it'll come back."
- **Dreaming parallel:** an overnight pass curates the *edge ledger* — retire decayed edges, promote robust ones from `verified` toward higher conviction. The ledger is the portfolio of live theses, kept honest while you sleep.

## The contrast to keep in mind

| | SDD | EDD |
|---|---|---|
| Source of truth | the spec | the edge |
| Input → output | spec → feature | edge → alpha |
| Validation | **once**, at implementation (code is static) | **continuously** (Phase 5 — the edge must stay true live) |
| Failure mode it guards | vibe-coding | vibe-trading |

SDD validates once because code doesn't rot on its own. EDD validates forever because the market is adversarial and an edge that was real last quarter can be arbitraged away by this one.

## When to use / when not

- **Use** when an idea is worth risking capital on — a thesis you'd defend, intend to size, and want to hold accountable over time. EDD is the discipline that turns "I think X works" into a verified, monitored, auto-retiring edge.
- **Skip** for a one-off discretionary scratch trade — a gut scalp you'll be out of in minutes. Writing `EDGE.md` for a trade you won't repeat is ceremony, not edge. EDD pays off when the idea is meant to *recur*.
