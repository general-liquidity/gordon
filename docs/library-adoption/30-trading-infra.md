# 30 — `infra/trading/{quant,risk,execution}`

Library-adoption spec for the trading-infra region — the **largest** region by file count
(`quant/` alone is ~100 non-test modules; `risk/` and `execution/` are small). Read
`README.md` first for the governing principles. **Parity legend:** `exact` (same algorithm) ·
`tolerance` (lib differs numerically — re-baseline) · `divergent` (different method — risky).
**Effort:** S / M / L. **Priority:** `HIGH` / `MED` / `LOW` / `SKIP`.

Two structural facts shape this region:

1. **The headline win is the duplicated normal-CDF / erf family.** The standard-normal CDF and
   the error function are hand-transcribed **at least six times** across `quant/`, in two
   variants of the same Abramowitz-&-Stegun polynomial (26.2.17 and 7.1.26). Every copy carries
   its own magic constants. Consolidating these onto one tested `@stdlib` call removes the single
   biggest bug-surface in the region — see **Cluster A**.

2. **The shared linalg substrate is `core/alpha/matrix.ts`** (covered by `20-alpha-regime.md`).
   Several quant modules import `invert` / `multiply` / `computeCovarianceMatrix` from it; a few
   others **re-hand-roll their own** Gauss-Jordan inverse or cyclic-Jacobi eigendecomposition
   locally. The `ml-matrix` migration of `matrix.ts` (the `20-doc` biggest win) carries the
   former for free; the latter are local duplicates that should fold into the same swap — see
   **Cluster B**.

The econometrics core of `quant/` — ADF, KPSS, Johansen, Granger, OU/AR(1), GARCH (imported from
`core/alpha`), HMM/Markov, Hurst, ACF/PACF, MESA/Burg spectral, Hilbert — is the **scipy/statsmodels
gap**: no mature TS lib exists, so it stays hand-rolled. That's the bulk of the SKIP table.

---

## Cluster A — Normal-CDF / erf family (the duplicated special-function win) — HIGH

The standard-normal CDF `N(·)` and `erf(·)` are hand-rolled across the region in two A&S variants.
`@stdlib/stats/base/dists/normal/cdf` (+ `@stdlib/math/base/special/erf`) is the tested drop-in.
Worst-case A&S error is ~7.5e-8 (26.2.17) / ~1.5e-7 (7.1.26); the lib is exact to double. The value
is **de-duplication + bug-surface**: one tested call replaces six magic-constant transcriptions.

