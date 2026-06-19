# 40 — backtest/ + strategies/ + core/backtesting

Region: `src/backtest/`, `src/strategies/`, `src/core/backtesting/`. Companion to the
catalog in `00-CATALOG.md` and the format in `README.md`.

**Headline finding.** Gordon has **zero quant/stats libraries** in `package.json` today
(`simple-statistics`, `@stdlib/*`, `fmin`, `data-forge`, `danfojs` are all absent — verified).
Every performance/risk metric, every optimizer search, and the Monte-Carlo machinery is
hand-rolled. The single highest-value finding is **duplication**: mean, sample-std,
max-drawdown, and the annualized **Sharpe** formula are each re-implemented **3–4 times**
across `metrics.ts`, `fee-sensitivity.ts`, `vectorized-cross-sectional.ts`, and
`overfitting.ts`/`walk-forward.ts`. That is the bug-surface a single tested primitives
module (`simple-statistics`) is meant to collapse — one annualization convention, one std
estimator, one drawdown loop.

> **Parity caveat (load-bearing).** `metrics.ts` is the source of the **judged Sharpe** in
> the competition. Any swap here is a `tolerance` swap that MUST be golden-tested against the
> current output before it ships — per README principle #2. `simple-statistics` uses the same
> textbook sample-variance (`n−1`) and arithmetic mean, so parity should hold to float epsilon,
> but it must be *demonstrated*, not assumed. This is post-competition work.

## Adopting `simple-statistics` — the duplication map

These are the same three primitives written out repeatedly. Adopt once, route all callers
through it.

| Primitive | Hand-rolled sites (file:line) | `simple-statistics` API |
|---|---|---|
| Arithmetic mean | `metrics.ts` (inline, many), `fee-sensitivity.ts:103-109`, `overfitting.ts:252-255`, `walk-forward.ts:666-669`, `monte-carlo.ts:479` | `ss.mean(x)` |
| Sample std / variance (n−1) | `metrics.ts:182-185`, `fee-sensitivity.ts:118-123`, `overfitting.ts:260-266`, `walk-forward.ts:680-686`, `monte-carlo.ts:485-487`, `vectorized-cross-sectional.ts:362-366` | `ss.sampleStandardDeviation(x)` / `ss.sampleVariance(x)` |
| Median | `overfitting.ts:240-247`, `walk-forward.ts:671-678`, `monte-carlo.ts:480-482` | `ss.median(x)` |
| Linear-interp percentile | `metrics.ts:491-505`, `monte-carlo.ts:493-496` (floor-index, NOT interpolated — drift!) | `ss.quantileSorted(x, p)` |
| Covariance / variance (beta) | `metrics.ts:586-594` (rolling beta) | `ss.sampleCovariance`, `ss.sampleVariance` |

### Per-metric rows

