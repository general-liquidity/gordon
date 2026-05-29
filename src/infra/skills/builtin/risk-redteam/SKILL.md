---
name: risk-redteam
description: "Hostile failure-mode review of your own risk rules. When user says /risk-redteam, 'red-team my risk config', 'what could break my stops/sizing/circuit-breakers', 'stress-test my risk rules', or wants an adversarial review of their sizing logic, stops, and drawdown breakers — run a deliberately hostile pass that surfaces failure modes the operator can't see because they built it. Composes the adversarial evaluator + the known risk-config failure-mode checklist. Pure composition — no new code."
arguments: [config?]
argument-hint: Optional pointer to the risk config (or describe it inline). If omitted, gather sizing rule, stops, drawdown breakers, and correlation assumptions.
tags: [risk, review, adversarial, red-team]
user-invocable: true
status: active
last-reviewed: 2026-05-29
---

Red-team the operator's **risk rules** — not a single trade, the *configuration*. The premise from "The AI Quant": an AI risk review is "sharper than most prop-desk risk reviews because the model lacks the 'I built this so it must be defensible' bias." This is the one place AI red-teaming clearly beats the human, because the human can't see the failure modes in a system they designed.

Pure-composition skill. It wires the existing `adversarialEvaluator` (which enforces *minimum hostility* — a review that finds zero issues is treated as a failed review, not a passed config) onto the operator's risk parameters, guided by a checklist of known risk-config failure modes.

## Step 1: Gather the risk configuration

Collect the operator's actual risk rules (from `pre_trade_risk_gate` params, the trading constitution, or the operator directly):
- **Sizing logic** — fixed %, vol-adjusted, Kelly fraction? What inputs drive it?
- **Stops** — fixed %, ATR-multiple, structure-based? Per-trade and portfolio?
- **Drawdown circuit-breakers** — daily / weekly limits, and what they trigger (halt, de-risk, notify).
- **Correlation / concentration assumptions** — how is cross-position correlation estimated, and when?
- **Regime conditioning** — do any rules change by regime, or are they static?

If the operator can't state these precisely, that itself is finding #1 — an unspecified rule can't be enforced.

## Step 2: Run the hostile review

Frame the review with `adversarialEvaluator`'s discipline: the reviewer MUST produce a minimum number of distinct, categorized, severity-rated failure modes before its verdict counts. A "looks fine" review is rejected. Force the model to attack each rule against this checklist of known risk-config failure modes:

- **Correlation-through-a-hidden-factor under stress.** The rule assumes positions are diversified, but they share a latent factor (BTC beta, a single sector, a funding regime) that only co-moves during a vol expansion. Cross-reference the `hidden_beta_verifier` — "you think you're neutral but you're not."
- **Stop-gap risk.** Stops assume continuous fills. What happens on a gap, halt, weekend, or thin-liquidity wick straight through the level? Is the stop a guarantee or a hope?
- **Circuit-breaker too slow.** A daily drawdown breaker doesn't help against a single-bar -30% gap. Does the breaker fire on realized PnL only, or also on open-position mark-to-market / exposure?
- **Sizing under vol expansion.** Vol-adjusted sizing uses *trailing* vol. When vol regime-shifts, trailing vol understates current risk and the rule sizes up into the storm. (This is the August-2007 / deleveraging-cascade failure mode.)
- **Capacity / liquidity.** Does the sizing rule assume fills that the instrument's ADV can't actually provide without moving price?
- **Single point of failure.** Does one input (a data feed, a correlation estimate, a vol number) drive multiple rules so its failure cascades?
- **The rule that never fired.** Any circuit-breaker that has never triggered in the operator's history is untested — is it wired correctly, or silently broken?

## Step 3: Rank and report

Present each surfaced failure mode with:
- **Category** (correlation / stops / circuit-breaker / sizing / liquidity / single-point-failure)
- **Severity** (how much capital is at risk if it fires)
- **Trigger condition** (the specific market state that exposes it)
- **The unprotected scenario** stated concretely ("a Friday-night BTC gap of -25% with all three alt positions correlated to BTC → stops slip ~8%, daily breaker fires only Monday, est. loss ~Y%")

Order by severity × likelihood. Lead with the failure modes the operator's current rules give *zero* protection against.

## Step 4: Recommend hardening — but the operator owns the call

Propose concrete rule changes for the top failure modes (mark-to-market breaker, correlation-aware sizing, gap-aware stop assumptions). But per the article's division of labour: **AI red-teams; the operator owns the portfolio-weights and kill-switch calls.** Present recommendations as candidates, not auto-applied changes. Risk-config changes are never auto-executed.

## Step 5: Audit

```
audit_event({
  action: 'OBSERVATION',
  summary: 'risk-redteam: <N> failure modes, top severity <X> (<category>)',
  parameters: { failure_modes: [{ category, severity, trigger }], top_unprotected_scenario }
})
```

## Honest caveats

- **Hostility is the point.** A review that praises the config is a failed review. If the pass surfaces nothing, re-run it harder — `adversarialEvaluator` exists precisely because models default to confidently approving work.
- **The model can't see your live book.** It red-teams the *rules* as stated. The correlation-under-stress finding is a hypothesis to verify against your actual positions — pair with `hidden_beta_verifier` on your real return series.
- **This is a review, not a fix.** It surfaces failure modes; hardening the rules and pulling the kill-switch remain operator calls.
- Composes with [[risk-check]] (per-trade risk), the `hidden_beta_verifier` (correlation-through-hidden-factor), and [[desk-review]]. Pair with [[survivorship-check]] when the risk rules were calibrated on a possibly-biased backtest.
