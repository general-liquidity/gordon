# 20 — `core/alpha` + `core/learning` + `core/regime` + `core/risk-kernel`

Library-adoption spec for the alpha / regime region. This is the **highest-value** region of
the codebase for adoption: it concentrates the hand-rolled linear algebra (matrix inversion,
covariance, shrinkage) and special-function statistics (incomplete-gamma, χ², KS, Lanczos
log-Γ, normal-CDF) that are the most bug-prone numerics Gordon ships.

Read `README.md` first for the governing principles. **Parity column legend:** `exact` (same
algorithm) · `tolerance` (lib differs numerically — re-baseline) · `divergent` (different
method — risky). **Effort:** S / M / L. **Priority:** `HIGH` / `MED` / `LOW` / `SKIP`.

The single most important structural fact: **`core/alpha/matrix.ts` is the shared linalg
substrate.** `portfolio-optimizer.ts`, `pc-method-ensemble.ts`, and `hierarchical-risk-parity.ts`
all import `invert` / `multiplyVector` / `computeCovarianceMatrix` from it. Swapping `matrix.ts`
to a library (`ml-matrix`) is the one change that de-risks the whole portfolio-optimization
surface at once — but it must be re-baselined against all three consumers.

---

## Cluster A — Core linear algebra (`matrix.ts` + its consumers) — HIGH

`matrix.ts` is dependency-free Gauss-Jordan + covariance. `ml-matrix` ships tested
LU/`inverse()`, `Matrix.mul`, `transpose`, and is the canonical TS linalg lib.

| Module (file:line) | Hand-rolled | Candidate lib (API) | Replaces | Parity | Effort | Priority | Notes |
|---|---|---|---|---|---|---|---|
| `alpha/matrix.ts:67` | Matrix inversion, Gauss-Jordan + partial pivoting, singular→null | `ml-matrix` (`inverse(M)` / `solve`) | `invert()` | tolerance | M | **HIGH** | The gnarliest of the linalg primitives; pivoting + singularity handling is exactly where hand-rolled code drifts. ml-matrix returns NaN/throws on singular — wrap to preserve the `null` contract callers rely on for shrinkage fallback. |
| `alpha/matrix.ts:146` | Sample covariance (Bessel-corrected), null-on-bad-input | `ml-matrix` (`Matrix.center` + `Xᵀ·X/(T-1)`) or keep | `computeCovarianceMatrix()` | exact | S | **MED** | Straightforward; lib mainly buys vectorized centering. Keep the null-guards. |
| `alpha/matrix.ts:123` | Ledoit-Wolf-style diagonal shrinkage (simplified, fixed α) | none (no honest LW estimator in TS) | `shrinkToDiagonal()` | exact | S | **LOW** | Trivial blend; not a true Ledoit-Wolf α estimator. No lib gives the *optimal* α in TS — keep, but note as a future econometrics gap if optimal shrinkage is wanted. |
| `alpha/matrix.ts:12,25,46,56` | transpose / multiply / matrix-vector / dot | `ml-matrix` (`transpose`, `mmul`, `mulColumnVector`) | those four | exact | S | **LOW** | Correct + trivial. Churn-only; replace opportunistically *if* matrix.ts already migrates to ml-matrix (free), otherwise skip. |
| `alpha/portfolio-optimizer.ts:178,194,211,234,271` | Markowitz closed-forms (min-var, max-Sharpe, market-neutral, target-return) + long-only active-set projection — all built on `invert`/`multiplyVector` | `ml-matrix` (linalg) under the hood; QP via `quadprog`/`numeric.js` for the constrained leg | the Σ⁻¹ compositions + projection loop | tolerance | M | **HIGH** | Inherits matrix.ts's inversion risk. Closed-forms are fine once `invert` is trusted; the long-only active-set loop (271) is the brittle part — a real QP solver would be more robust but is a behavior change → re-baseline. |
| `alpha/pc-method-ensemble.ts:68,112,153,282` | Simplex projection (Duchi 2008), risk-parity fixed-point, max-diversification (Σ⁻¹σ), adversarial diversifier (projected gradient) | `ml-matrix` (linalg) + `numeric.js`/QP for projection | the iterative allocators | divergent | L | **MED** | Iterative optimizers — a library swap changes the convergence path, so parity is `divergent`, not `tolerance`. High re-validation cost; only the `invert`-based `maxDiversification` (153) rides the matrix.ts migration cheaply. |
| `alpha/hierarchical-risk-parity.ts:118,202,269` | HRP: single-linkage agglomerative clustering, quasi-diagonalization (seriation), recursive bisection | `ml-hclust` (`agnes`, single linkage → dendrogram) for stage 1 | `singleLinkage()` + dendrogram leaf order | tolerance | M | **HIGH** | **The single biggest clustering win.** Hand-rolled O(n²) single-linkage with a manual active-cluster map is exactly the kind of index-bookkeeping code that breaks. `ml-hclust`'s `agnes(dist,{method:'single'})` gives a tested dendrogram; derive `quasiDiagonalize` leaf order from its tree. Recursive bisection (269) stays hand-rolled (HRP-specific). Tie-ordering may differ → re-baseline seriation. |