| Module (file:line) | Hand-rolled | Candidate lib (API) | Replaces | Parity | Effort | Priority | Notes |
|---|---|---|---|---|---|---|---|
| `metrics.ts:174-189` | `calculateVolatility` — sample-std × √periodsPerYear | `simple-statistics` `sampleStandardDeviation` | the std core | tolerance | S | **HIGH** | Keep the annualization wrapper; swap only the std core. Load-bearing (feeds Sharpe). |
| `metrics.ts:208-226` | `calculateSharpeRatio` — mean/std annualized | `simple-statistics` (`mean`+`sampleStandardDeviation`) | mean+std internals | tolerance | S | **HIGH** | Judged metric. Golden-test. No single-call Sharpe in `ss`; compose. |
| `metrics.ts:242-274` | `calculateSortinoRatio` — downside semideviation | `simple-statistics` primitives | mean+downside-std | tolerance | S | **HIGH** | `ss` has no Sortino; keep the downside filter, swap mean/sqrt. Note `÷ returns.length` (not n−1) for downside — preserve exactly. |
| `metrics.ts:138-162` | `calculateMaxDrawdown` — peak-to-trough loop | (no lib) — keep, or share one impl | — | exact | S | **MED** | No clean `ss` equivalent. Real value is **de-duplication**: 3 copies exist (here, `monte-carlo.ts:444-461`, `simulator.ts:91-98`). Collapse to one shared fn, not a lib. |
| `metrics.ts:289-298` | `calculateCalmarRatio` — annRet/maxDD | — | — | exact | S | **LOW** | Two divisions + Infinity guard. Churn. |
| `metrics.ts:68-122` | `calculateAnnualizedReturn` / `calculateCAGR` — `Math.pow` geometric | — | — | exact | S | **LOW** | Trivial, well-tested, negative-base guards are domain logic. Keep. |
| `metrics.ts:491-505` | `percentile` — linear-interpolated | `simple-statistics` `quantileSorted` | the percentile fn | tolerance | S | **MED** | `ss` interpolates the same way; removes a fiddly index/frac block. Powers `calculateTailRatio`. |
| `metrics.ts:544-557` | `calculateRollingSharpe` — windowed | reuses swapped Sharpe | — | tolerance | S | **MED** | Falls out free once `calculateSharpeRatio` is routed through `ss`. |
| `metrics.ts:571-598` | `calculateRollingBeta` — cov/var per window | `simple-statistics` `sampleCovariance`/`sampleVariance` | inline cov+var loops | tolerance | S | **MED** | Replaces a manual double-loop; classic bug-surface. |
| `metrics.ts:310-472` | win-rate, profit-factor, expectancy, avg win/loss, consecutive streaks | — | — | exact | S | **LOW** | Pure trade-record reductions / counters. No lib gain; keep. |
| `fee-sensitivity.ts:115-126` | `annualizedSharpe` — **4th copy** of Sharpe | route through shared `metrics.ts` Sharpe | dup | tolerance | S | **HIGH** | Should not exist as a private copy. Import the canonical one (which itself moves to `ss`). |
| `fee-sensitivity.ts:94-109,129-140` | `compoundTotalReturn`, `mean`, `profitFactor` | `simple-statistics` `mean` + shared profit-factor | dup | tolerance | S | **MED** | De-dup against `metrics.ts`. |
| `vectorized-cross-sectional.ts:360-369` | `annualizedSharpeOf` — **3rd** Sharpe copy (honors `periodsPerYear`) | shared Sharpe core | dup | tolerance | S | **MED** | Comment at L302-304 already laments diverging from `metrics.ts`. Unify the std core. |
| `simulator.ts:91-120` | mark-to-market drawdown + MFE/MAE % | share `calculateMaxDrawdown` | dup DD loop | exact | S | **MED** | MFE/MAE stay bespoke (excursion logic); the DD peak-track is the 3rd copy. |
| `core/backtesting/rule-engine.ts:41-150` | SMA, EMA, RSI, MACD, Bollinger — hand-rolled indicator pre-calc inside the rule engine | (see `10-indicators.md`) | classic indicators | exact | M | **LOW** | These are tested classic indicators — README #3 says replacing them is churn. **Real action is de-dup with the main indicator library, not a 3rd-party swap.** Cross-ref `10-indicators.md`; do not double-spec. |
| `analysis.ts:170-184`, `analysis/analysis.ts` summary | mean/max/min across strategy results | `simple-statistics` `mean`/`max`/`min` | trivial reductions | exact | S | **LOW** | Cosmetic; low value. |
| `alpha-decay.ts:52-60` | decay-rate `%` formula | — | — | exact | S | **SKIP** | Domain formula, no lib analog. |
| `verdict.ts:236-248` | exposure-% approximation | — | — | exact | S | **SKIP** | Heuristic, no math lib fit. |

## Optimization search (grid / random / walk-forward)

