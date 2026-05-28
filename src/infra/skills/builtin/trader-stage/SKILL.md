---
name: trader-stage
description: "Place the operator on the four-stage hockey-stick trading-growth curve. When user says /trader-stage, 'where am I on the curve?', 'am I improving as a trader?', 'what stage am I at', 'is my discipline compounding', or wants a longitudinal read on their development — run the discipline trajectory over rolling windows, supplement with consistency + return-dispersion trends, classify stage 1-4, and return the article's 'what moves you forward' guidance. Pure composition — no new code."
arguments: [windows?]
argument-hint: Optional window count (e.g. '8' for 8 rolling windows). Default 4 windows of 7 days each.
tags: [review, retrospective, growth, discipline, longitudinal]
user-invocable: true
status: active
last-reviewed: 2026-05-29
---

Place the operator on the four-stage **hockey-stick growth curve** and tell them honestly what moves them to the next stage. The article's thesis: trading progress is non-linear — "what appears stagnant is often compounding below the surface." This skill reads that trajectory rather than a single snapshot.

The four stages:
1. **Tinkering** — chaos; strategy-hopping, emotional execution, little journalling. Many discipline failure modes firing.
2. **Blade Years** — internal alignment; defined process, fewer impulsive trades, consistency rising. Not yet ready to scale.
3. **Inflection** — breakthrough; clean repeatable execution, high stable discipline, trust the process.
4. **Surging Growth** — elite; multi-window low variance, scalable risk, edge internalised.

This is a pure-composition skill. The deterministic backbone is `compute_microstructure({ operation: 'discipline_trajectory' })`, which runs the discipline audit over N rolling windows and classifies the stage. The skill's job is to gather the two corroborating series (consistency + return dispersion) so the classification reaches high confidence, then frame the guidance.

## Step 1: Run the discipline trajectory

```
compute_microstructure({
  operation: 'discipline_trajectory',
  params: { windowCount: <windows or 4>, windowDays: 7 }
})
```

This returns the discipline-score slope, which failure modes resolved / regressed / persisted across the span, a stage estimate, and a confidence. **Confidence will be low (~0.5) without the corroborating series** — the discipline score alone can't distinguish "high and stable" (Stage 3) from "elite low-variance" (Stage 4). So gather them next.

## Step 2: Gather consistency per window

For each of the N windows (same boundaries the trajectory used — `windowDays` back from now, oldest first), pull the operator's trades for that window and run:

```
compute_indicator({ indicator: 'trade_consistency', ... })   // or the trade-consistency diagnostic
```

Collect the `compositeScore` ([0..1]) for each window into an array, oldest first. This is the "are the trades self-similar enough to improve?" signal — rising consistency is the Blade-Years → Inflection marker.

If there aren't enough trades per window for a consistency verdict (the diagnostic needs ~10 trades), say so and proceed without it — the trajectory still classifies on discipline alone, just at lower confidence.

## Step 3: Gather return dispersion per window

For each window, compute the dispersion of realized returns (stddev of daily or per-trade returns). Use the realized-PnL data from the trade ledger / `tradeEvaluator`, or `compute_microstructure({ operation: 'pnl_distribution_shape' })` per window and read the spread. Collect one dispersion value per window, oldest first.

This is the Stage-4 gate: the article is explicit that elite operation means **"multi-month performance with low variance."** Falling-or-flat dispersion across ≥3 windows is required to call Stage 4 — a single low-variance window doesn't qualify.

## Step 4: Re-run the trajectory with the full evidence

```
compute_microstructure({
  operation: 'discipline_trajectory',
  params: {
    windowCount: <windows or 4>,
    windowDays: 7,
    consistencyScores: [<oldest> ... <newest>],
    returnDispersions: [<oldest> ... <newest>]
  }
})
```

Now the stage classification is grounded in all three signals and confidence rises toward 1.0. The classifier demotes conservatively — a clean discipline snapshot never earns a maturity the trajectory hasn't established.

## Step 5: Deliver the read

Present:
- **Stage + confidence** — "You're at Stage 2 (Blade Years), confidence 0.85."
- **The trajectory** — discipline slope (improving / flat / declining), consistency trend, dispersion trend. This is the "are you compounding?" answer.
- **Resolved vs regressed modes** — which failure modes you've grown out of, and which have come back. Regressed modes are the most actionable: they're discipline you had and lost.
- **What moves you forward** — the `whatMovesYouForward` text for the current stage, verbatim from the article's framing.

Be honest about non-linearity. If the discipline slope is flat but consistency is quietly rising, say the compounding is happening below the surface — that's the article's core point, and the operator stuck in the blade of the curve needs to hear it. Conversely, if discipline is declining from a high base, don't soften it: that's a regression off the curve, not a plateau.

## Step 6: Audit

```
audit_event({
  action: 'OBSERVATION',
  summary: 'trader-stage read: Stage <N> (<name>), discipline <direction>, confidence <c>',
  parameters: { stage, stageName, disciplineDirection, disciplineSlope, latestScore, resolvedModes, regressedModes, windowCount, confidence }
})
```

Do NOT write the stage to working memory or the trader profile — stage is a trajectory read that changes window-over-window, not a durable fact. Recompute it; don't cache it.

## Honest caveats

- **Stage is a coaching frame, not a score to optimise.** The point is to know which discipline to build next, not to grind a number. Don't let the operator treat "reach Stage 4" as a target that invites overtrading to generate windows.
- **Low trade count → low confidence, and that's correct.** Early operators (the ones most likely to ask "what stage am I?") often don't have enough trades for a consistent verdict. The honest answer is "not enough data to place you — keep journalling and ask again in a month." That's Stage 1 guidance regardless.
- **Regressed modes matter more than the stage label.** A Stage 3 operator who just regressed `emotional_trading` after a drawdown is the article's "lapse" — surface it directly.
- Composes with [[exit-review]] (per-session retrospective), [[hindsight-check]] (whether a proposed rule change is legitimate), and the `discipline_audit` op (the point-in-time scorecard this trajectory is built from). Pair with [[weekend-review]] for the regular cadence.