| Module (file:line) | Hand-rolled | Candidate lib (API) | Replaces | Parity | Effort | Priority | Notes |
|---|---|---|---|---|---|---|---|
| `quant/blackScholesGreeks.ts:122,133` | φ(x) PDF + `normalCDF` via A&S 26.2.17 (b1..b5, p=0.2316419); used by full BSM price + 10 Greeks + IV inversion | `@stdlib` normal `cdf`/`pdf` (or `erf`) | `normalPDF` + `normalCDF` | tolerance | S | **HIGH** | **The canonical option-pricing copy.** `dealerGreeksExposure.ts` correctly delegates here (no duplicate) — so swapping this one fixes the whole Greeks/IV/GEX surface. IV Newton/bisection solver stays. Re-baseline Hull-example golden tests (4-dp). |
| `quant/twoSampleTest.ts:108` | `erf` via A&S 7.1.26 (0.3275911) → normal two-sided p-value | `@stdlib` `erf` / normal `cdf` | local `erf` + `normalTwoSidedPValue` | tolerance | S | **HIGH** | Drives the Welch-t and Mann-Whitney-z p-values. Also imports cross-region `studentTTwoSidedPValue` (see Cluster A-note). |
| `quant/riskModelValidation.ts:25,34,36` | `erf` (7.1.26) → `normalCdf` → `chiSquareSF(df=1,2)` for Kupiec POF + Christoffersen VaR-backtest p-values | `@stdlib` `erf`/normal `cdf`; χ² via `@stdlib` chi2 `cdf` | `erf`+`normalCdf`+`chiSquareSF` | tolerance | S | **HIGH** | The χ² survival is the df=1/df=2 closed form riding on the same hand-rolled `normalCdf`. Swap erf + use `@stdlib` chi2 sf so the VaR-backtest p-values stop sharing magic constants. |
| `quant/jensensAlpha.ts:26,35,37` | `erf` (7.1.26) → `normalCdf` → HAC-asymptotic two-sided t p-value | `@stdlib` `erf` / normal `cdf` | `erf`+`normalCdf`+`twoSidedP` | tolerance | S | **HIGH** | Jensen-α significance after Newey-West. Also imports `invert`/`multiply` from `core/alpha/matrix.ts` (Cluster B). |
| `quant/optimizationQuality.ts:114,128` | `erf` (7.1.26) → `normalCdf` for Jobson-Korkie / Lo Sharpe-difference p-value | `@stdlib` `erf` / normal `cdf` | `erf`+`normalCdf` | tolerance | S | **HIGH** | Same A&S 7.1.26 copy. Sharpe-SE moment math (skew/kurt) stays hand-rolled or → `simple-statistics`. |
| `quant/marketEfficiency.ts:69` | `normalCDF` via A&S (0.3275911 family) — variance-ratio test z→p | `@stdlib` normal `cdf` | `normalCDF` | tolerance | S | **HIGH** | Lo-MacKinlay variance-ratio p-value. |
| `quant/grangerCausality.ts:169` | normal-CDF tail (0.2316419) inside the F→p **normal approximation** for df>5 | `@stdlib` normal `cdf`; ideally `@stdlib` F-dist `cdf` for the exact p | the normal-approx tail | tolerance | S | **MED** | The F p-value is itself an approximation (normal for df>5) — swapping to a real F-distribution CDF is an accuracy *upgrade* (divergent for small df), so do the erf swap now, flag the exact-F as an optional follow-up. |
| `quant/barrierTradingThresholds.ts:81,85` | normal survival function via A&S 7.1.26 (0.3275911) | `@stdlib` normal `cdf` (1−cdf) | the SF helper | tolerance | S | **MED** | Tested by `barrierTradingThresholds.test.ts`; re-baseline barrier-probability goldens. |

**Cluster A note (cross-region):** `core/indicators/linearRegression.ts` `studentTTwoSidedPValue`
(incomplete-beta t-CDF) is owned by `10-indicators.md` and consumed here by `twoSampleTest.ts`.
Swap once, flag both docs. `core/alpha/conditional-distribution-test.ts` owns the gammaln/incomplete-Γ
swap (`20-doc`); the χ² SF in `riskModelValidation.ts` above is an independent, simpler copy.

---

## Cluster B — Linear algebra: shared substrate + local duplicates — HIGH/MED

`core/alpha/matrix.ts` is the canonical linalg home (its `ml-matrix` migration is the `20-doc`
biggest win). The rows below are quant modules that either (i) **import** that substrate (ride the
swap for free) or (ii) **re-hand-roll** Gauss-Jordan inverse / cyclic-Jacobi EVD / Cholesky
locally — duplicates that should fold into the `ml-matrix` adoption.

