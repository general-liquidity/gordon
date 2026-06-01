---
name: pattern-edge
description: Detect a geometric chart pattern on a name and then TEST whether that pattern actually carries an edge before trading it. When user says "is this head-and-shoulders real", "does this pattern mean anything", "check the chart pattern on X", "validate this setup", or wants to know if a chart pattern is informative rather than just pretty.
arguments: [symbol]
tags: [technical-analysis, patterns, validation, lmw, advanced]
user-invocable: true
status: active
last-reviewed: 2026-05-30
---

Detect geometric chart patterns on {symbol} and, crucially, test whether they actually move the return distribution — informativeness, not eyeballing. Based on Lo-Mamaysky-Wang "Foundations of Technical Analysis": a pattern is only worth acting on if conditioning on it changes what happens next.

## Step 1: Detect the patterns
Run `compute_indicator` with `indicator: "lmw_patterns"` on {symbol} (pick a timeframe that matches the horizon you trade — `1d` for swing, `1h` for intraday). This kernel-smooths the price series and matches the classic geometry: head-and-shoulders / inverse, broadening top/bottom, triangle top/bottom, rectangle top/bottom, double top/bottom.

- If no patterns are detected, stop — there's nothing to validate.
- If the detector finds too many or too few, tune `params.bandwidth` (larger = smoother = fewer, larger patterns).
- Note WHICH pattern fired and where it completed (`endIndex`).

## Step 2: Test whether the pattern is informative
A detected pattern is not automatically tradable. Build two return samples and run `compute_microstructure` with `operation: "signal_informativeness"`:
- **conditionalReturns**: the forward returns (e.g. next-day) that followed past completions of THIS pattern type on this name (or a basket). Pull history and collect the post-completion returns.
- **unconditionalReturns**: the baseline forward returns over the same period (all bars, unconditional).

The op runs a decile χ² test and a two-sample Kolmogorov-Smirnov test. Read the verdict:
- `informative: true` (p < 0.05) → conditioning on the pattern genuinely shifts the distribution. Worth weighting in the thesis.
- `informative: false` → no evidence the pattern moves returns here. Treat the chart shape as decoration, not signal.

**Informativeness ≠ profitability.** A pattern can shift the distribution and still not be tradable after costs. This is the weaker, cleaner test — it tells you whether there's information, not whether there's money.

## Step 3: Decide
- Pattern detected AND informative → fold it into the setup as one input (still confirm with regime via `compute_regime` and risk via `compute_risk`). Don't trade on the pattern alone.
- Pattern detected but NOT informative → say so plainly. Don't let a clean-looking chart override a null test.

## Notes
- This skill is about VALIDATION, not blind detection. The whole point of the LMW method is to separate signal from a shape the eye wants to see.
- For portfolio-level construction (not pattern validation), see `compute_microstructure` `operation: "portfolio_ensemble"` — the risk-structured method bench + adversarial diversifier.
