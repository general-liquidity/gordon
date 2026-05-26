---
name: regime-shift
description: Respond to a detected market regime change. When user says "the market just flipped", "BTC just broke down", "regime change", "vol just spiked", "what do we do now", or when the proactive radar fires a regime-shift card and the operator wants a structured response — re-classify, re-sort the portfolio, check strategy mandate fits, decide whether to act
arguments: [symbol]
argument-hint: Symbol that triggered the regime shift (e.g., BTC, SPY)
tags: [regime, risk, defensive, portfolio]
user-invocable: true
status: active
last-reviewed: 2026-05-25
---

Respond to the regime shift on {symbol}. Regime changes invalidate strategies built on prior regime assumptions — speed matters but panic doesn't. Triage in this order: confirm → portfolio impact → active strategies → new opportunities.

## Step 1: Confirm the regime change isn't a head-fake
Call `compute_regime` on {symbol} with confidence scoring. Cross-check on the next timeframe up:
- If 1h flipped, check 4h. Is it confirming or contradicting?
- Low-confidence regime calls (< 0.6) are noise — pause and re-check after one bar.

Call `compute_indicator(atr)` to gauge whether vol expansion is real or noise.

## Step 2: Portfolio impact assessment
`get_portfolio` to enumerate open positions. For each position:
- Is it correlated to {symbol}? Use `compute_microstructure(operation: 'correlation_breakdown')` to confirm.
- Is the position's strategy gate still valid under the new regime? E.g. mean-reversion strategies break when trend regime activates.

## Step 3: Active mandate audit
`schedule_task({ action: 'list' })` to enumerate running mandates. For each:
- Was the mandate's regime assumption violated? Mean-reversion mandate + trend-onset = pause.
- High-priority: pause mandates whose entry signal still fires but whose exit logic assumes the OLD regime.

Use `schedule_task({ action: 'pause' })` for mandates that need a regime-gate update. Don't stop them — pause, so they don't accumulate orphan positions.

## Step 4: Open-position defensive moves
For positions invalidated by the regime shift:
- Use `cancel` on stops that are now too wide for the new vol regime (and re-place tighter via `create_plan` + the executor flow).
- Consider partial position closes: `cancel({ target: 'partial', percentPct: 50 })` for de-risking without full exit. Always include a reason.

## Step 5: Opportunity check (only after defense)
Now that the portfolio is safe, ask: does the new regime CREATE setups?
- Trend-onset → breakout strategies activate.
- High-vol regime → volatility-selling structures (only if explicitly mandate-approved — these are tail-risk plays).
- Ranging → mean-reversion + market-making.

Use `compute_risk` before any new entry — the new regime may have moved risk tiers.

## Step 6: Memory + audit
`memory_write` with `kind: 'observation'`, content describing the regime shift + portfolio response. Tag with regime keywords.
`audit_event` with `action: 'REGIME_RESPONSE'` summarizing what was paused, closed, opened, and why.

The default action on a regime shift is DEFEND, not OFFEND. Most operators lose more by chasing the new regime than by adapting calmly. If unclear, `ask_user` for direction before any aggressive re-positioning.