| Module (file:line) | Hand-rolled | Candidate lib (API) | Replaces | Parity | Effort | Priority | Notes |
|---|---|---|---|---|---|---|---|
| `quant/{adfOptimalHedgeRatio,boxTiaoHedgeRatio,generalizedImpulse,jensensAlpha}.ts` | OLS / VAR / VECM solves built on imported `invert`/`multiply`/`computeCovarianceMatrix` | `ml-matrix` (via the `matrix.ts` migration) | the `Σ⁻¹`/normal-equation compositions | tolerance | S | **MED** | **Ride the `20-doc` `matrix.ts`→`ml-matrix` swap for free** — no local change beyond re-baselining outputs. The econometric wrapper (ADF/Box-Tiao/Pesaran-Shin) stays hand-rolled. |
| `quant/multiInstrumentHedgeRatio.ts:159` | **Local** Gauss-Jordan inverse with partial pivoting (K≤30), singular→null + inline covariance | `ml-matrix` (`inverse`/`solve`) | local `invertMatrix` | tolerance | M | **HIGH** | A second copy of `matrix.ts:67`'s gnarliest numeric, hand-rolled locally instead of imported. Migrate to the same `ml-matrix` call and preserve the `null`-on-singular contract. The biggest standalone linalg dup in the region. |
| `quant/eigenPortfolio.ts:103` | **Local** cyclic-Jacobi symmetric EVD (eigenvalues desc + eigenvectors) | `ml-matrix` (`EigenvalueDecomposition`, symmetric) | `jacobiEigen` | tolerance | M | **HIGH** | **Cyclic-Jacobi EVD is hand-rolled five times** across the region (this + the next three rows + `johansenCointegration`). One tested `ml-matrix` EVD replaces all of them — the single biggest *clustering/eigen* consolidation here. Eigen-ordering/sign conventions differ → re-baseline. |
| `quant/pcaConcentration.ts:117` | Cyclic-Jacobi EVD + covariance→correlation | `ml-matrix` `EigenvalueDecomposition` (+ `simple-statistics` corr) | `jacobiEigen` | tolerance | M | **HIGH** | Same Jacobi copy; eigenvalue concentration / participation-ratio logic stays. |
| `quant/pcaPairClustering.ts:160` | Cyclic-Jacobi EVD + z-score + correlation; **DBSCAN** clustering | `ml-matrix` EVD; `density-clustering` for DBSCAN (optional) | `jacobiEigen` (+ DBSCAN) | tolerance / divergent | M | **MED** | EVD rides the swap. DBSCAN is a separate iterative method — a lib changes the cluster path (`divergent`); lower value, keep unless it drifts. |
| `quant/nearestCorrelationMatrix.ts:160` | Cyclic-Jacobi EVD inside Higham (2002) alternating-projections / Dykstra | `ml-matrix` `EigenvalueDecomposition` for the PSD projection step | `jacobiEigen` | tolerance | M | **MED** | Only the EVD sub-step is replaceable; the Higham/Dykstra projection loop is bespoke (no TS lib). Do the EVD swap with the others. |
| `quant/johansenCointegration.ts:198` (multivariate) | Cholesky + cyclic-Jacobi generalized-EVD inside the k-series Johansen | `ml-matrix` (`CholeskyDecomposition` + `EigenvalueDecomposition`) | the linalg sub-steps | tolerance | M | **MED** | The linalg ride-along is cheap; **the Johansen procedure itself (residualization, trace stat, MacKinnon-Haug-Michelis critical-value tables) stays — econometrics gap.** See SKIP. |
| `quant/generalizedVariance.ts:52` | **Local** Cholesky for log-determinant of the correlation matrix | `ml-matrix` (`CholeskyDecomposition`, `.logDeterminant`) | local Cholesky | exact | S | **MED** | Standard algorithm; lib mainly removes a hand-maintained decomposition. |
| `quant/tlsHedgeRatio.ts:66` | Total-least-squares (Deming) closed form, errors-in-variables | none (no TS TLS) | `demingRegression` | divergent | S | **SKIP** | `simple-statistics` has OLS only; TLS is bespoke. Keep. |
| `quant/{kalmanHedgeRatio,kalmanFilter,kalmanBeta,kalmanVolatility}.ts` | Scalar / 2×2 Kalman recursions (gain, state, covariance updates) | none (no maintained TS Kalman at this fidelity) | the recursions | exact | — | **SKIP** | Standard but domain-specific (time-varying H, log-variance + χ² bias correction). 2×2 doesn't justify `ml-matrix`. Keep. |
| `quant/{minHalfLifeHedgeRatio,boxTiaoHedgeRatio}.ts` | AR(1) half-life via grid + golden-section; inverse power iteration (Box-Tiao smallest eigenvector) | none (custom optimization) | the search loops | divergent | — | **SKIP** | Bespoke optimization over a domain objective; no lib. Keep. |

---

## Cluster C — Descriptive stats (skew / kurtosis / Pearson / std) — MED/LOW

De-duplication value, not gnarliness. `simple-statistics` (`sampleSkewness`, `sampleKurtosis`,
`sampleCorrelation`, `sampleStandardDeviation`, `quantile`) collapses the inline copies. Watch the
sample-vs-population / bias-correction convention — pick the lib variant matching current output,
then re-baseline.

