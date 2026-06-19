# 00 — Quant Library Catalog (TS/JS, web-researched June 2026)

**The authoritative reference the region files (`10`/`20`/`30`/`40`) map against.** Read `README.md`
first for governing principles (post-competition planning, parity mandatory, bug-surface over churn,
dependency budget, name the gaps).

This is a *catalog*, not an adoption order. It answers one question per use-case: **if we were to
adopt a library here, which one, and where is the genuine gap with no good fit?** Picks favor
(a) native TS types, (b) active 2025–26 maintenance, (c) tight dependency tree for a Bun CLI agent,
(d) numeric robustness on the gnarly primitives README §3 prioritizes.

**Today's baseline:** Gordon ships **zero** of these — every numeric is hand-rolled (verified: no quant
lib in `package.json`). So adoption is greenfield, which *lowers* parity risk in one sense (no
migration of a working dep) and *raises* it in another (every swap re-baselines a hand-tuned numeric).

**Method note:** figures from WebSearch + GitHub (stars/commits exact); npmjs.com + the npm
registry/downloads API blocked direct fetch in this environment, so **weekly-download and some
last-publish numbers are order-of-magnitude, search-surfaced, not exact API reads**. Decompositions /
export names / dependency facts were verified against GitHub source and docs.

---

## TL;DR — standardize-on pick per use-case

| # | Use-case | **Standardize on** | Why (one line) | Genuine gap |
|---|---|---|---|---|
| 1 | Linear algebra (SVD/QR/eigen/Cholesky/solve) | **`ml-matrix`** | Only lib with *all* decompositions as clean typed exports; the substrate `core/alpha/matrix.ts` should adopt | — |
| 2 | Stats + distributions (CDF/inverse-CDF, erf) | **`@stdlib/*` sub-packages** (+ `simple-statistics` for descriptive) | Only source with t/χ²/F **quantile** (inverse-CDF) + erf/gammaln, native TS, per-fn install | — |
| 3 | Technical indicators | **`trading-signals`** | Only actively-maintained native-TS TA lib; streaming `update()` fits live agent | (low value — mostly churn) |
| 4 | Time-series econometrics | **— GAP —** (Kalman: `kalman-filter`) | No mature TS ARIMA/GARCH/ADF/Johansen/VAR/HMM; stays hand-rolled | **wide open** |
| 5 | Dataframes / wrangling | **`data-forge`** (interop: `apache-arrow`) | Only lightweight native-TS dataframe; **avoid danfojs** (TF.js native dep) | — |
| 6 | Optimization | **`fmin`** (Nelder-Mead) + **`ml-levenberg-marquardt`** (least-squares) | fmin = derivative-free min; LM = typed curve-fit | L-BFGS/constrained, root-find |
| 7 | Random / Monte Carlo | **`@stdlib/random-*`** (or `d3-random`+`seedrandom`) | Seeded + state save/restore + native types | **bootstrap/resampling** |
| 8 | ML (PCA/regression/clustering) | **ml.js suite** (`ml-pca`/`ml-regression-*`/`ml-kmeans`/`ml-hclust`+`ml-distance`) | HRP fully buildable; same `ml-matrix` substrate | — |
| 9 | Options / Greeks | **`@uqee/black-scholes`** (or hand-roll ~50 lines) | Only modern TS-typed BS+greeks+IV; rest is decade-old untyped | (thin — hand-roll fine) |

**The four genuine gaps:** (4) **econometrics** (ARIMA/GARCH/ADF/cointegration/Johansen/VAR — no
mature TS lib; consistent with Gordon having built Johansen/OU/HMM in-house), (7) **bootstrap/CI
resampling** (hand-roll on `@stdlib/random-sample`), (6) **L-BFGS/constrained optimization with good
types** (`optimization-js` is the only easy JS L-BFGS but is stale+untyped), and the **SVD/Cholesky
hole in the two "obvious" general-math libs** (mathjs + @stdlib high-level linalg) that makes
`ml-matrix` the non-obvious correct linalg pick.

