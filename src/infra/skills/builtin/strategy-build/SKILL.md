---
name: strategy-build
description: Build a new trading strategy from an operator hypothesis. When user says "I have a strategy idea", "let's build a strategy for X", "I noticed Y — can we turn it into a strategy", "draft a playbook for Z", or wants to translate a market observation into a backtestable, executable playbook
arguments: [hypothesis]
argument-hint: One-line strategy hypothesis (e.g., "RSI mean reversion on BTC during ranging regimes")
tags: [strategy, planning, backtest]
user-invocable: true
status: active
last-reviewed: 2026-05-25
---

Translate the operator's hypothesis "{hypothesis}" into a structured, testable trading strategy. Strategies should be specific enough to backtest and explicit enough to audit.

## Step 1: Sharpen the hypothesis
Restate the operator's idea in this form:
- WHEN [market condition] THEN [signal] ENTRY [trigger] EXIT [trigger or invalidation]
- Identify the regime where this is expected to work (use `compute_regime` mental model)
- Identify why the edge should exist (microstructure, behavioral, structural). No "why" = no edge.

If `ask_user` is needed to clarify a vague hypothesis, do that ONCE before proceeding.

## Step 2: Translate to primitives
Map signal to `compute_indicator` calls:
- e.g. "ranging regime + oversold" → `compute_regime` confirms ranging, `compute_indicator(rsi)` < 30
- e.g. "breakout from consolidation" → `compute_indicator(bollinger)` band width contraction then expansion
- e.g. "smart-money zone" → `compute_indicator(order_blocks)` or `supply_demand_zones`

Map entry rules to `create_plan` shape:
- Limit vs market entry, stop-loss invalidation level, take-profit ladder, sizing rule.

## Step 3: Define guard rails
A strategy spec MUST include:
- Per-trade risk cap (% of equity)
- Max concurrent positions
- Regime gate (when to NOT run this strategy)
- Daily loss circuit breaker
- Time-of-day filter if relevant (e.g. avoid first 15 min of US session for crypto cross-asset spillover)

## Step 4: Quick sanity backtest
Call `backtest` on a recent 90-day window with the spec. Don't iterate yet — just check it RUNS and produces non-nonsensical numbers.

## Step 5: Hand off to backtest-validate
If the quick backtest is non-trivial (Sharpe > 0.5, drawdown < 30%), invoke the `backtest-validate` skill for the full validation gauntlet. If it's trivial reject the hypothesis or revise.

## Step 6: Save the spec
Use `memory_write` with `kind: 'observation'` to record the strategy spec + initial backtest numbers + verdict. Tag with the hypothesis keyword. Strategies are versioned — never delete, only deprecate.

## Step 7: Audit
`audit_event` with `action: 'STRATEGY_DRAFTED'` summarizing hypothesis, regime gate, expected edge, initial backtest result.

Do NOT auto-deploy. Strategies go through validate → operator approval → mandate creation. Building a spec is NOT the same as turning it on.