| Module (file:line) | Hand-rolled | Candidate lib (API) | Replaces | Parity | Effort | Priority | Notes |
|---|---|---|---|---|---|---|---|
| `risk/tailRisk.ts:52,62,85,97` | Fisher-Pearson skewness, excess kurtosis (bias-corrected), downside/upside deviation, empirical VaR/CVaR | `simple-statistics` (`sampleSkewness`, `sampleKurtosis`, `sampleStandardDeviation`, `quantile`) | the moment helpers | tolerance | S | **MED** | **The only real stat-lib win in `risk/`.** The bias-corrected kurtosis (n(n+1)/… − 3(n−1)²/…) is exactly the edge-case-prone formula a tested lib de-risks. VaR/CVaR are empirical-quantile + tail-mean (keep, or use `quantile`). Re-baseline the classifier→tailRisk goldens. |
| `quant/optimizationQuality.ts:~100` | Inline skewness + kurtosis for the Sharpe-SE non-normality term | `simple-statistics` (`sampleSkewness`, `sampleKurtosis`) | inline moments | tolerance | S | **LOW** | Pairs with the Cluster-A erf swap in the same file. |
| `risk/correlationLimits.ts:40` | Hand-rolled all-pairs Pearson (manual cov/var) | `simple-statistics` (`sampleCorrelation`) | local `pearson` | exact | S | **LOW** | Correct + fast enough for ~tens of positions; `ml-matrix` correlation matrix only if the universe scales. Churn-tier. |
| `risk/volatilityPositionSizing.ts:49,72` | Annualized vol (√(var·ppy)) + empirical percentile rank | `simple-statistics` (`sampleStandardDeviation`, `quantile`) | inline helpers | tolerance | S | **LOW** | Quantile convention differs (manual vs type-7) — re-baseline if swapped. Trivial code. |
| `quant/{empiricalKelly,loSharpeCorrection,brierScore,tradingConfusionMatrix}.ts` | mean/variance/autocorrelation/MSE, scattered | `simple-statistics` | inline helpers | exact | S | **LOW** | Trivial closed forms; clean up opportunistically. Kelly fraction itself is a one-liner (SKIP). |

---

## Cluster D — Monte Carlo / seeded RNG / bootstrap — LOW (divergent)

Every resampler is driven by a **hand-rolled seeded LCG** (`s = imul(s,1664525)+1013904223`) +
Box-Muller. `@stdlib/random` (mt19937 / minstd, improved-ziggurat normals) is a tested replacement,
**but swapping the PRNG changes the random stream**, so every seeded test re-baselines for marginal
benefit. The LCG is reproducible-by-design and the fixtures depend on it. Priority is LOW/SKIP
despite being technically replaceable — keep the `rng` injection seam.

| Module (file:line) | Hand-rolled | Candidate lib (API) | Replaces | Parity | Effort | Priority | Notes |
|---|---|---|---|---|---|---|---|
| `quant/pathRiskMonteCarlo.ts:30,34` | Seeded LCG + Box-Muller `gauss`; iid / stationary / GARCH-path resamplers + antithetic | `@stdlib/random` (PRNG + ziggurat normals) | `makeRng` + `gauss` | divergent | M | **LOW** | Path-sim + Politis-Romano block + inverse-CDF antithetic logic stays. GARCH leg imports `fitGarch` from `core/alpha/garch.ts` (econometrics gap — `20-doc`). Stream change → re-baseline all seeds. |
| `quant/stationaryBootstrap.ts:89` | Seeded LCG + Politis-Romano geometric-block resample + quantile interp | `@stdlib/random` (PRNG) | `lcg` | divergent | M | **LOW** | Quantile-band logic is exact once RNG matched. |
| `quant/barPermutation.ts:~96` | Seeded LCG + Fisher-Yates shuffle + log-space OHLC permutation | `@stdlib/random` (PRNG) | `lcg` | divergent | M | **LOW** | MCPT permutation generator (`mcpt.ts` orchestrates, no own RNG). Reproducibility-critical. |
| `quant/directionalEdgeTest.ts:~75` | Seeded LCG + sign-flip resample + quantile | `@stdlib/random` (PRNG) | `lcg` | divergent | S | **LOW** | Sign-permutation edge test. |
| `quant/{geneticOptimizer,simulatedAnnealing,iteratedLocalSearch}.ts` | Seeded LCG (+ Box-Muller in GA/SA) for exploration | `@stdlib/random` (PRNG) | `lcg`/`gauss` | divergent | M | **SKIP** | Metaheuristics — RNG drives exploration only; the search logic is domain-specific. No library leverage worth the re-baseline. |

