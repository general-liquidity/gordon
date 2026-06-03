---
name: thesis-redteam
description: "Adversarial fan-out red-team of a TRADE THESIS — attack the reason for a specific trade from independent hostile seats (bear, liquidity, crowd/positioning, regime, base-rate/falsification, hidden-exposure), then synthesize a survives/weakened/refuted verdict. When user says /thesis-redteam, 'red-team this trade idea', 'tear my thesis apart', 'why might this trade be wrong', 'steelman the other side of X', 'is my reason for this trade sound', or wants the investor/customer/competitor-style adversarial review applied to a trade rationale. Attacks the IDEA, not the risk config (use risk-redteam) and not executability (use desk-review). Pure composition over the existing surface — no new code."
arguments: [thesis?]
argument-hint: The trade thesis to attack — symbol + direction + the reason (e.g. "long SOL, breakout + funding reset"). If omitted, ask for symbol, direction, and the one-sentence why.
tags: [planning, review, adversarial, red-team, premortem]
user-invocable: true
status: active
last-reviewed: 2026-06-04
---

Red-team a single **trade thesis** — the *reason* for a specific trade, not the risk config and not the order mechanics. The premise (same as [[risk-redteam]], from "The AI Quant"): the operator can't see the holes in a thesis they authored — "I came up with this, so it must be right" is exactly the bias an independent adversary doesn't carry. This translates the harness "tear my plan apart from N perspectives" pattern onto Gordon's surface, with the adversarial-verification discipline: **a seat that finds nothing is a failed pass, not a clean bill.**

Pure-composition skill — it wires existing read-only surface ops into independent hostile seats. It places UPSTREAM of execution: thesis-redteam (is the idea sound?) → [[desk-review]] (is it executable?) → `create_plan` / `verify_plan`. It never plans or executes.

Run each seat. The orchestrator can play the seats in sequence itself, or — if `GORDON_DYNAMIC_SUBAGENTS=1` — fan them out as parallel `delegate_subagent` calls and merge. Either way, **each seat must return at least one concrete, severity-rated refutation**; "the thesis looks fine" is rejected — re-run that seat harder.

First, pin the thesis. Ask once for what's missing — don't infer:
- **Symbol + direction** (long/short) and rough **size**.
- **The why** in one sentence (the edge: breakout, mean-reversion, funding, catalyst, regime, relative-value…).
- **The invalidation** the operator already has in mind (if none, that's a finding).

## Seat 1: Bear seat — the strongest case this goes the other way

Build the best opposing argument, not a strawman.
```
compute_regime({ symbol, timeframe: "1d" })
compute_indicator({ symbol, indicator: "divergence", timeframe: "4h" })
compute_indicator({ symbol, indicator: "structure_break_conviction", timeframe: "4h" })
```
Attack: what does the chart/regime say if you assume the operator is wrong? Name the specific opposing signal (bearish divergence, failed-breakout structure, trend exhaustion) and the price level that would confirm the bear case. Severity = how much of the thesis it negates.

## Seat 2: Liquidity seat — the exit you're assuming may not exist

```
get_market_data({ dataType: "orderbook", symbol, depth: 20 })
compute_microstructure({ operation: "fake_liquidity", params: { symbol, timeframe: "1h" } })
```
Attack: at the intended size, can you actually exit without moving price? Is displayed depth real (wash/spoofed) or will it vanish on a flush? The thesis may be right and still lose if the exit isn't there. Cross-check the constitution's `MAX_PCT_OF_DAILY_VOLUME`.

## Seat 3: Crowd / positioning seat — is this a consensus trade?

```
compute_microstructure({ operation: "crowd_positioning", params: { symbol } })
get_news({ source: <"crypto"|"stocks">, symbol, sinceMinutes: 1440 })
```
Attack: is everyone already on this side? A thesis everyone shares has no edge left and a violent unwind risk (the [[crowd-trapped]] pattern). If funding/sentiment/news all point the same way as the thesis, that's a refutation, not a confirmation.

## Seat 4: Regime seat — is the thesis about to be invalidated?

```
compute_microstructure({ operation: "hmm_regime", params: { symbol, timeframe: "1d" } })
```
Attack: is the edge regime-conditional, and is the regime stable? A momentum thesis into a likely regime flip, or a mean-reversion thesis in a strong trend, is the right idea in the wrong world. Name the regime the thesis needs and whether we're in it.

## Seat 5: Base-rate / falsification seat — "you're not special"

```
compute_microstructure({ operation: "dcf", params: { ... } })   # if equity / valuation thesis
memory_search({ query: "<this setup type> outcome" })            # operator's own history with this setup
```
Attack: what would have to be true for this to work, and how often is that actually true? What's already priced in (don't pay for consensus)? Has the operator run this exact setup before — and how did it go (`memory_search` the trade journal)? Lead with the base rate, not the story.

## Seat 6: Hidden-exposure seat — is this just your book again?

```
compute_microstructure({ operation: "vol_residual_correlation", params: { returnsBySymbol: { <candidate>: [...], <each open position>: [...] } } })
```
Attack: is this "new" trade actually re-expressing exposure you already hold? Raw correlation can look fine while a shared vol-timing or latent factor (BTC beta, one sector, a funding regime) means you're doubling a bet, not diversifying. A `hidden` pair here refutes the "it's a separate idea" assumption. Pair with the `hidden_beta_verifier` on real return series.

## Synthesize — verdict, not a pep talk

Collect every seat's refutations. For each: **category** (bear / liquidity / crowd / regime / base-rate / hidden-exposure), **severity** (how much capital/edge is at risk if true), and the **concrete trigger** that exposes it. Then:

- **Lead with the single strongest reason NOT to take this trade** — the thing the thesis has *zero* answer for.
- Verdict: **REFUTED** (a high-severity seat negates the core edge) / **WEAKENED** (the edge survives but is smaller/more conditional than the operator thought — state the new, honest version) / **SURVIVES** (no seat landed a high-severity hit *and* every seat genuinely tried).
- If WEAKENED or SURVIVES, hand off: "Idea holds — run [[desk-review]] on {symbol} to check it's executable, then `create_plan`." Never plan or execute from this skill.

## Audit

```
audit_event({
  action: "OBSERVATION",
  summary: "thesis-redteam {symbol} {side}: <REFUTED|WEAKENED|SURVIVES>, top: <category>/<severity>",
  parameters: { symbol, side, verdict, refutations: [{ category, severity, trigger }], strongest_reason_not_to }
})
```

## Honest caveats

- **Hostility is the point.** A red-team that blesses the thesis is a failed red-team — models default to agreeing with the user. If a seat finds nothing, it didn't try; re-run it.
- **It attacks the idea, not the book.** Findings like hidden-correlation or crowding are hypotheses to verify against your *actual* positions and the `hidden_beta_verifier` on real return series.
- **Review, not decision.** It surfaces reasons to skip; sizing, the kill-switch, and the call to trade remain the operator's. Nothing here auto-executes.
- Scope: [[risk-redteam]] attacks the risk *configuration*; [[desk-review]] checks *executability* with veto gates and builds a plan; **thesis-redteam attacks the *reason* for the trade** and sits before both. Pair with [[survivorship-check]] if the edge was calibrated on a possibly-biased backtest.
