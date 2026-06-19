# 10 — Indicators & Market-Analysis (`core/indicators` + `core/market-analysis`)

Region scope: `src/core/indicators/*.ts` (~90 indicator modules) + `src/core/market-analysis/*.ts` (5 files).

**Read `README.md` first.** This is post-competition planning, not a refactor order. The headline finding for this region is **bias toward LOW/SKIP**: the directory is ~70% custom price-action / SMC / order-flow / research-paper detectors that **no library covers** (SKIP), and most of the remainder are working+tested **classic indicators** where a library swap is **churn with re-baseline risk** (LOW). The genuine bug-surface wins are a small, sharp cluster: **hand-rolled transcendental functions** (Student-t CDF via gammaln + incomplete-beta; standard-normal CDF via an Abramowitz–Stegun erf) and a **crude tabulated chi-square p-value approximation**. Those are HIGH. Everything else is judgement about whether the churn is worth it later.

The single most reusable observation: the **same numeric primitives are re-implemented across many files** — population/sample stddev, rolling mean/std, z-score, OLS. The highest-leverage *non-classic* action is to route those duplicates through one focused stats dep (`simple-statistics`) rather than chasing per-indicator library swaps. See the "Shared primitives" cluster.

---

## Cluster A — HIGH: hand-rolled transcendental / distribution numerics (real bug-surface)

These are the gnarly numerics README §3 explicitly prioritizes. They are error-prone (continued-fraction convergence, underflow at the tails, polynomial-approximation error), low-churn (the surrounding indicator is unchanged — only the inner primitive swaps), and library implementations are battle-tested in R/NumPy/SciPy.

| Module (file:line) | Hand-rolled | Candidate lib (API) | Replaces | Parity | Effort | Priority | Notes |
|---|---|---|---|---|---|---|---|
| `indicators/linearRegression.ts:64` | `gammaln` (Lanczos 6-term) | `@stdlib/math-base-special-gammaln` | Log-Γ for the beta normaliser | tolerance | S | **HIGH** | Used only inside the t-CDF below. Swapping gammaln + betacf together is cleaner than piecemeal. |
| `indicators/linearRegression.ts:81` | `betacf` (Lentz continued-fraction) + `incompleteBeta` | `@stdlib/math-base-special-betainc` (regularized I_x(a,b)) | Incomplete-beta for the t-CDF | tolerance | S | **HIGH** | Classic Numerical-Recipes port — exactly the convergence/underflow bug-surface README flags. |
| `indicators/linearRegression.ts:133` | `studentTTwoSidedPValue(t, df)` | `@stdlib/stats-base-dists-t/cdf` (then `2*(1-cdf(|t|,df))`) or `jstat.studentt.cdf` | Two-sided slope/intercept p-values | tolerance | S | **HIGH** | **Exported and reused by `infra/trading/.../hedgeFundReplication.ts`** — verify that caller's golden when re-baselining. Lib differs in last ~1e-7; re-baseline the rounded outputs (the file rounds p to 6dp). |
| `indicators/vpin.ts:44` | `normalCdf(x)` via Abramowitz–Stegun 7.1.26 erf (max err ~1.5e-7) | `@stdlib/stats-base-dists-normal/cdf` | Φ(Δp/σ) in Bulk Volume Classification | tolerance | S | **HIGH** | VPIN itself is SKIP-custom, but the **erf primitive inside it** is the swap. Lib is exact vs the A-S polynomial. Re-baseline VPIN's golden (BVC fractions shift at ~1e-7). |
| `indicators/markov-regime.ts:293` | `CHI2_CRIT_010/001` tables + `approxChiSquarePValue` (linear interpolation between two cutoffs) | `@stdlib/stats-base-dists-chisquare/cdf` (p = 1 − cdf(χ², df)) | Transition-matrix stability p-value | divergent | S | **HIGH** | The current p-value is **deliberately approximate** ("close enough for stable/drifting/unstable"). A real CDF is *better*, not just equal → this is an accuracy upgrade, but it WILL move the `stable/drifting/unstable` verdict near the 0.10/0.01 boundaries. Re-baseline the verdict thresholds. |

**Why HIGH despite "post-competition":** these are the lowest-churn, highest-confidence swaps in the whole region — the indicator's public output and tests are unchanged, only an internal special-function call moves to a library used by millions. The chi-square one is the only behavioural change (and it's an improvement).

---

## Cluster B — MED: shared numeric primitives duplicated across files (dedup, not per-indicator swap)