---

## Cluster B — Distribution & special-function statistics — HIGH

This is the highest bug-surface-per-line in the whole codebase: Numerical-Recipes special
functions and A&S polynomial approximations, hand-transcribed. `@stdlib/math` (`gammaln`,
`gammainc`, `erf`, `erfinv`) and `jStat` (`chisquare.cdf`, `normal.cdf/inv`, `studentt.cdf`)
are battle-tested replacements.

| Module (file:line) | Hand-rolled | Candidate lib (API) | Replaces | Parity | Effort | Priority | Notes |
|---|---|---|---|---|---|---|---|
| `alpha/conditional-distribution-test.ts:35` | Lanczos log-Γ (6-coeff series) | `@stdlib/math/base/special/gammaln` · `jStat.gammaln` | `gammaln()` | exact | S | **HIGH** | Textbook Lanczos; a tested drop-in eliminates a transcription-error class. |
| `alpha/conditional-distribution-test.ts:52` | Regularized lower incomplete-Γ P(a,x): series + continued-fraction (Numerical Recipes `gammp`) | `@stdlib/math/base/special/gammainc(x,a)` · `jStat.lowRegGamma` | `gammaP()` | tolerance | S | **HIGH** | The single gnarliest function in the region — dual series/CF branch with FPMIN underflow guards. A tested lib removes the worst hand-maintained numeric. |
| `alpha/conditional-distribution-test.ts:90` | χ² survival 1−P(df/2, x/2) | `jStat.chisquare.cdf` (1−cdf) · derive from `@stdlib gammainc` | `chiSquareSf()` | tolerance | S | **HIGH** | Falls out of the incomplete-Γ swap; do them together. |
| `alpha/conditional-distribution-test.ts:99` | KS asymptotic p-value Σ(−1)^{j−1}e^{−2j²γ²} | `@stdlib/stats` KS test · keep | `ksPValue()` | exact | S | **MED** | Series is small and stable; lower bug-risk than the Γ functions. Replace for consistency, not urgency. |
| `alpha/marketMemory.ts:262` | Normal CDF, A&S 7.1.26 polynomial | `jStat.normal.cdf(z,0,1)` · `@stdlib/stats/base/dists/normal/cdf` | `normalCdf()` | tolerance | S | **HIGH** | Identical 5-term A&S poly duplicated across files (see next two rows) — consolidate to one lib call. ~7.5e-8 error today; lib is exact to double. |
| `alpha/calendar-effect.ts:184` | Normal CDF, A&S 26.2.17 (same poly, different file) | same as above | `normalCdf()` | tolerance | S | **HIGH** | Duplicate of marketMemory's CDF. De-dup risk: the two share magic constants — a single lib call removes the drift hazard. |
| `learning/lever-attribution.ts` → `indicators/linearRegression.ts` | Student-t two-sided p-value (`studentTTwoSidedPValue`) — incomplete-beta under the hood | `jStat.studentt.cdf(t,df)` · `@stdlib` t-dist | the t-CDF | tolerance | S | **HIGH** | **Cross-region:** the function lives in `core/indicators/linearRegression.ts` (covered by `10-indicators.md`) but is consumed here by lever-attribution's Welch test. Flag both docs; swap once. |
| `alpha/strategy-claim-verifier.ts:175,189` | Skewness (3rd moment), excess kurtosis (4th moment) | `@stdlib/stats` (`skewness`,`kurtosis`) · `simple-statistics` (`sampleSkewness`) | those two | tolerance | S | **MED** | Watch the population-vs-sample / bias-correction convention — pick the lib variant that matches current output, then re-baseline. |
| `alpha/distribution-drift.ts:63` | Population Stability Index (bin-divergence) | none (PSI is bespoke) | `psi()` | exact | S | **LOW** | No standard lib; the only library leverage is the quantile binning (→ `simple-statistics`). Keep. |

---

## Cluster C — Correlation / regression / descriptive stats — MED

Heavily duplicated Pearson + sample-std + OLS, scattered as inline copies. `simple-statistics`
(`sampleCorrelation`, `linearRegression`, `sampleStandardDeviation`, `quantile`) collapses the
duplication. Value is **de-duplication**, not gnarliness — hence MED.

