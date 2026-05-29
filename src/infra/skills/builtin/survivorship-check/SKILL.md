---
name: survivorship-check
description: "Stress a backtest for survivorship bias before trusting it. When user says /survivorship-check, 'is this backtest survivorship-biased?', 'are these results real?', 'I tested momentum on the top stocks', 'this CAGR looks too good', or has a cross-sectional / universe-selection backtest result — classify the survivorship-bias risk from how the universe was built, apply a return haircut, and run the confirm-before-trusting checklist. Pure composition — no new code."
arguments: [strategy?]
argument-hint: Optional strategy / backtest reference. If omitted, ask how the test universe was constructed.
tags: [review, backtest, bias, validation, risk]
user-invocable: true
status: active
last-reviewed: 2026-05-29
---

Stress a backtest for **survivorship bias** — the bias that "does not announce itself; it quietly improves your results by removing the failures from your data." It's the one major backtest bias Gordon's honest-backtest stack (vsRandom, MCPT, PSR/DSR, walk-forward) doesn't otherwise flag, and it bites *cross-sectional stock/token-selection* strategies hardest — exactly the case crypto makes worse (tokens delist constantly).

Pure-composition skill. The classification runs through `compute_microstructure({ operation: 'survivorship_risk' })`; the skill frames the inputs and the verdict.

## Step 1: Establish how the universe was constructed

This is the whole game. Ask (or infer):
- **Is it cross-sectional?** Does the strategy *select* among many instruments (rank top-N momentum, pick from an index), or trade a *fixed* instrument? Single-instrument and day-trading strategies are **immune** — say so and stop.
- **How was the universe assembled?**
  - `single_symbol` — one instrument → immune.
  - `liquid_broad` — SPY/QQQ or a major-cap proxy → minimally affected.
  - `current_snapshot` — selected from *today's* members across a *historical* window → **biased** (the dangerous default).
  - `point_in_time` — reconstructed historical membership *including* delisted/removed names → survivorship-free.
- **Universe size, window length, asset class** — more names, longer window, and crypto (vs equity) all amplify the bias.

## Step 2: Classify the risk

```
compute_microstructure({
  operation: 'survivorship_risk',
  params: {
    crossSectional: <bool>,
    universeConstruction: '<single_symbol|liquid_broad|current_snapshot|point_in_time>',
    universeSize: <N>,
    windowDays: <days>,
    assetClass: '<crypto|equity|other>'
  }
})
```

Returns `tier` (none/low/medium/high), `returnHaircut` (multiply the reported CAGR by this), `reasons`, and the 3-question `checklist`.

## Step 3: Apply the haircut and re-interpret

Take the backtest's reported CAGR/return and multiply by `returnHaircut` to get a first-order survivorship-adjusted estimate. Then re-judge the strategy on the *adjusted* numbers — the article's whole point is that the psychology changes completely:

> A 46% CAGR with a 41% drawdown looks aggressive-but-attractive. The same strategy survivorship-corrected was 16.4% CAGR with an **83% drawdown** — an account falling to ~$17k from $100k. Most traders abandon that long before recovery.

So: re-rank the strategy against alternatives using the haircut number, and explicitly note that **max-drawdown is understated even more than return** in a survivorship-biased test (the failures that would have blown up the drawdown were removed).

## Step 4: Run the checklist

Walk the three questions the op returns, out loud, for this specific backtest:
1. Would these instruments actually have been in the dataset at the time, or only the survivors?
2. Would I have known in advance which names would survive?
3. Does the test include names that went bankrupt, merged, delisted, or were removed from the index/exchange?

If any answer is "no," state plainly: "this backtest gives a version of history that was never tradable."

## Step 5: Cross-reference and recommend

- Pair with the `too-good-check` diagnostic — a suspiciously high win-rate/CAGR *plus* a current-snapshot cross-sectional universe is a double red flag.
- Recommend the fix the article prescribes: **incubation**. Even if the historical test can't be corrected (no point-in-time data), the strategy must earn trust forward — route it through the genome lifecycle (`candidate → backtesting → paper_trading → live`) and confirm it survives PSR/DSR credibility before any real size. A survivorship-biased backtest is a hypothesis, not evidence.

## Step 6: Audit

```
audit_event({
  action: 'OBSERVATION',
  summary: 'survivorship-check: <tier> risk, haircut ×<h> on <strategy>',
  parameters: { crossSectional, universeConstruction, universeSize, windowDays, assetClass, tier, returnHaircut, adjustedCagr }
})
```

## Honest caveats

- **This is a flag, not a fix.** Gordon has no point-in-time delisting feed, so it can't reconstruct the historical universe. The only true correction is re-running on a point-in-time universe that includes delisted names — surface that as the real remedy, don't let the haircut masquerade as a corrected result.
- **The haircut is first-order.** It spans the article's observed range (~0.36–0.73) but a specific strategy's true bias depends on the actual delisting set. Treat it as "how much to distrust this," not a precise adjustment.
- **Immune cases are genuinely immune** — don't manufacture concern for a single-symbol or SPY/QQQ strategy; say it's not exposed and move on.
- Composes with [[backtest-validate]] (the broader robustness pass), the `too-good-check` diagnostic, and [[genome-evolution]] / the incubation lifecycle (the forward-test remedy).