Population/sample stddev, rolling mean/std, z-score, and plain OLS (single-pass sum reductions) are re-implemented in many modules. Individually each is correct and trivial; collectively they're maintenance surface and a place for subtle divergence (population vs sample N, ddof). Route them through **one** focused dep. This is MED (not HIGH) because each instance is numerically simple and already tested — the value is consolidation, not bug-fixing a fragile primitive.

| Module (file:line) | Hand-rolled | Candidate lib (API) | Replaces | Parity | Effort | Priority | Notes |
|---|---|---|---|---|---|---|---|
| `indicators/bollinger.ts:12` | `calculateStdDev` (population, ÷N) | `simple-statistics.standardDeviation` (sample) / `.variance` | Band-width stddev | tolerance | S | MED | **Watch ddof:** SS `standardDeviation` is *sample* (÷N−1); Bollinger uses *population* (÷N) — must keep population (use `ss.populationStandardDeviation`) or bands widen. Re-baseline if mismatched. |
| `indicators/cusum-filter.ts:16` | `stdev` (sample, ÷N−1) | `simple-statistics.standardDeviation` | Threshold scaling | exact | S | MED | Sample ddof matches SS default → near-exact. |
| `indicators/markov-regime.ts:69` | `rollingMean` + `rollingStd` (sample) | `simple-statistics.standardDeviation/mean` over slices | Rolling z-score of returns | tolerance | S | MED | Pairs with the Cluster-A chi-square swap in the same file. |
| `indicators/order-blocks.ts:52` | rolling z-score | `simple-statistics.zScore` / `.standardDeviation` | OB extremity detection | tolerance | S | MED | KM survival (line 81) stays custom (see Cluster D). |
| `indicators/overnight-intraday.ts:~43` | mean/variance/std of leg returns | `simple-statistics.mean/variance` | Knuteson leg-signature stats | exact | S | MED | Forensic detector is SKIP-custom; only the stats helper swaps. |
| `indicators/rsrs.ts:93` | `olsSlopeR2` (single-pass OLS slope + R²) | `simple-statistics.linearRegression` + `.rSquared` | High-on-low rolling β | tolerance | M | MED | Plain OLS, numerically fine and tested → **churn-adjacent.** Only do it as part of a region-wide OLS consolidation, not standalone. |
| `indicators/linearRegression.ts:168` | OLS fit + DW + lag-1 autocorr | `simple-statistics.linearRegression` (fit only) | Core regression | tolerance | M | MED | Keep the DW/autocorr/inference layer hand-rolled (no lib) — only the sum-reduction fit is replaceable, and it's the least fragile part. Low value vs Cluster A in the same file. |
| `indicators/standardErrorBands.ts:108` | consumes `rollingLinearRegression` | (inherits the OLS swap above) | Centerline ± k·SE | tolerance | M | MED | No independent swap — moves only if `linearRegression.ts` OLS does. |
| `indicators/scanner-bundle.ts:18` | SMA/EMA/RSI/MACD (scalar variants) | `technicalindicators.*` | Scanner-path indicators | tolerance | M | MED | Duplicate of `core/indicators` classics; consolidating onto one impl (lib or internal) removes a second RSI/MACD codepath. Churn risk same as Cluster C. |

---

## Cluster C — LOW: classic indicators (working + tested → churn, re-baseline risk)

These are textbook indicators a mature lib (`technicalindicators`, `trading-signals`, `tulind`) implements. **They work and are tested.** Per README §3 this is LOW value — and per §2 the swap is **not free**: libraries differ in smoothing seed (Wilder vs simple), initialization, and edge-case handling (zero-range bars, insufficient-data paths), so parity is almost always `tolerance` or `divergent` and every swap needs a golden re-baseline. Recommend: **do not swap unless a bug is found** in a specific module. Listed for completeness; effort S each but multiplied across the set.