---

## 1 — Numerical / linear algebra (matrices, SVD/QR/eigen/Cholesky, solve)

The single most important pick in this catalog: `core/alpha/matrix.ts` is Gordon's shared linalg
substrate (`portfolio-optimizer`, `pc-method-ensemble`, `hierarchical-risk-parity` all import its
`invert`/`computeCovarianceMatrix`). Adopting one lib here de-risks the whole portfolio stack.

The trap: the two "obvious" general-math libraries **both lack SVD and Cholesky**, the two
decompositions a covariance/shrinkage/PCA stack most needs. That eliminates them as the linalg
foundation and makes `ml-matrix` the correct (if less famous) pick.

| Lib | What it does | Maturity | TS types | Perf | Caveats |
|---|---|---|---|---|---|
| **`ml-matrix`** | Dense matrix + all decompositions | v6.12.2, **Apr 2026**, ~395★, ~1.37M/wk (transitive) | Bundled `.d.ts` (declared `types`), hand-maintained | Pure-JS, single-thread, no BLAS/SIMD | Fine for tens–low-hundreds of assets; not huge dense linalg |
| `mathjs` | Expression parser + matrices | v15.2.0, **active 2026**, ~15k★, ~2.8M/wk | Native bundled | Heaviest; `typed-function` per-call overhead | **No `svd`, no `cholesky`**; has det/inv/LU/QR/`eigs`/lusolve. Pulls decimal.js/complex.js/fraction.js. CSparse code is LGPL-2.1 |
| `@stdlib/linalg` | (intended) high-level linalg | **not shipped yet** | (would be native) | native BLAS/LAPACK primitives | High-level `svd`/`qr`/`cholesky`/`solve` are a **2026 GSoC RFC in-progress**; only low-level `@stdlib/lapack` (dgetrf/dgeqrf/dpotrf/dgesv) + `@stdlib/blas` exist today |

**`ml-matrix` confirmed exports:** `SingularValueDecomposition`(`SVD`) with `.solve()`/`.inverse()`/
rank/condition-number, `EigenvalueDecomposition`(`EVD`, real+imag eigenvalues+vectors),
`QrDecomposition`, `LuDecomposition`, `CholeskyDecomposition`, plus free functions `solve`, `inverse`
(SVD fallback for singular), `pseudoInverse`, `determinant`, `covariance`, `correlation`.

> **RECOMMENDATION → `ml-matrix`.** It is the *only* JS lib with SVD + QR + EVD + Cholesky + LU + solve
> + pseudo-inverse all present as clean, typed named exports, and it's the most-maintained/most-used of
> the set. Adopt it as the `matrix.ts` backend; the cluster's HIGH-value swap (SVD-based pinv, Cholesky
> for PSD covariance) lands here. Parity = `tolerance` (lib's pivoting/iteration differs at ~1e-10 —
> re-baseline portfolio-optimizer goldens).
>
> **GAP NOTE:** none for the operations Gordon uses. If you ever need BLAS-grade perf on large dense
> matrices, that's a `@stdlib/blas` or WASM-LAPACK escalation — not a current need. **Do not reach for
> mathjs or @stdlib for SVD/Cholesky today** — neither ships them.

---

## 2 — Statistics + distributions (CDF / inverse-CDF, erf, regression, tests)

Splits cleanly in two: **descriptive + regression** (mean/var/quantile/OLS/correlation) where a tiny
dep wins, and **distribution CDF + inverse-CDF + special functions** (the bug-surface README §3 flags:
erf, gammaln, incomplete-beta for t-CDF, χ² p-values) where only one source is both rigorous and typed.