---

## SKIP — econometrics, spectral & specialist methods (no good TS lib)

The scipy/statsmodels gap. These stay hand-rolled (or go polyglot via WASM/sidecar later). Naming
them per principle 5. (Linalg sub-steps that *can* ride `ml-matrix` are noted in Cluster B; the rows
here are the irreducible domain methods.)

| Module (file:line) | Method | Why SKIP |
|---|---|---|
| `quant/stationarityTest.ts` | ADF regression + MacKinnon critical-value interpolation | No TS ADF lib. Econometrics gap. |
| `quant/kpssTest.ts` | KPSS statistic + Newey-West (Bartlett) long-run variance + Schwert lag rule | No TS KPSS lib. Econometrics gap. |
| `quant/johansen.ts` (bivariate), `johansenCointegration.ts` (multivariate) | Johansen trace test: residualization, cross-moment matrices, trace stat, MacKinnon-Haug-Michelis critical-value tables | No TS Johansen lib. The hardcoded CV tables are the irreplaceable part. (Inner Cholesky/EVD → `ml-matrix`, Cluster B.) |
| `quant/cointegration.ts`, `cointegrationMonitor.ts` | Engle-Granger + simplified residual-ADF + rolling monitor | Simplified-by-design (1 lag, no trend); no lib. |
| `quant/grangerCausality.ts` | Granger F-test (restricted/unrestricted AR + F p-value) | No TS lib. (erf tail → Cluster A; exact-F CDF is the optional upgrade.) |
| `quant/{ouParameterFit,ouCalibration}.ts` | AR(1)→OU parameter estimation (θ/μ/σ) | Niche econometrics; no TS lib. Elementary OLS. |
| `quant/ouOptimalThresholds.ts:18,42` | Lanczos Γ (9-coeff) + Bertram first-passage series + golden-section | `@stdlib/math` `gamma` could replace the Lanczos (LOW); Bertram series + the optimal-threshold search are bespoke. Keep. |
| `quant/{markovRegime,marketMakingMarkov}.ts` | Transition-matrix counting / quote-efficiency path probabilities | Elementary counting + Laplace smoothing; no lib needed. |
| `quant/hurstExponent.ts`, `hurstExponent` (ops dir is out of scope) | Rescaled-range (R/S) + log-log regression | No TS Hurst lib. Specialist. Keep. |
| `quant/autocorrelation.ts` | ACF (autocovariance) + Durbin-Levinson PACF | No TS Box-Jenkins lib. Keep. |
| `quant/mesaSpectrum.ts` | Burg AR coefficients + AR power spectrum (MESA) | Burg is algorithmically superior to FFT for short windows; no lib. Keep. |
| `quant/hilbertTransform.ts` | Ehlers 7-tap FIR Hilbert + instantaneous phase (atan2) | Intentional truncation (low-latency, trading timescale); not the FFT Hilbert. Keep. |
| `quant/fisherTransform.ts:79` | Fisher transform (atanh via log) + inverse (tanh) | `@stdlib/math` `atanh`/`tanh` exist but the clamped log form is explicit + dependency-free. LOW/keep. |
| `quant/dampedCycleDecomposition.ts:120,194` | Prony's method + Durand-Kerner complex root-finding + Tikhonov-ridge LS + complex arithmetic | Prony + Durand-Kerner have no TS lib; ridge-LS could ride `ml-matrix` SVD (marginal). Keep. |
| `quant/meanCrossingFrequency.ts` | Zero-crossing count + annualization | Trivial counting. Keep. |
| `quant/{cubeRootKelly,optimalF,empiricalKelly}.ts` (Kelly leg) | Power-law / Terminal-Wealth-Relative / Kelly closed forms | One-liner / grid-search domain formulas; library wrap adds nothing. Keep. |
| `quant/{optimalTradingOracle,scenarioValuation}.ts` | Bellman DP over position states / DCF + Gordon-growth | Domain logic, deterministic; no numerics worth a lib. Keep. |
| `risk/{riskClassifier,venueMevExposure,drawdownOverlay,classifierPortfolio}.ts` | Heuristic risk scoring, venue-tier lookup, vol-target overlay, portfolio context | **Threshold arithmetic + weighted sums, not statistical/linalg numerics.** No erf/CDF anywhere in `risk/`. Nothing to swap. |
| `risk/inventoryAdjustedPrice.ts:127` | Avellaneda-Stoikov reservation price `r = s − qγσ²(T−t)` | Closed-form MM formula; the formula *is* the value. Keep. |
| `execution/{preflight,executionTriage,auctionWindow,internalBatch}.ts` | Order-shape validation, slippage bps, auction-window scheduling, FIFO netting + midpoint clearing | Business logic + datetime + arithmetic. No statistical numerics in the entire `execution/` dir. Nothing to swap. |