| Module (file) | Indicator | Candidate lib (API) | Parity | Priority | Notes |
|---|---|---|---|---|---|
| `ema.ts` | EMA / SMA | `technicalindicators.EMA/SMA` | tolerance | LOW | Seed differs (SMA-seeded vs first-value). |
| `rsi.ts` | Wilder RSI | `technicalindicators.RSI` | tolerance | LOW | Wilder smoothing; lib variants differ. |
| `macd.ts` | MACD | `technicalindicators.MACD` | tolerance | LOW | |
| `atr.ts` / `natr.ts` | ATR / NATR | `technicalindicators.ATR/NATR` | tolerance / exact | LOW | NATR is just ATR%·100 → near-exact. |
| `bollinger.ts` | Bollinger | `technicalindicators.BollingerBands` | tolerance | LOW | Population stddev; see ddof note in Cluster B. |
| `adx.ts` / `adxr.ts` | ADX/DI / ADXR | `technicalindicators.ADX` | divergent / exact | LOW | ADX smoothing notoriously lib-divergent. ADXR is a custom wrapper (no lib). |
| `stochastic.ts` / `stochastic-rsi.ts` | Stochastic / StochRSI | `technicalindicators.Stochastic/StochasticRSI` | tolerance | LOW | |
| `cci.ts` | CCI | `technicalindicators.CCI` | tolerance | LOW | Mean-deviation constant 0.015. |
| `williams-r.ts` | Williams %R | `technicalindicators.WilliamsR` | tolerance | LOW | |
| `mfi.ts` | Money Flow Index | `technicalindicators.MFI` | tolerance | LOW | |
| `cmo.ts` | Chande MO | `technicalindicators.CMO` | tolerance | LOW | |
| `aroon.ts` | Aroon / Aroon Osc | `technicalindicators.Aroon` | tolerance | LOW | |
| `ultimate-oscillator.ts` | Ultimate Osc | `technicalindicators.UltimateOscillator` | tolerance | LOW | |
| `awesome-oscillator.ts` | Awesome Osc | `technicalindicators.AwesomeOscillator` | tolerance | LOW | |
| `momentum-roc.ts` | Momentum / ROC | `technicalindicators.ROC` | exact | LOW | Trivial; lib not worth the dep alone. |
| `tsi.ts` | True Strength Index | `technicalindicators.TSI` | tolerance | LOW | |
| `parabolic-sar.ts` | Parabolic SAR | `technicalindicators.PSAR` | tolerance | LOW | AF stepping edge-cases differ. |
| `supertrend.ts` | Supertrend | `technicalindicators.Supertrend` | tolerance | LOW | |
| `donchian.ts` | Donchian | `technicalindicators.DonchianChannel` | exact | LOW | Pure min/max → exact. |
| `ichimoku.ts` | Ichimoku (5 lines) | `technicalindicators.IchimokuCloud` | tolerance | LOW | |
| `vwma.ts` | VWMA | `technicalindicators.VWMA` / `tulind.vwma` | exact | LOW | |
| `price-oscillator.ts` | APO / PPO | `technicalindicators.APO/PPO` | exact | LOW | |
| `vwap.ts` | VWAP (+ rolling) | `technicalindicators.VWAP` | tolerance | LOW | Anchored-VWAP variant in same file is SKIP-custom. |
| `volume-profile.ts` | Volume Profile / POC / VA | (none standard) | exact | LOW | Histogram + 70% value-area; trivial, no clean lib. |
| `chaikin.ts` | Chaikin A/D + Osc | `technicalindicators.ChaikinAD` / `tulind.ad` | tolerance | LOW | |
| `cmf.ts` | Chaikin Money Flow | `technicalindicators.CMF` / `tulind.cmf` | tolerance | LOW | |
| `vpt.ts` | Volume Price Trend | `technicalindicators.VolumeProfile`*/none | tolerance | LOW | Adds custom divergence layer; only the cumsum is classic. |
| `fibonacci.ts` / `camarilla.ts` | Fib levels / Camarilla pivots | trivial arithmetic | exact | LOW | **Not worth a dependency** — pure ratio math. |
| `candlestick-patterns.ts` | ~12 classic candle patterns | `technicalindicators` candlestick suite | tolerance | LOW | Reasonable consolidation candidate if a pattern bug surfaces; otherwise churn. |
| `squeeze-momentum.ts` | LazyBear BB-in-KC + linreg momentum | `technicalindicators.BollingerBands/KeltnerChannels` for sub-parts | tolerance | LOW | Could reuse lib BB/KC; the linreg momentum + signal grammar stays custom. |
| `divergence.ts` / `hidden-divergence.ts` | RSI + rolling extrema divergence | (RSI from lib; divergence logic custom) | tolerance | LOW | Only the embedded RSI is classic; the swing/divergence detection has no lib. |
| `ichimoku-signals.ts` | 6 Ichimoku signal variants | `technicalindicators.IchimokuCloud` (core only) | divergent | LOW | Core lines could come from lib; the 6 signal interpretations are custom. |

---

## Cluster D — SKIP: custom / proprietary / research-paper detectors (no library exists)

~70% of the directory. README §5: name the gaps, don't force a bad fit. These implement SMC/ICT price-action grammars, order-flow microstructure, López de Prado / academic methodologies, or proprietary educator patterns. **No mature TS library covers any of them.** They stay hand-rolled. (Where a stats helper is embedded, that helper is covered in Cluster B — the *detector* itself is SKIP.)