| Lib | What it does | Maturity | TS types | Perf | Caveats |
|---|---|---|---|---|---|
| **`@stdlib/*` sub-pkgs** | Per-distribution cdf/quantile/pdf + special fns | umbrella v0.4.1, **active 2026**, ~5.8k★ | **Native bundled `.d.ts`** per pkg | Native add-ons + JS fallback, tree-shakeable | **Install per-function, never the umbrella**; dep-tree sprawl (file count). Strongest numeric robustness |
| **`simple-statistics`** | Descriptive + OLS + correlation + tests | v7.8.9, **Apr 2026**, ~3.5k★, ~293k/wk | Native bundled | Tiny, zero-dep, fast | **No t/χ²/F CDF or quantile** (only normal CDF + erf/probit + χ² *lookup table*); no linalg |
| `jstat` | Broad distributions w/ pdf/cdf/**inv** | v1.9.6, **~2023, dormant**, ~4k★, ~535k/wk | **None** (no `@types/jstat`) | Pure JS | Effectively abandoned; weakest tail/inverse-CDF robustness; awkward module surface. Avoid for new TS |

**Coverage facts that decide it:** `@stdlib` ships `@stdlib/stats-base-dists-{normal,t,chisquare,f,gamma}-{cdf,quantile,pdf}`
(so **inverse-CDF/quantile for t/χ²/F exists** — the thing `simple-statistics` and most others lack)
plus `@stdlib/math-base-special-{erf,erfinv,gamma,gammaln,betainc}`. `simple-statistics` has
`linearRegression`/`rSquared`/`sampleCorrelation`/`tTest`/`quantile`/`erf` but tops out at the normal
distribution. `jstat` has the breadth in one package but is unmaintained and untyped.

> **RECOMMENDATION → `@stdlib/*` for distributions + special functions; `simple-statistics` for
> descriptive stats + OLS.** This pair covers everything: route the hand-rolled erf/gammaln/incomplete-
> beta/χ²-table numerics (the HIGH-value swaps in `10`/`20`) to `@stdlib`; route duplicated
> stddev/z-score/OLS primitives to `simple-statistics`. Parity = `tolerance` (lib is *more* accurate
> than the A-S erf and the χ² lookup table — an accuracy upgrade that moves verdicts near thresholds;
> re-baseline). **Skip `jstat`** — its only advantage (breadth in one import) is beaten by @stdlib's
> per-fn packages, and it's untyped + dormant + tail-weak.
>
> **GAP NOTE:** none for the distributions Gordon uses — @stdlib is the scipy.stats-lite of JS. (It is
> **not** statsmodels — see §4.)

---

## 3 — Technical indicators (RSI/MACD/Bollinger/ATR/ADX/Ichimoku/…)

Per the `10-indicators.md` finding, this is the **lowest-value adoption region** — the classic
indicators are working+tested and a swap is churn with re-baseline risk. Catalog the best lib anyway
for the cases where a new indicator is wanted or a duplicate cluster is consolidated.

| Lib | Coverage | Maturity | TS types | Perf | Caveats |
|---|---|---|---|---|---|
| **`trading-signals`** | SMA/EMA/RSI/MACD/Bollinger/ADX/ATR/Stochastic + 40 more | **v7.x, active 2025–26**, ~909★, ~2.4k/wk | **100% native TS (best)**, ESM | Fast since v7 | **v7 removed big.js** → float, not arbitrary-precision (pin v6 for exact-decimal, ~100× slower). No candlestick patterns |
| `technicalindicators` | Broadest + **candlestick patterns** | v3.1.0, **~2020 stale**, ~2.4k★, ~25–42k/wk | Bundled `.d.ts` | Medium, weak ESM | Unmaintained (use fork `@thuantan2060/...` if needed); 1 runtime dep |
| `tulind` | 100+ via Tulip C lib | v0.8.20, **stale (Node ≤16)** | None (3rd-party `tulind-types`) | **Fastest (C)** | **Native node-gyp addon — Bun-fragile, install-time liability.** Reserve for profiled batch bottleneck only |
| `indicatorts` | Indicators + strategies + backtest | v2.2.2, ~2025, ~425★ | Native TS | Medium | **AGPLv3/commercial license — dealbreaker for a distributed product**; backtest layer duplicates `src/backtest/` |

> **RECOMMENDATION → `trading-signals`** *if* adopting any TA lib: only one under active 2025–26
> maintenance, cleanest native types, ESM-first, and its streaming `update()` model fits an agent
> consuming live ticks. Permissive license, pure-JS (no native-build risk under Bun). Internalize:
> high-precision decimal is a **v6-only** property (v7 = fast float). `tulind` is fastest but its native
> addon is wrong for a shipped Bun CLI; `indicatorts` is technically fine but **AGPL rules it out**;
> `technicalindicators` only if you specifically need candlestick-pattern recognition (use a fork).
>
> **GAP NOTE:** adoption value is **LOW** here by design — most of `core/indicators/` is custom price-
> action / SMC / order-flow / research-paper detectors **no library covers** (SKIP), and the classic
> ones are churn. The real wins in this region are the *special-function primitives inside* indicators
> (§2), not the indicators themselves.

---

## 4 — Time-series econometrics (ARIMA/GARCH/ADF/cointegration/Johansen/HMM/Kalman/VAR)

**This is the big gap.** There is no scipy/statsmodels equivalent in JS — verified topic by topic.
Econometric *model estimation* stays hand-rolled (or polyglot via WASM/sidecar). Two narrow exceptions.

| Topic | Best candidate | Maturity verdict |
|---|---|---|
| ARIMA / SARIMA | `arima` (zemlyansky, C→WASM) | **usable-but-thin** — only real option; weak `.d.ts`, single-author, manual WASM `.destroy()`, low activity |
| **Kalman filter** | **`kalman-filter` (piercus)** | **MATURE, TS-native** ✅ v2.3.0, 99% TS, ships `.d.ts`, custom state-space matrices. *But a state estimator, not an econometric estimator* |
| GARCH | — | **none-exists** (R `rugarch` / Python `arch` only) |
| ADF / unit-root | — | **none-exists (mature)** |
| Cointegration / Johansen | — | **none-exists** (Gordon built this in-house — consistent) |
| HMM | `hmm`/`nodehmm`/etc. | **abandoned / toy** (8–11 yrs stale) |
| State-space / VAR | hand-roll on `kalman-filter` | **none-exists** |

> **RECOMMENDATION → keep econometrics hand-rolled** (the existing in-house Johansen/OU-calibration/HMM
> per the pairs-trading framework is the right call — *no library existed to adopt*). Two specific
> exceptions worth considering: **`kalman-filter` (piercus)** is genuinely mature + TS-native and could
> back any Kalman/state-space smoothing instead of a hand-roll; and **`arima` (zemlyansky)** is the only
> functional ARIMA if forecasting is ever needed, but its thin types + WASM memory management + single-
> author status make it a *cautious* adopt, not a foundation.
>
> **GAP NOTE (the headline gap of this catalog):** ARIMA/GARCH/ADF/cointegration/Johansen/VAR and a
> maintained HMM have **no mature TS option**. `@stdlib` is scipy.stats-lite (distributions + tests),
> **not** statsmodels — it does not close this. If polyglot becomes acceptable post-competition, a
> Python (statsmodels/arch) sidecar over the gateway is the realistic path; otherwise these stay as
> validated hand-rolled numerics.

---

## 5 — Dataframes / data wrangling (pandas-like)

Dependency weight is the decision axis for a CLI agent. The popular pick (`danfojs`) carries a
TensorFlow.js native dependency that is disqualifying for a lightweight tool.

| Lib | What it does | Maturity | TS types | **Weight** | Caveats |
|---|---|---|---|---|---|
| **`data-forge`** | Immutable LINQ-style DataFrame/Series | v1.10.4, **stable/quiet**, ~1.4k★ | **Native TS** | **Lightest real dataframe** — pure-JS, no native, no TF.js; IO split to `data-forge-fs` | Row/iterator-oriented (not vectorized); fine for thousands–low-millions of rows |
| `danfojs-node` | Pandas-style + tensors | v1.2.0, **2025, low-activity**, ~5k★ | Native TS | **Heaviest** — hard-deps `@tensorflow/tfjs-node` (native, >100MB); also `request` (deprecated), CDN-tarball `xlsx` | **Avoid in a CLI** — TF.js is pure overhead unless you need tensors |
| `apache-arrow` | Columnar in-memory + IPC | v21.1.0, **active 2026** | Native TS | Light runtime deps, **but ~5MB bloated tarball** (multi-target bundle) | Interop layer, **not** a wrangling API; doesn't read Parquet itself |
| `nodejs-polars` | Rust-backed DataFrame + native Parquet/Arrow | v0.25.1, **active 2026**, ~730★ | Native TS | **Native Rust binary** (tens of MB/platform), Node ≥20 | Pre-1.0 API churn; pull in only when Parquet/perf is a hard requirement |
| `ndarray`(scijs)/`numjs` | Strided arrays / numpy-like | **unmaintained** (2022 / 2024) | `@types/ndarray` thin / none | Tiny | Frozen primitive; `numjs` is dead |

> **RECOMMENDATION → `data-forge`** for tabular wrangling in the CLI: only genuinely light native-TS
> dataframe (no native binary, no TF.js), mature/stable API (filter/map/groupBy/join/pivot/window).
> Accept it's pure-JS (not vectorized) — right weight class for agent-scale data. For **Python/Parquet
> interop**, `apache-arrow` is the zero-copy boundary; add `nodejs-polars` *only* if you need native
> Parquet IO + fast queries and can absorb the Rust binary.
>
> **GAP NOTE:** no lightweight *vectorized* columnar engine in pure JS — the choice is light-but-scalar
> (`data-forge`) or fast-but-native-binary (`nodejs-polars`). For a CLI, prefer scalar. **Hard avoid
> `danfojs`** (TF.js). `numjs`/`ndarray` are dead — don't adopt.

---

## 6 — Optimization (minimization, grid/genetic, root-finding)

No SciPy-`optimize` equivalent. The field is small, mostly stale/untyped; pick by sub-need.

| Need | Lib | Maturity | TS types | Notes |
|---|---|---|---|---|
| Derivative-free min (Nelder-Mead) | **`fmin`** | v0.0.4, **bumped 2024**, ~370★, ~142k/wk | **None** (no `@types/fmin`) | `nelderMead`/`conjugateGradient`/`bisect`. Hand-write a 5-line `declare module`. Good for ≤10-param fits; no bounds/constraints |
| Curve-fit / least-squares | **`ml-levenberg-marquardt`** | v5.0.1, **Apr 2026**, ~64k/wk | **Native** ✅ | LM only (residual vector); supports min/max bounds, fixed params. Best-typed optimizer; deps `ml-matrix` |
| L-BFGS / Powell / GA-in-one | `optimization-js` | v1.5.0, **2018 stale** | None | Only easy JS L-BFGS; README warns it "can be unstable" |
| Root-finding (Brent/bisection) | hand-roll Brent / `brents-method` | v2.0.1, 2020, near-zero adoption | None | ~30-line hand-roll is the common move |
| Genetic | `geneticalgorithm` / `optimization-js` GA | 2019 / 2018 | None | Supply mutate/crossover/fitness; stale but workable |

> **RECOMMENDATION → `fmin` for unconstrained Nelder-Mead minimization (with a tiny type shim) +
> `ml-levenberg-marquardt` for least-squares curve-fitting** (e.g. vol-surface/model calibration framed
> as residual minimization — and it's natively typed). `@stdlib` has **no** general minimizer — don't
> look there.
>
> **GAP NOTE:** **L-BFGS / constrained optimization with good TS types** is a gap — `optimization-js` is
> the only easy JS L-BFGS but is stale and untyped. Root-finding has no compelling lib (hand-roll
> Brent). For both, hand-rolling on a small Nelder-Mead fits Gordon's quant-math-in-code convention.

---

## 7 — Random / sampling / Monte Carlo (seeded RNG, distribution sampling, bootstrap)

Reproducibility (seeding + state save/restore) is the requirement for backtests/MC sweeps.

| Need | Lib | Maturity | TS types | Notes |
|---|---|---|---|---|
| Rigorous seeded MC + state | **`@stdlib/random-*`** | v0.2.1, maintained, ~5.8k★ org | **Native bundled** | `.factory({seed})`, full state save/restore (`Uint32Array`/`toJSON`), best quality. **Heavy dep fan-out** (14–16 deps/pkg) |
| Distribution sampling + seed | **`d3-random`** | v3.0.1, mature, ~9.5M/wk, 0-dep | `@types/d3-random` | `randomLcg(seed)` + 18 distributions via `.source()`. LCG period ~1B (watch 10⁹+ draw sweeps) |
| Pure seeded PRNG + state | **`seedrandom`** | v3.0.5, stable, ~7M/wk, 0-dep | `@types/seedrandom` | ARC4 + alea/xorshift variants, state save/restore. Use as d3 `.source()` |
| Array resample (bootstrap primitive) | `@stdlib/random-sample` | v0.2.1, maintained | Native bundled | `replace:true` + `probs` + `seed` — closest thing to a bootstrap primitive |
| **Bootstrap / CI (BCa/percentile)** | **— GAP —** | — | — | No maintained JS lib; hand-roll on `@stdlib/random-sample` |

> **RECOMMENDATION → `@stdlib/random-*`** when you want seeded, state-reproducible Monte Carlo with
> native types (worth the dep fan-out for a backtest/MC engine). For lighter needs, **`d3-random` +
> `seedrandom`** (seedrandom as the `.source()`) is the ~0-dep, well-typed combo — d3 brings the
> distributions, seedrandom brings reproducible state. All are statistical (not crypto) RNGs.
>
> **GAP NOTE:** **bootstrap / resampling with confidence intervals (BCa/percentile) has no mature lib** —
> only R/Python. Hand-roll on `@stdlib/random-sample` (`replace:true`) + a percentile/BCa loop (a few
> dozen lines) — the standard move, fits Gordon's convention.

---

## 8 — ML (PCA, regression, clustering/hierarchical — for HRP + factor models)

The ml.js suite, all on the `ml-matrix` substrate (§1). HRP (Hierarchical Risk Parity) is **fully
buildable** from these — the one place ml.js is load-bearing for Gordon's portfolio stack.

| Lib | What it does | Maturity | TS types | Notes |
|---|---|---|---|---|
| **`ml-pca`** | PCA via SVD/NIPALS/cov-eigen | v4.1.1, **~3yr stale but tracks ml-matrix** | Native (TS source) | `.getEigenvalues/Eigenvectors/ExplainedVariance/Loadings`. For factor models |
| **`ml-regression-*`** | simple/multivariate-linear/polynomial/theil-sen | simple-linear v3, multivariate v2 (v4 on main) | Native per sub-pkg | **Import granular `ml-regression-*`, not the untyped `ml-regression` aggregator** |
| **`ml-kmeans`** | K-means (++/random/mostDistant init) | v7.0.1, maintained | Native (generated `.d.ts`) | — |
| **`ml-hclust`** | Agglomerative + DIANA, **single/complete/average/centroid/ward** | **v4.0.0, June 2026 (fresh)** | Native (generated `.d.ts`) | **Ward present → HRP quasi-diagonalization works**. Takes precomputed distance |
| **`ml-distance`** | Distance/similarity catalog | v4.0.1 | Native bundled | Build HRP correlation-distance `sqrt(0.5*(1-ρ))` from its primitives + `ml-matrix.correlation` |
| `ml` (umbrella) | Re-exports ~60 ml-* | v8.0.0, ~2.3k★ | **None (untyped)** | **Don't bundle** — install granular packages |

> **RECOMMENDATION → adopt the granular ml.js packages** (`ml-pca`, `ml-regression-simple-linear` /
> `-multivariate-linear`, `ml-kmeans`, `ml-hclust` + `ml-distance`) — never the untyped `ml` umbrella or
> `ml-regression` aggregator. **HRP is the concrete win:** `ml-hclust` (Ward linkage, freshly updated
> June 2026) + `ml-distance` (correlation-distance) + `ml-matrix` (`correlation`/covariance) replaces the
> hand-rolled HRP clustering in `core/alpha/hierarchical-risk-parity.ts`. Parity = `tolerance`
> (clustering tie-breaks + eigen sign conventions differ — re-baseline the weight vector).
>
> **GAP NOTE:** `ml-pca` is the stalest core piece (~3yr) but its surface is small and it tracks current
> `ml-matrix` — low risk. No gap for HRP/PCA/regression/clustering.

---

## 9 — Options / Greeks (Black-Scholes)

Thin area: one modern TS package, otherwise decade-old untyped single-author packages. The math is
~50 lines (norm-CDF + d1/d2 + five greeks + Newton/bisection IV), so hand-roll is viable.

| Lib | What it does | Maturity | TS types | Notes |
|---|---|---|---|---|
| **`@uqee/black-scholes`** | BS price + delta/gamma/vega/theta/rho + **IV solver** | v1.0.7, 2023, light, 0-dep | **Native** ✅ | Configurable bisection/newton IV. European BS only (no American/dividends) |
| `black-scholes` (MattL922) | Price only | ~2015, unmaintained | None | Greeks split into sibling `greeks` pkg |
| `greeks` (MattL922) | Greeks only | ~2015, unmaintained | None | Pairs with `black-scholes` + `implied-volatility` trio |
| `implied-volatility` (MattL922) | IV solver | 2014, unmaintained | None | Newton-style |

> **RECOMMENDATION → `@uqee/black-scholes`** if adopting a lib (only modern, TS-typed, dependency-free
> option covering price + all five greeks + IV in one call) — or **hand-roll the ~50 lines** (fits the
> quant-math-in-code convention and avoids a lightly-maintained dep). The MattL922 trio is decade-old
> and untyped — avoid.
>
> **GAP NOTE:** no mature lib for American options / dividends / binomial trees — but Gordon's surface is
> European-style analytics, so not a blocking gap. This is a **hand-roll-or-`@uqee`** call, low stakes
> either way.

---

## Cross-cutting adoption notes

- **Dependency-budget ranking (lightest → heaviest install) for a Bun CLI:** `simple-statistics` ≈
  `d3-random`/`seedrandom` ≈ `data-forge` ≈ `ml-*` (pure-JS) < `@stdlib/*` (many tiny pkgs — byte-light
  but file-count-heavy) < `apache-arrow` (big tarball, no native) < `mathjs` (heavy deps) <
  `nodejs-polars` (Rust binary) < `tulind` (node-gyp) < `danfojs` (TF.js). **Avoid the bottom three for
  a shipped CLI** unless a profiled need justifies the native-build/Bun-fragility risk.
- **Typing tiers:** native-TS (best): `trading-signals`, `simple-statistics`, `data-forge`,
  `@stdlib/*`, `ml-levenberg-marquardt`, `@uqee/black-scholes`, `kalman-filter`, the granular `ml-*`.
  `@types`-only: `d3-random`, `seedrandom`. **Untyped (write a shim):** `fmin`, `jstat`, `ml` umbrella,
  `ml-regression` aggregator, `optimization-js`, the MattL922 options trio.
- **Parity is `tolerance` for almost every swap** (lib numerics differ from the hand-rolled at
  ~1e-7–1e-10) — per README §2, every adoption re-baselines a golden. The few `divergent` cases (χ²
  lookup-table → real CDF, A-S erf → exact erf) are *accuracy upgrades* that move verdicts near
  thresholds — re-baseline the thresholds, don't assume equality.
- **The four standing gaps** (econometrics, bootstrap-CI, L-BFGS/constrained opt, vectorized-columnar-
  in-pure-JS) stay hand-rolled or polyglot — don't force a stale/toy lib into them.
