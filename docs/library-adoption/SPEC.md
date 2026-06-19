# Quant Library Adoption — Master Spec (synthesis)

Synthesis of `00-CATALOG.md` + the four region specs (`10`–`40`). The plan for adopting mature
TS/JS quant libraries across Gordon's hand-rolled stack — **post-competition, parity-disciplined.**

## Headline verdict
Gordon ships **zero** quant libraries today — every numeric is hand-rolled. Across ~230 surveyed
opportunities the value is **concentrated, not wholesale**:

| Priority | ~Count | Meaning |
|---|---|---|
| **HIGH** | ~27 (12%) | gnarly transcendentals + the linalg substrate — real bug-surface reduction |
| **MED** | ~45 | de-duplicating stddev/mean/RNG/metrics onto one primitive |
| **LOW** | ~64 | working+tested classic code — churn, leave alone |
| **SKIP** | ~93 | econometrics (no TS lib) + proprietary detectors (no lib) |

**So ~88% is churn-or-no-lib. The whole payoff lives in ~12%** — and it clusters into three swaps.

## The three wins that matter (do these, skip the rest for now)

### WIN #1 — one shared `@stdlib`-backed special-functions module *(highest leverage in the codebase)*
The standard-normal CDF / `erf` is hand-transcribed **~10+ times** with per-copy magic constants:
- trading-infra (6): `blackScholesGreeks`, `twoSampleTest`, `riskModelValidation`, `jensensAlpha`, `optimizationQuality`, `marketEfficiency`
- indicators: `vpin.ts` · alpha: `marketMemory.ts`, `calendar-effect.ts`, `conditional-distribution-test.ts`
- plus the special-function family: `gammaln` (Lanczos), incomplete-beta, **Student-t CDF**, chi-square p-value (`linearRegression.ts`, `conditional-distribution-test.ts`, `markov-regime.ts`)

It sits under **the entire option-pricing surface** (BS price + 10 Greeks + IV + dealer GEX) **and every hypothesis-test p-value** in the codebase. Highest bug-surface-per-line.
→ **Create `src/core/numerics/` backed by `@stdlib/*`** (normal CDF/PPF, erf, gammaln, incomplete-beta, t/χ²) and migrate every copy onto it. Re-baseline each golden with tolerance.

### WIN #2 — `core/alpha/matrix.ts` → `ml-matrix`
`matrix.ts` (`invert` = hand-rolled Gauss-Jordan, covariance, shrinkage) is the shared substrate under
`portfolio-optimizer`, `pc-method-ensemble`, HRP, + 4 quant importers. AND the **cyclic-Jacobi EVD is
duplicated 5×** (`eigenPortfolio`, `pcaConcentration`, `pcaPairClustering`, `nearestCorrelationMatrix`,
`johansenCointegration`) + a local Gauss-Jordan in `multiInstrumentHedgeRatio`.
→ **One `ml-matrix` migration** (`inverse`, `EigenvalueDecomposition`, `SVD`, `CholeskyDecomposition`)
de-risks the entire portfolio-optimization + eigen surface. `ml-matrix` is the only JS lib with all of
SVD+QR+eigen+Cholesky+LU (mathjs has no SVD/Cholesky).

### WIN #3 — one `simple-statistics` primitives module (metric de-dup)
The metrics are re-implemented all over: **4× Sharpe, 4× mean/std, 3× max-drawdown, 2× percentile** —
and the two percentile copies **diverge** (floor-index vs interpolated = a latent correctness bug).
The **Sharpe is the judged competition metric.**
→ **Collapse onto one `simple-statistics`-backed primitives module** (mean/std/quantile/skew/kurtosis/
OLS). Pick ONE correct percentile definition. Golden-test against the judged Sharpe.

## Secondary (MED — do after the three wins)
- **PRNG → `@stdlib/random` MT19937** for trustworthy reproducible Monte Carlo (replaces 5+ shared
  LCG/Mulberry32/Box-Muller copies). Cost: re-baselines every seeded fixture — schedule deliberately.
- **HRP single-linkage → `ml-hclust`** (Ward) · **PCA → `ml-pca`** · bias-corrected skew/kurt → `simple-statistics`.

## Do NOT adopt (LOW / SKIP)
- **Classic indicators** (RSI/MACD/ATR/Bollinger/…) → `trading-signals` exists but they're working +
  tested → **pure churn + re-baseline risk.** Leave them. (~33 LOW in indicators alone.)
- **Econometrics — the scipy gap, no mature TS lib:** ADF, KPSS, Johansen, Granger, GARCH, HMM
  (Baum-Welch/Viterbi), OU/AR(1), Hurst, ACF/PACF, MESA/Burg, Hilbert, Kalman×4, TLS. Keep hand-rolled,
  or evaluate **polyglot (WASM/pyodide/Python sidecar)** much later. Lone TS exceptions: `kalman-filter`
  (piercus), thin WASM `arima`.
- **Proprietary detectors** (SMC/ICT/order-blocks/LMW/wavetrend/delta-ladder/CryptoCred patterns) — no
  library equivalent, by definition. SKIP.
- **Dataframe libs** — `danfojs` rejected (TF.js native dep, too heavy for a CLI); `data-forge` only if a
  real data-wrangling need emerges. Not needed now.

## The dependency set (tight, granular)
`@stdlib/*` sub-packages (NOT the monorepo) · `ml-matrix` · `ml-pca` · `ml-hclust` · `ml-distance` ·
`simple-statistics`. Optional later: `fmin` / `ml-levenberg-marquardt`, `@uqee/black-scholes`.
**Avoid:** `danfojs`, `mathjs` (no SVD/Cholesky — doesn't cover the need).

## The parity discipline (non-negotiable — same as the TS→Python port, reversed)
Gordon hand-rolls everything, so a library's numerics **will differ** in the last digits (different
algorithms). Every swap is therefore:
1. Add the lib behind the existing function signature.
2. Capture a golden from the **current** output.
3. Assert the lib's output matches within **tolerance** (`tolerance`, not byte-exact).
4. Where the hand-rolled version was *wrong* (e.g. the divergent percentile, low-quality LCG), **adopt
   the lib as the new reference** and re-baseline deliberately — don't preserve a bug for parity.
Nothing merges until its golden re-baseline is green + `tsc` clean.

## Sequenced plan
- **Phase 1 (the payoff):** `core/numerics/` (`@stdlib`) — migrate the ~10 erf/Φ + special-fn copies → `core/alpha/matrix.ts` → `ml-matrix`. *These two clear the worst bug-surface.*
- **Phase 2 (consolidation):** `simple-statistics` primitives module + metric de-dup; `@stdlib/random` MT19937; HRP/PCA via ml.js.
- **Phase 3 (optional):** classic indicators → `trading-signals` *only* if a maintenance reason appears.
- **Never (unless polyglot):** econometrics, proprietary detectors.

> Bottom line: the honest win is **three consolidations** (`@stdlib` special functions, `ml-matrix`
> linalg, `simple-statistics` metrics) that collapse ~10–15 duplicated, bug-prone numeric
> re-implementations onto tested libraries. The other ~88% is either working code (don't touch) or has
> no TS library (can't touch). Adopt narrow and deep, not wide.