- **Econometrics / research-paper (no TS lib — README §5 gap):** `frac-diff.ts` (LdP fractional differencing), `cusum-filter.ts` (LdP CUSUM events), `sadf.ts` (Phillips-Shi-Yu SADF — depends on `core/alpha/matrix.ts` invert; the **matrix swap is deferred to the `20-alpha-regime.md` region**), `vpin.ts` (Easley-LdP-O'Hara — *erf primitive is Cluster A*), `amihud-illiquidity.ts` (Amihud 2002), `roll-spread.ts` (Roll 1984 / Corwin-Schultz 2012), `information-bars.ts` (LdP info-driven bars), `rotation-bars.ts` (range/Renko bars), `intraday-momentum.ts` (Gao-Han-Li-Zhou 2018), `overnight-intraday.ts` (Knuteson — *stats helper is Cluster B*), `rsrs.ts` (*OLS is Cluster B; verdict logic custom*), `lmw-patterns.ts` (Lo-Mamaysky-Wang 2000 kernel-regression pattern grammar).
- **Filters / smoothers (no good TS lib):** `kalman.ts` (1D scalar Kalman — 25 LOC, no maintained TS lib worth it → SKIP), `nadaraya-watson.ts` (Gaussian-kernel regression + ATR envelope — kernel is standard but the envelope grammar is custom; `lmw-patterns.ts` shares the kernel pattern, possible internal dedup but no external lib), `hull-ma.ts` (HMA + custom EHMA/THMA variants), `gmma.ts` (Guppy ribbon + compression dynamics), `supertrend-channel.ts` (custom envelope).
- **SMC / ICT / price-action (proprietary grammars):** `order-blocks.ts` (*z-score → Cluster B; KM survival is a simplified median heuristic, no lib*), `breaker-block.ts`, `fvg.ts`, `fvg-sweep-context.ts`, `supply-demand-zones.ts`, `smc-patterns.ts`, `displacement-break.ts`, `candle-continuity.ts`, `structure-break-conviction.ts`, `angled-market-structure.ts`, `false-breakout.ts`, `naked-poc.ts`, `volume-imbalance.ts`, `footprint-imbalance.ts`, `delta-ladder.ts`, `flowscope.ts`.
- **Educator / pattern proprietary:** `elliott-wave.ts`, `three-mountains-rivers.ts`, `harris-pattern.ts`, `leledc-exhaustion.ts`, `undercut-rally.ts`, `tight-consolidation.ts`, `trim-state.ts`, `resistance-tests.ts`, `wavetrend.ts` (LazyBear), `vzo.ts` (Waxman), `volume-signature.ts` (Morales-Kacher / CAN SLIM), `cboe-odds-oscillator.ts`, `rsi-midpoint.ts`, `rsi-failure-swing.ts`, `rsi-trendline.ts`, `highestVolumeEver.ts`, `open-pivot.ts` (CryptoCred session-open pivot + wickless-drive — pure OHLC/wick geometry, no lib), `price-levels.ts` (swing clustering — `technicalindicators` has nothing equivalent).
- **`core/market-analysis/` (all 5):** `whale-detector.ts`, `breakout-detector.ts`, `consolidation-detector.ts`, `market-scorer.ts`, `index.ts` — weighted-sum scoring, min/max, and True-Range heuristics. **No hand-rolled fragile numerics; nothing to adopt.** SKIP.
- **Aggregators (no numerics):** `analysis.ts`, `scanner-bundle.ts` (*its classic sub-calcs are Cluster B/C*).

---

## Counts

| Priority | Count | What |
|---|---|---|
| **HIGH** | **5** | Transcendental/distribution primitives: gammaln, incomplete-beta, Student-t CDF (`linearRegression.ts`), erf/Φ (`vpin.ts`), chi-square p-value (`markov-regime.ts`). |
| **MED** | **9** | Duplicated stddev/mean/z-score/OLS primitives → `simple-statistics` consolidation (`bollinger`, `cusum-filter`, `markov-regime`, `order-blocks`, `overnight-intraday`, `rsrs`, `linearRegression` OLS, `standardErrorBands`, `scanner-bundle`). |
| **LOW** | **~33** | Classic indicators with mature lib equivalents but working+tested → churn + re-baseline risk (Cluster C). |
| **SKIP** | **~50** | Custom SMC/ICT/order-flow/research-paper/educator detectors + market-analysis heuristics — no library exists (Cluster D). |

**Bottom line for this region:** do the 5 HIGH transcendental swaps (lowest churn, real bug-surface, library-of-record numerics) and consider the MED stats-primitive consolidation as one focused `simple-statistics` adoption. Leave the ~33 classic indicators alone unless a specific bug appears — swapping them is pure churn against validated code with guaranteed numeric drift. The ~50 SKIP detectors are Gordon's proprietary edge and have no library to adopt.
