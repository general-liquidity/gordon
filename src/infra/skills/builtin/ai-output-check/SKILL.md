---
name: ai-output-check
description: "Three-check verification of any AI-generated trading claim or candidate before you trust it. When user says /ai-output-check, 'verify this AI output', 'is this stat real', 'should I trust this generated strategy', or pastes an AI-produced claim/strategy/stat — run the three checks: stat-source (find the source), instrument-specificity (strip the generality), falsifiability (try to falsify it). Composes the citation agent + strategy-claim-verifier. Pure composition — no new code."
arguments: [claim?]
argument-hint: The AI-generated claim, stat, or strategy to verify (or a pointer to it).
tags: [review, verification, ai-output, validation]
user-invocable: true
status: active
last-reviewed: 2026-05-29
---

Run the **three-check framework** on an AI-generated output before trusting it. From "The AI Quant": AI is a strong candidate-generator and red-team partner, but its outputs must clear three checks before they enter your funnel. Most AI trading claims fail at least one. The discipline is what separates "compounding speed" from "compounding garbage."

Pure-composition skill. Composes the existing `citationAgent` (source-finding) and `strategy-claim-verifier` (claimed-vs-realized falsification). It does not generate — it interrogates.

This applies to anything AI produced: a strategy candidate, a backtest stat, a "factor X predicts Y" claim, a cited framework. Run it on the output, not the author.

## Check 1: Stat-source check — *find the source for any specific stat.*

For every concrete number in the output (CAGR, Sharpe, win-rate, "X% of the time"), demand its provenance:
- Where did this number come from — a backtest the agent ran, a cited paper, or fabrication?
- Use `citationAgent` to locate the actual source. If the agent claims a stat from a paper/author, verify the paper says it.
- **Red flag:** a precise number with no traceable source ("momentum returns 18% annually") is almost always confabulated or stripped of its conditions.

If a stat has no source, mark it UNSOURCED and treat the claim as unverified regardless of how plausible it sounds.

## Check 2: Instrument-specificity check — *strip the generality.*

AI outputs over-generalize. A claim that's true for SPY at daily frequency is often false for a small-cap or a crypto perp at 5m.
- For what instrument, timeframe, and regime is the claim actually true?
- Does the output silently assume liquid large-caps when you trade alts? Daily bars when you scalp?
- Re-state the claim with its real scope: not "mean-reversion works," but "1-day mean-reversion in liquid large-cap equities during low-vol regimes, before costs."

A claim that won't survive being made specific to *your* instrument/timeframe is not actionable for you — it's a generality.

## Check 3: Falsifiability check — *if you can falsify, do so.*

The strongest check: try to break it.
- Is the claim even falsifiable? An unfalsifiable claim ("the market is efficient enough") carries no information — discard it.
- If it IS falsifiable, falsify it: run `strategy-claim-verifier` to compare the claimed stats against a realized backtest (claimed Sharpe vs realized, claimed gamma posture vs realized skew, claimed maxDD vs realized). If the realized numbers contradict the claim, it's falsified.
- For a strategy candidate, this also means: would it survive `vs_random` (best-of-random), MCPT, and a `survivorship_risk` check? An AI strategy that can't beat random or is survivorship-biased is falsified for trading.

## Verdict

Combine the three checks into one verdict:
- **TRUST (provisionally)** — sourced, scoped to your instrument, survived falsification attempts. Promote to the candidate funnel / incubation. (Still earns trust forward — see caveats.)
- **VERIFY FURTHER** — passed some checks; name exactly what's still unsourced/unscoped/untested before it advances.
- **REJECT** — unsourced stat, or falsified, or unfalsifiable. Don't let it into the funnel; the edge is in throughput of *screened* candidates, not raw output volume.

## Audit

```
audit_event({
  action: 'OBSERVATION',
  summary: 'ai-output-check: <verdict> — source <ok|unsourced>, scope <specific|general>, falsifiable <yes|no>, falsified <yes|no>',
  parameters: { claim, stat_source, instrument_scope, falsifiable, falsified, verdict }
})
```

## Honest caveats

- **The checks are about the output, not the model.** A strong model still confabulates stats and over-generalizes — that's not a reason to distrust AI generation, it's the reason this discipline exists. The article's frame: AI's edge is the *compounding speed of screened candidates*, and screening is non-negotiable.
- **"Trust" is provisional and forward-earned.** Even a candidate that clears all three checks is a hypothesis — route it through incubation (paper → live via the genome lifecycle + PSR/DSR) before real size. Passing three checks gets you into the funnel, not into the book.
- **Operator owns selection.** This skill screens candidates; which screened candidate to actually trade is the operator's call (regime-forward, capacity, existing book) — exactly the part the article says AI breaks down on.
- Composes with `citationAgent`, `strategy-claim-verifier`, and pairs with [[survivorship-check]], [[backtest-validate]], and [[hindsight-check]]. The `vs_random` / MCPT primitives are the falsification workhorses.