---

## Priority counts

| Priority | Count | Items |
|---|---:|---|
| **HIGH** | 8 | blackScholesGreeks normal-CDF · twoSampleTest erf · riskModelValidation erf/χ² · jensensAlpha erf · optimizationQuality erf · marketEfficiency normal-CDF · multiInstrumentHedgeRatio local Gauss-Jordan · eigenPortfolio Jacobi-EVD (+ rides pcaConcentration) |
| **MED** | 11 | grangerCausality erf · barrierTradingThresholds SF · adf/boxTiao/genImpulse/jensens matrix.ts ride-along · pcaConcentration EVD · pcaPairClustering EVD · nearestCorrelationMatrix EVD · johansenCointegration Cholesky/EVD · generalizedVariance Cholesky · tailRisk skew/kurtosis · (correlation-matrix scaling) |
| **LOW** | 9 | optimizationQuality moments · correlationLimits Pearson · volatilityPositionSizing vol/percentile · empiricalKelly/loSharpe/brier/confusion stats · pathRiskMonteCarlo RNG · stationaryBootstrap RNG · barPermutation RNG · directionalEdgeTest RNG · fisherTransform atanh |
| **SKIP** | 24 | ADF · KPSS · Johansen (bi+multi procedure) · Engle-Granger · Granger F-test · OU/AR(1) fit ×2 · OU thresholds (Bertram) · Markov ×2 · Hurst · ACF/PACF · MESA/Burg · Hilbert · Prony/damped-cycle · mean-crossing · TLS hedge · Kalman ×4 · half-life/power-iteration ×2 · GA/SA/ILS RNG · Kelly/optimal-F ×3 · DP oracle/DCF ×2 · risk heuristics ×4 · inventory reservation price · execution dir ×4 |

---

## The single biggest win

**Consolidate the six hand-rolled normal-CDF / erf copies onto one tested `@stdlib` call**
(Cluster A). The standard-normal CDF / error function is transcribed at least six times across
`quant/` — in two variants of the Abramowitz-&-Stegun polynomial, each with its own magic
constants — and it sits under the entire option-pricing surface (Black-Scholes price + 10 Greeks +
IV inversion + dealer GEX, all flowing through `blackScholesGreeks.ts:normalCDF`) plus every
hypothesis-test p-value in the region (Welch-t, Mann-Whitney, Kupiec/Christoffersen VaR-backtests,
Jensen-α, Sharpe-difference, variance-ratio). One `@stdlib/stats/.../normal/cdf` (+ `erf`) swap
removes that whole magic-constant duplication class in a single re-baseline pass, with the highest
bug-surface-per-line in the region. Pair it with the **`ml-matrix` migration of `core/alpha/matrix.ts`
(the `20-doc` headline)**, which carries `quant/`'s imported-substrate solves for free and lets the
**five hand-rolled cyclic-Jacobi EVD copies** (eigenPortfolio · pcaConcentration · pcaPairClustering ·
nearestCorrelationMatrix · johansenCointegration) and the **local Gauss-Jordan inverse**
(`multiInstrumentHedgeRatio.ts`) all fold onto `ml-matrix`'s `EigenvalueDecomposition` / `inverse`.
The econometrics core (ADF/KPSS/Johansen/Granger/OU/GARCH/HMM/Hurst/MESA) stays hand-rolled — the
TS scipy gap — and that's correct, not a deferral.
