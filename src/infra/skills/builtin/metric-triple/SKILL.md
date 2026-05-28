---
name: metric-triple
description: "Present the full Sharpe / Sortino / Calmar triple with a skew read. When user says /metric-triple, 'is my Sharpe lying?', 'show me the full risk metrics', 'what does my return distribution look like', 'present this strategy to an allocator', or wants more than a headline Sharpe — source the three ratios from a backtest, run the √2 skew interpreter, present all three together with the allocator floors, and never show Sharpe alone. Pure composition — no new code."
arguments: [strategy?]
argument-hint: Optional strategy / backtest reference. If omitted, ask which strategy or backtest result to characterise.
tags: [review, metrics, allocator, risk, distribution]
user-invocable: true
status: active
last-reviewed: 2026-05-29
---

Characterise a strategy's return distribution the way an allocator would — with the **full triple** (Sharpe, Sortino, Calmar) presented together, never a lonely Sharpe. The article's thesis: "presenting only Sharpe signals you either don't know about the others or are hoping the allocator doesn't ask."

This is a pure-composition skill. Gordon already computes all three ratios in `src/backtest/metrics.ts` (`calculateAllMetrics` → `sharpeRatio`, `sortinoRatio`, `calmarRatio`). The skill's job is to source them, run the skew interpreter, and frame the allocator read.

## Step 1: Source the triple

If the operator points at a strategy or asks to characterise a live track record, get the three ratios:

- **From a backtest:** run `backtest` — the result's metrics already carry `sharpeRatio`, `sortinoRatio`, `calmarRatio`.
- **From a live track record:** pull the realized return series and run the same metrics path, or read them off the strategy's recorded performance.
- **From an external tearsheet** (allocator reading someone else's numbers): the operator supplies the three ratios directly — no return series needed. This is exactly the ratios-only case the skew interpreter is built for.

You need at minimum Sharpe + Sortino. Calmar is strongly preferred (it's the third leg) but the skew read works without it.

## Step 2: Run the skew interpreter

```
compute_microstructure({
  operation: 'risk_ratio_triple',
  params: { sharpe: <S>, sortino: <So>, calmar: <C> }
})
```

This returns:
- `skew` — positive / symmetric / negative / indeterminate, via Sortino vs √2×Sharpe
- `divergenceRatio` — Sortino ÷ (√2×Sharpe); >1 underrated, <1 tail-risk
- `tailRiskUnpriced` — true when Sortino is materially below √2×Sharpe
- `underratedBySharpe` — true when Sortino is materially above
- `calmarPassesFloor` / `sortinoPassesFloor` — the allocator floors (Calmar>1.0, Sortino>2.0)

## Step 3: If you have the return series, cross-check the skew exactly

The √2 rule is a heuristic. When the raw returns are available, confirm the skew read against the third moment — Gordon's strategy-claim-verifier computes actual skewness + excess kurtosis and classifies gamma posture (long = positive skew, short = negative-skew fat-left-tail):

```
strategy_claim_verifier diagnostic  (or compute_microstructure pnl_distribution_shape)
```

If the ratio-heuristic and the third-moment skew **disagree**, trust the third moment and say so — the √2 rule is an approximation that the distribution measurement supersedes. A disagreement is itself informative (e.g. fat tails that the variance-based ratios smear).

## Step 4: Deliver the allocator read

Present the **full triple together**, then the distribution characterisation:

```
Sharpe   <S>
Sortino  <So>   (√2×Sharpe expectation: <expectedSortino>)
Calmar   <C>

Distribution: <positive | symmetric | negative> skew.
```

Then the interpretation, matched to the skew:
- **Positive skew** — "Headline Sharpe underrates this. The day-to-day variance is driven by right-skewed winners, not tail risk. Lead with Sortino when you present it."
- **Symmetric** — "Either metric tells the same story; the distribution is roughly Gaussian."
- **Negative skew** — "⚠️ Tail risk is NOT priced into these ratios. Sharpe flatters a vol-selling / short-gamma profile that bleeds rarely but hard. Lead with Calmar and the drawdown; an allocator will ask about the blow-up months."

Then the floors: state plainly whether Calmar clears 1.0 and Sortino clears 2.0 — the emerging-manager-conversation thresholds.

## Step 5: Audit

```
audit_event({
  action: 'OBSERVATION',
  summary: 'metric-triple: Sharpe <S> / Sortino <So> / Calmar <C>, <skew> skew',
  parameters: { sharpe, sortino, calmar, skew, divergenceRatio, tailRiskUnpriced, sortinoPassesFloor, calmarPassesFloor }
})
```

## Honest caveats

- **The √2 rule is a heuristic, not a measurement.** It infers skew from two summary statistics. With the return series in hand, the third-moment skew (strategy-claim-verifier) is exact and wins any disagreement. Use the ratio rule for tearsheet-only situations; use the distribution for your own strategies.
- **Negative skew is the dangerous one.** A great Sharpe with a Sortino well below √2×Sharpe is the classic "looks amazing until the blow-up" profile. Don't let a high Sharpe alone justify size — that's the article's whole point.
- **Floors are conversation-starters, not gates.** Calmar>1 / Sortino>2 are emerging-manager allocator floors, not Gordon risk limits. Don't wire them into the permission engine; they're for characterisation.
- Composes with [[backtest-validate]] (sources the metrics), and the `strategy_claim_verifier` diagnostic (exact skew). Pair with [[memo]] when writing a strategy up for an allocator.