| Module (file:line) | Hand-rolled | Candidate lib (API) | Replaces | Parity | Effort | Priority | Notes |
|---|---|---|---|---|---|---|---|
| `optimization/grid-search.ts:355-426` | cartesian product + range expansion | — (keep) | — | exact | S | **LOW** | Recursive cartesian + float-snap is correct and trivial. No mature TS combinatorics lib worth a dep; churn risk. |
| `optimization/random-search.ts:89-132` | `SeededRandom` (Mulberry32) | `@stdlib/random/base/mt19937` (+ seeded uniform) | the RNG | tolerance | M | **MED** | Mulberry32 is fine but un-tested-by-us; `@stdlib` MT19937 is battle-tested + reproducible. Re-seeding changes the sample sequence → re-baseline any seeded test. |
| `random-search.ts:345-387` | uniform / log-uniform / **Box-Muller** normal sampling | `@stdlib/random/base/{normal,uniform}` | distribution sampling | tolerance | M | **MED** | Box-Muller is the gnarly bit (README #3 target). `@stdlib` normal is robust. Tolerance — sequence changes. |
| `walk-forward.ts:439-494` | nested-recursion grid optimize on train window | reuse `GridSearchOptimizer` | dup combinatorics | exact | M | **LOW** | Re-implements grid-search inline. De-dup internally before reaching for a lib. Purge/embargo logic (L283-340) is bespoke and correct — keep. |
| `random-search.ts` overall | — | `fmin` (Nelder-Mead) | not a swap — an *upgrade* | divergent | L | **SKIP/defer** | `fmin` does derivative-free *local* optimization over continuous params; grid/random are global samplers. Different method → `divergent`. Only worth it if param-tuning becomes a bottleneck; not a parity swap. |

## Monte-Carlo / overfitting (resampling + distributions)

| Module (file:line) | Hand-rolled | Candidate lib (API) | Replaces | Parity | Effort | Priority | Notes |
|---|---|---|---|---|---|---|---|
| `monte-carlo.ts:397-403` | Fisher-Yates `shuffleArray` | `@stdlib/random/shuffle` (or keep) | the shuffle | tolerance | S | **MED** | Fisher-Yates is correct; value is the seeded-RNG behind it (next row), not the shuffle itself. |
| `monte-carlo.ts:408-415` | `createSeededRandom` — LCG | `@stdlib/random/base/mt19937` | weak LCG PRNG | tolerance | M | **MED** | An LCG is a *poor* MC PRNG (short period, lattice structure) — genuine quality bug-surface, not just churn. Swapping changes every seeded MC result → re-baseline. Pairs with random-search RNG unification. |
| `monte-carlo.ts:466-522` | `calculateDistribution` — percentiles (floor-index), std, CIs | `@stdlib/stats` quantile + `simple-statistics` std | percentile + std cores | tolerance | M | **MED** | The floor-index percentile here **diverges** from the interpolated one in `metrics.ts:491` — a real inconsistency. Unifying on one quantile impl is the win. |
| `monte-carlo.ts:577-616` | VaR / Expected-Shortfall / risk-of-ruin from sorted tail | `@stdlib/stats` quantile for VaR | the quantile picks | tolerance | M | **MED** | ES (mean of sub-VaR tail) stays bespoke; only the quantile index moves to lib. |
| `overfitting.ts:240-266` | median / mean / stdDev helpers | `simple-statistics` | dup stats | tolerance | S | **MED** | 4th copy of mean/std/median. De-dup. |
| `overfitting.ts:499-521` | `calculateRandomChanceProbability` — naive MC p-value | (keep) | — | exact | S | **LOW** | Domain heuristic over the score array; no lib analog. Uses bare `Math.random` (not seeded) — minor reproducibility wart worth fixing alongside the RNG unification. |
| `overfitting.ts:292-353` | parameter-sensitivity (CV per param value) | `simple-statistics` mean/std | inline reductions | tolerance | S | **LOW** | Light. |

## marketImpact / capacity (sqrt impact models)

| Module (file:line) | Hand-rolled | Candidate lib (API) | Replaces | Parity | Effort | Priority | Notes |
|---|---|---|---|---|---|---|---|
| `marketImpact.ts:103-114` | `realisticCostBps` — half-spread + √(ADV-frac) impact + fee | — | — | exact | S | **SKIP** | Square-root market-impact model is *domain* math (Almgren-style), no TS lib. Keep hand-rolled. |
| `marketImpact.ts:159-201,322-338` | log-spaced size grid, capacity sweep, efficient-frontier √-impact | `@stdlib` only for `linspace`/`logspace` grid gen | grid generation only | tolerance | S | **SKIP/LOW** | The financial math stays. Only the log-grid helper is lib-able and it's not worth a dep. |

## strategies/ (tier-1 + tier-2 + DSL)

**Verdict: LOW across the board.** Strategy files are thin signal logic — they compose shared
indicator helpers and apply threshold/heuristic confidence scoring, not statistical estimation.
Spot-checked `ensemble.ts` (voting/weighting), `stat-arb.ts` (z-score = `(price−sma)/stdDev`,
ROC velocity/acceleration — all inline arithmetic over already-computed indicators),
`squeeze-breakout.ts` and `hidden-divergence.ts` (delegate to `calculateSqueezeMomentum`,
`calculateDivergence`, `calculateVPT`). The only recurring numeric is z-score normalization,
which—if anything—belongs in the indicator library (`10-indicators.md`), not here. **No rows.**
Confidence boosters are point additions, not models. Adopting a lib in strategy files would be
pure churn with re-validation cost on every strategy. SKIP.

The DSL (`strategies/dsl/`) is interpreter/schema/storage — no numerics.

## Gaps (no mature TS lib — stays hand-rolled)

- **Square-root / Almgren market-impact** (`marketImpact.ts`) — domain finance, not in any stats lib.
- **Sortino / Calmar / profit-factor / expectancy** — no single-call lib API; compose from `simple-statistics` primitives (counted as the metric rows above, not gaps).
- **Walk-forward purge/embargo** (López de Prado, `walk-forward.ts:283-340`) — bespoke; no JS lib. Keep.
- **Robustness/verdict scoring** (`monte-carlo.ts:621-719`, `verdict.ts`) — heuristic rule tables, not statistics.

**Dataframe libs (`data-forge` / `danfojs`): SKIP.** Per README #4 — danfojs is TF.js-backed
(tens of MB, native bindings) and the backtest engine operates on plain `OHLC[]` / typed arrays
that map cleanly to existing loops. No tabular-join or groupby workload here justifies the
dependency weight in a CLI agent. `data-forge` is lighter but still buys nothing the current
array code doesn't already do. Neither earns a row.

---

## Priority counts

| Priority | Count | Rows |
|---|---|---|
| **HIGH** | 5 | `metrics.ts` Volatility / Sharpe / Sortino; `fee-sensitivity.ts` Sharpe dup; (the shared mean/std/Sharpe de-dup that underpins all four) |
| **MED** | 13 | maxDrawdown de-dup, percentile→`quantileSorted`, rollingSharpe, rollingBeta, cross-sectional Sharpe dup, simulator DD dup, fee-sensitivity mean/PF dup, random-search RNG, normal/Box-Muller sampling, MC seeded-RNG (LCG), MC shuffle, MC distribution/percentile, overfitting stats dup |
| **LOW** | 11 | Calmar, ann.return/CAGR, trade-stat reductions, rule-engine indicators (cross-ref 10), analysis.ts reductions, grid cartesian, walk-forward inline grid, MC p-value, param-sensitivity, marketImpact grid, all strategies (1 block) |
| **SKIP** | 6 | alpha-decay %, verdict exposure %, `fmin` upgrade, marketImpact √-impact models, dataframe libs, strategy-file adoption |

**One-line takeaway:** the win in this region is **not** new algorithms — it's collapsing
4× Sharpe / 4× mean-std / 3× max-drawdown / 2× percentile re-implementations onto one
`simple-statistics`-backed primitives module (HIGH, golden-tested against the judged metric),
plus replacing the weak hand-rolled LCG/Mulberry32 PRNGs with `@stdlib/random` MT19937 for
trustworthy reproducible Monte-Carlo (MED). Everything else is churn or domain math with no lib fit.