| Module (file:line) | Hand-rolled | Candidate lib (API) | Replaces | Parity | Effort | Priority | Notes |
|---|---|---|---|---|---|---|---|
| `alpha/helpers.ts:18,84,98,116` | Pearson, Spearman (+ tie-averaged ranks), sample-std, OLS trend-slope | `simple-statistics` (`sampleCorrelation`, `linearRegression`, `sampleStandardDeviation`) | the shared stat helpers | exact | S | **MED** | `helpers.ts` is the canonical home; everything below is a duplicate of these. Migrate here first, then point the inline copies at it (or delete them). |
| `alpha/codependence.ts:44` | Inline Pearson copy | `simple-statistics` (`sampleCorrelation`) | local `pearson()` | exact | S | **MED** | Duplicate of helpers. MI (78) + distance-correlation (146) below are NOT replaceable. |
| `alpha/correlationBreakdown.ts:113,138,153` | Inline Pearson + rolling Pearson + std | `simple-statistics` | local copies | exact | S | **MED** | Pure duplication. |
| `alpha/vol-residual-correlation.ts:55,81` | Inline Pearson + OLS residualization | `simple-statistics` (`linearRegression` for residuals) | local copies | exact | S | **MED** | Same OLS-residual pattern as crypto-factor-model. |
| `alpha/crypto-factor-model.ts:92,107` | Cross-sectional z-score + OLS residualization | `simple-statistics` (`linearRegression`, `zScore`) | inline math | exact | S | **MED** | |
| `alpha/asymmetric-beta.ts:25` | Multi-linear OLS (up/down beta split) via Xᵀ X inversion | `ml-matrix` (normal equations) or `simple-statistics` for the 1-var legs | the regression solve | tolerance | M | **MED** | Rides the matrix.ts migration if kept in normal-equations form. |
| `alpha/formulaic-alpha-operators.ts:93,315,436` | Cross-sectional rank, rolling sample-std, inline Pearson | `simple-statistics` (`quantileRank`, `sampleStandardDeviation`, `sampleCorrelation`) | those ops | exact | M | **LOW** | These are Alpha-101 operator primitives — heavily tested by `formulaic-alphas.test.ts`; churn risk on a working operator set. Low priority despite being replaceable. |
| `alpha/{walk-forward-ic,cross-sectional-momentum,ibs-cross-sectional,robustness-metrics,quantileLeverage}.ts` | Median / quantile (linear-interp) / mean / std, scattered | `simple-statistics` (`median`, `quantile`, `mean`, `sampleStandardDeviation`) | inline helpers | tolerance | S | **LOW** | Quantile convention differs (type-7 vs lib default) — re-baseline if swapped. Low value; trivial code. |
| `alpha/{ic-tracker,ir-diagnostic,marginal-contribution,cross-sectional-contrarian,crossSectionalOrderFlow}.ts` | IC std-error (Fisher 1/√(n−2)), variance, mean/std | `simple-statistics` / `@stdlib/stats` | inline helpers | exact | S | **LOW** | Mostly delegate to `helpers.ts` already; clean these up *after* helpers migrates. |
| `learning/lever-attribution.ts:95,107` | Welch's unequal-variance t-test (mean/var/df) | `simple-statistics` for moments; t-CDF via row in Cluster B | `welchT()` moments | exact | S | **LOW** | The moments are trivial; the only real risk is the t-CDF (Cluster B). |

---

## Cluster D — Monte Carlo / RNG — MED

| Module (file:line) | Hand-rolled | Candidate lib (API) | Replaces | Parity | Effort | Priority | Notes |
|---|---|---|---|---|---|---|---|
| `alpha/monteCarloPath.ts:83` | Box-Muller gaussian + GBM/Markov path sim | `@stdlib/random/base/improved-ziggurat` (normals) | `gaussian()` | divergent | M | **MED** | Library normals improve tail fidelity but **change the RNG stream** → every seeded test re-baselines. The path-sim + transition-matrix logic stays. Keep the `rng` injection seam. |
| `alpha/ruinProbability.ts:64,85` | Seeded LCG + Monte Carlo ruin sim | `@stdlib/random` (seeded PRNG) | `makeRng()` + sim | divergent | M | **LOW** | LCG is reproducible-by-design and the test fixtures depend on it. Swapping the PRNG is a stream change for marginal benefit. Keep. |
| `alpha/syntheticAugmentation.ts:53` | Seeded LCG + MCPT permutation + stress injectors | `@stdlib/random` (PRNG only) | `makeRng()` | divergent | M | **SKIP** | Same LCG-reproducibility argument; the augmentation logic is domain-specific (bar reshaping, pathology injection). No library leverage worth the re-baseline. |

---

## SKIP — econometrics & specialist methods (no good TS lib)

These stay hand-rolled (or go polyglot via WASM/sidecar later). Naming them per principle 5.

| Module (file:line) | Method | Why SKIP |
|---|---|---|
| `alpha/hmmRegime.ts` (whole file) | Gaussian-emission HMM — Baum-Welch EM + Viterbi + log-space forward/backward | No maintained TS HMM lib at this fidelity (multi-restart, logSumExp stability). Econometrics gap. |
| `alpha/garch.ts` (whole file) | GARCH(1,1) MLE — coarse grid + Nelder-Mead | No TS GARCH lib. Constrained MLE (α+β<1). Econometrics gap. |
| `alpha/regime-policy.ts` | Regime-conditioned policy / HMM-RL allocation | Builds on the HMM gap; no lib. |
| `alpha/codependence.ts:78,146` | Mutual information (2D histogram), distance correlation (Székely) | No TS lib for either non-linear dependence measure. Keep. |
| `alpha/fat-tail-credibility.ts:136` | Hill tail-index estimator (Taleb log-excess) | No TS heavy-tail lib. Specialist. Keep. |
| `alpha/omega-ratio.ts:45` | Omega ratio (Keating & Shadwick) | Bespoke full-distribution metric; no lib. Trivial to keep. |
| `alpha/distribution-drift.ts:63` | PSI | Bespoke (also listed Cluster B-LOW). Keep. |
| `alpha/kellySize.ts:75`, `ruinProbability.ts:105` | Kelly / expected-log closed forms | Closed-form one-liners; library wrap adds nothing. Keep. |
| `alpha/effective-n.ts`, `portfolioCombine.ts` | Carhart effective-N, geometric/arithmetic mean, rebalance sim | Domain formulas / trivial. Keep. |
| `regime/correlation.ts` (risk-kernel) | Static correlation-group heuristic | Not real correlation math — group-membership lookup. Keep. |
| `learning/*` (insight-store, counterfactual-analyzer, feedback-loop, inaction-value) | SQLite persistence + attribution scoring | No numerics worth a lib. Keep. |
| `risk-kernel/kernel.ts` | Position-sizing arithmetic | No statistical/linalg math. Keep. |

### Cross-doc / shared-with-`10-indicators.md`

- `regime/indicators.ts` (RSI / ATR / ADX / MACD / EMA / Bollinger, Wilder smoothing) — classic
  TA indicators, tested and working. **LOW / churn** per principle 3, and they belong to the
  indicators cluster (`10-indicators.md`); listed here only for completeness. No lib swap.
- `core/indicators/linearRegression.ts` `studentTTwoSidedPValue` — owned by `10-indicators.md`,
  consumed by `learning/lever-attribution.ts` (Cluster B). Swap once, flag both docs.

---

## Priority counts

| Priority | Count | Items |
|---|---:|---|
| **HIGH** | 9 | matrix invert · portfolio-optimizer closed-forms · HRP single-linkage clustering · gammaln · incomplete-Γ P(a,x) · χ² SF · normal-CDF (marketMemory) · normal-CDF (calendar-effect) · Student-t p-value (cross-region) |
| **MED** | 12 | covariance · pc-method allocators · KS p-value · skew/kurtosis · helpers Pearson/Spearman/std/OLS · codependence Pearson · correlationBreakdown · vol-residual-correlation · crypto-factor-model · asymmetric-beta OLS · monteCarloPath gaussian |
| **LOW** | 11 | shrinkage · transpose/multiply/dot · ruinProbability sim · PSI · formulaic-alpha operators · scattered median/quantile/mean · ic/ir/marginal-contribution helpers · lever-attribution moments · (regime/indicators TA, cross-doc) |
| **SKIP** | 13 | HMM · GARCH · regime-policy · mutual-information · distance-correlation · Hill estimator · omega-ratio · kelly/expected-log · effective-N/portfolioCombine · syntheticAugmentation RNG · regime/correlation heuristic · learning/* · risk-kernel/kernel |

## The single biggest win

**Migrate `core/alpha/matrix.ts` to `ml-matrix`** — specifically the **Gauss-Jordan `invert()`**
(`matrix.ts:67`). It is the gnarliest hand-rolled numeric in the region (partial pivoting +
singularity tolerance), and it is the shared substrate under `portfolio-optimizer.ts`,
`pc-method-ensemble.ts`, and `hierarchical-risk-parity.ts`. One tested-library swap de-risks the
entire portfolio-optimization surface in a single re-baseline pass, while leaving the
trading-domain logic untouched. Pair it with the HRP single-linkage swap (`ml-hclust`) and the
incomplete-Γ / normal-CDF special-function swaps (`@stdlib/math` + `jStat`) to clear the three
worst bug-surface clusters together.
