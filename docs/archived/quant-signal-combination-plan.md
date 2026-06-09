# Quant Signal Combination — Implementation Plan

Four primitives surfaced by the IR = IC × √N article. Concrete plans for build, not spec entries.

Naming: SC = Signal Combination batch. Same convention as PE / WW / TM / AR / etc.

---

## Sequencing

Driven by data readiness, not novelty:

| Wave | Item | Why now | Effort |
|---|---|---|---|
| 1 | **SC3 effectiveNEstimator** | Pure compute on existing shadow-mode observations. Runs today. Resolves the deck claim "12 primitives in the chain — but how many are independent?" | 2-3 days |
| 1 | **SC4 empiricalKelly** | Bootstrap on existing backtest returns. Integrates into WW1 sizer as a discount factor. No paper-mode dependency. | 3-4 days |
| 2 | **SC2 informationCoefficient** | Needs paired (prediction, realized-outcome) tuples. Gated on TM3 decisionLog stage population + first paper-mode runs. | 3 days |
| 2 | **SC1 signalCombinationEngine** | Replaces TM1 naive confluence count. Needs ≥40 closed trades per signal to be meaningful. | ~1 week |

Total: ~3 weeks of focused work, sequenced so the first two ship inside the next two weeks and the second two ship once paper-mode produces data.

---

## SC1. Signal Combination Engine

**Module:** `src/infra/trading/quant/signalCombination.ts`
**Flag:** `GORDON_SIGNAL_COMBINATION`

### Purpose

Replace TM1 confluenceScorer's naive present/absent count with the 11-step independent-residual weighting from the article. Compresses N correlated signals into the effective IR-maximizing weighted score.

### API

```ts
interface SignalSeries {
  signalId: string;
  returns: number[];     // realized return when this signal fired (or shadow proxy)
  predictions?: number[]; // optional signed prediction strength at fire-time
}

interface CombinationInput {
  signals: ReadonlyArray<SignalSeries>;
  lookbackPeriods?: number; // default 20
  eta?: number;             // weight scale, default 1.0
}

interface CombinationResult {
  weights: Record<string, number>;
  effectiveN: number;       // from SC3
  rawN: number;
  combinedScore?: number;   // sum(weight × current-signal-value)
  diagnostics: {
    independentEdge: Record<string, number>; // residuals from cross-sectional regression
    sigma: Record<string, number>;
    pairwiseCorrelation: number[][];
  };
}

export function combineSignals(input: CombinationInput): CombinationResult;
```

### 11-step pipeline (article's structure, encoded)

1. Collect return series `R(i, s)` per signal i over periods s.
2. Serial demean: `X(i, s) = R(i, s) − mean(R(i))`.
3. Sample variance: `σ(i)² = mean(X(i, s)²)`.
4. Normalize: `Y(i, s) = X(i, s) / σ(i)`.
5. Drop most recent observation (avoid look-ahead in current bar).
6. Cross-sectional demean: `Λ(i, s) = Y(i, s) − mean_j(Y(j, s))`.
7. Drop one more period (sample efficiency).
8. Expected forward return: `E_norm(i) = E(i) / σ(i)` where `E(i)` is recent-window mean.
9. Regress `E_norm` on `Λ` → residuals `e(i)`. These are each signal's independent contribution after shared variance is stripped.
10. Weight: `w(i) = η × e(i) / σ(i)`.
11. Normalize: scale so `Σ|w(i)| = 1`.

### Tests

- Identical signals → effective N collapses to 1; weight redistributes evenly.
- Independent signals with same σ → equal weights.
- One signal with high independent edge → dominant weight.
- Wright surgeon scenario from WW3: low-σ high-edge signal beats high-σ noisy one.
- Numerical: rank-deficient correlation matrix (use Moore-Penrose pseudoinverse).
- Empty input → zero weights; single signal → weight = 1.

### Wire points

- Replace TM1 `scoreConfluences()` once history is sufficient. TM1 stays as the cold-start fallback when `closedTradesPerSignal < 40`.
- Output feeds WW1 pathDependentSizer's tier selection (combinedScore → tier mapping).
- Composes with WW8 convictionCalibrationGate — combined score becomes a more rigorous conviction signal.

### Data dependency

≥40 closed trades per signal to compute meaningful per-signal regression. Until paper-mode produces this, function exists but returns equal-weight fallback with a `dataInsufficient: true` flag.

### Effort

~1 week. Linear algebra via existing numerically-stable matrix ops. The harder part is the cold-start fallback logic + the integration with TM1.

---

## SC2. Information Coefficient Tracking

**Module:** `src/infra/trading/quant/informationCoefficient.ts`
**Flag:** `GORDON_IC_TRACKER`

### Purpose

For each signal in Gordon's chain (TM1 confluences + WW15 marginal participant + WW16 edge attribution + the rest), compute the rolling Pearson correlation between its prediction strength at fire-time and the realized R-multiple of the resulting trade.

### API

```ts
interface SignalPrediction {
  signalId: string;
  predictionStrength: number; // signed; positive = bullish, magnitude = confidence
  predictedAt: string;        // ISO timestamp
  realizedRMultiple?: number; // populated after trade closes
  tradeId: string;
}

interface ICInput {
  observations: ReadonlyArray<SignalPrediction>;
  windowSize?: number; // default 60
  minSampleForSignificance?: number; // default 30
}

interface ICResult {
  byId: Record<string, {
    rollingIC: number;
    sampleSize: number;
    significant: boolean;
    significance: number; // |IC| × sqrt(N) — proxy z-score
    trend: 'improving' | 'stable' | 'degrading';
  }>;
  fleetIC: number; // average across all signals
}

export function computeRollingIC(input: ICInput): ICResult;
```

### Tests

- Perfect predictor → IC ≈ 1, significant.
- Pure noise → IC ≈ 0, not significant.
- Inverse predictor → IC ≈ -1, significant (retire this signal — it's actively wrong).
- Small sample → significant = false even with high apparent IC.
- Trend detection: 60-period window split into halves, comparison.

### Wire points

- Consume from `decisionLog` with `stage="closure"` (TM3 wiring) — each closed decision has the prediction strengths that fired at planning time and the realized R-multiple.
- Output feeds WW22 edgeDecayMonitor: an individually-degrading signal's IC trend going `improving → stable → degrading` should trigger the retire verdict.
- Output feeds SC1 signalCombinationEngine: per-signal IC is the σ-normalized residual input.

### Data dependency

Same as SC1: needs paired (prediction, realized) tuples. Gated on TM3 stage population in `recordDecision` callsites + first paper-mode runs producing realized outcomes.

### Effort

~3 days. Straight Pearson + windowing. Most of the work is the data pipeline reading from decisionLog correctly.

---

## SC3. Effective-N Estimator — ship first

**Module:** `src/infra/trading/quant/effectiveN.ts`
**Flag:** `GORDON_EFFECTIVE_N`

### Purpose

Given a set of signals, compute the effective number of independent ones via eigenvalue decomposition of the correlation matrix. **The diagnostic for "Gordon's plan chain runs 12 primitives — but how many are actually independent?"**

### API

```ts
interface EffectiveNInput {
  signals?: SignalSeries[];     // raw series → compute correlation
  correlationMatrix?: number[][]; // or pass directly
  labels?: ReadonlyArray<string>;
}

interface EffectiveNResult {
  rawN: number;
  effectiveN: number;
  participationRatio: number;
  averagePairwiseAbsCorr: number;
  redundantPairs: Array<{ a: string; b: string; r: number }>; // |r| > 0.7
  reasoning: string;
}

export function computeEffectiveN(input: EffectiveNInput): EffectiveNResult;
```

### Math

Two formulas, return both:

- **Participation ratio (preferred):** `N_eff = (Σ λᵢ)² / Σ λᵢ²` where λᵢ are eigenvalues of the correlation matrix. Handles arbitrary correlation structures.
- **Simple approximation:** `N_eff = N / (1 + (N-1) × ρ̄)` where ρ̄ is average pairwise absolute correlation. Faster, less accurate for non-uniform correlations.

### Tests

- N orthogonal signals → `effectiveN ≈ N`.
- N identical signals → `effectiveN ≈ 1`.
- 2 perfectly correlated + 1 independent → `effectiveN ≈ 2`.
- 12 partially-correlated signals (matching Gordon's chain shape) → expected `effectiveN` in 5-8 range, with diagnostic surfaces.
- Numerical stability: near-singular matrices via SVD-based eigendecomposition.

### Wire points

- **Diagnostic surface immediately:** add to `/status` slash command output. "Chain depth: 12 primitives, effective independent: 6.3, redundant pairs: …".
- **Deck claim:** the number replaces the unsubstantiated "12 independent gates" with a measured one.
- Composes with WW20 correlationRegimeMonitor (which already exists for asset-correlation; this generalizes to signal-correlation).
- Becomes the N in SC1's IR = IC × √N computation.

### Data dependency

**None.** Can run today on:

1. Synthetic test inputs (validation).
2. The structured-observation history in Axiom (each gate's verdict-per-plan-event is a signal series).
3. The shadow-mode verdicts already emitted by `agent-subscriptions.ts`.

The pairwise correlation of the boolean / numeric outputs of the 12 plan_ready gates is computable from the existing observation stream the moment paper-mode runs any plans through.

### Effort

~2-3 days. The math is simpler than SC1. The work is mostly the data extraction from the observation store + the diagnostic surfacing in `/status`.

### Strategic value

**Highest-leverage of the four.** It's the only one of the four that produces a usable artifact (a number) without any new data. That number is concrete deck-fodder, concrete moat-articulation, and concrete steering signal for which gates to merge / drop / strengthen.

---

## SC4. Empirical Kelly with Monte Carlo Edge Uncertainty

**Module:** `src/infra/trading/quant/empiricalKelly.ts`
**Flag:** `GORDON_EMPIRICAL_KELLY`

### Purpose

Standard Kelly assumes known win-rate and payoff. Empirical Kelly discounts the fraction by the bootstrap-estimated variance of the edge:

```
f_empirical = max(f_kelly × (1 − CV_edge), 0)
```

Where `CV_edge = stddev(bootstrap_edge_estimates) / |mean|`. The more variable your edge estimate is under resampling, the more you shrink the bet.

### API

```ts
interface EmpiricalKellyInput {
  winRate: number;
  payoffRatio: number;
  historicalReturns: ReadonlyArray<number>; // R-multiples, signed
  bootstrapSamples?: number; // default 10000
  seed?: number; // deterministic tests
}

interface EmpiricalKellyResult {
  fKelly: number;
  fEmpirical: number;
  cvEdge: number;
  meanBootstrapEdge: number;
  bootstrapStddev: number;
  edgeUncertainty: 'low' | 'medium' | 'high' | 'untradable';
  recommendedFraction: number; // = fEmpirical
}

export function empiricalKelly(input: EmpiricalKellyInput): EmpiricalKellyResult;
```

### Math

- `f_kelly = (p × b − q) / b` where `q = 1 - p`.
- Bootstrap: 10,000 resamples-with-replacement of `historicalReturns`.
- For each resample compute `edge_i = mean(resample)`.
- `CV_edge = stddev(edge_estimates) / |mean(edge_estimates)|`.
- `f_empirical = max(f_kelly × (1 − CV_edge), 0)`.
- Uncertainty bands: `CV < 0.2 → low`, `0.2-0.5 → medium`, `0.5-1.0 → high`, `>= 1.0 → untradable` (return 0).

### Tests

- Known good strategy (60% win, 1.5 payoff, low variance) → `f_empirical` close to `f_kelly`.
- High-uncertainty edge → `f_empirical` shrinks dramatically.
- Negative edge → `f_empirical = 0`.
- `CV_edge ≥ 1.0` → `f_empirical = 0`, marked untradable.
- Deterministic with seed.
- Wright's WTI scenario from WW1 with realistic noise → check `f_empirical` is sensible vs WW1's flat tier multiplier.

### Wire points

- Plug into WW1 pathDependentSizer as an *additional shrink factor* on top of the tier multiplier. New optional param `useEmpiricalKelly: boolean` on `sizePosition`.
- Composes with WW24 backtestTax — both shrink raw estimates, but in complementary ways: backtestTax shrinks via fixed % (15%/25%), empirical Kelly shrinks via data-driven variance. Apply both: `sized × (1 − tax) × (1 − CV_edge)`.
- Composes with Q4 multipleTestingTracker — both deal with statistical confidence in edge.
- Surface in backtest formatter alongside drag / decomposition / decay.

### Data dependency

Partial. Can run today on existing backtest returns. For live calibration with realized fills, gated on paper-mode.

### Effort

~3-4 days. Pure math + the WW1 integration. Bootstrap performance for 10k resamples × ~100 returns is sub-second.

---

## How the four compose

```
                    ┌──────────────────────────┐
                    │  Existing primitives:    │
                    │  TM1 confluenceScorer    │
                    │  WW22 edgeDecayMonitor   │
                    │  WW20 correlationRegime  │
                    │  WW1 pathDependentSizer  │
                    │  WW24 backtestTax        │
                    │  Q4 multipleTestingTrack │
                    └──────────────────────────┘
                                ▲
                                │
                ┌───────────────┼───────────────┐
                │               │               │
        ┌───────┴──────┐ ┌──────┴───────┐ ┌─────┴────────┐
        │ SC3 effN     │ │ SC2 IC       │ │ SC4 empKelly │
        │ (ship now)   │ │ (paper data) │ │ (backtest++) │
        └──────────────┘ └──────────────┘ └──────────────┘
                ▲               ▲               ▲
                └───────────────┼───────────────┘
                                │
                        ┌───────┴────────┐
                        │ SC1 combination│
                        │ (paper data,   │
                        │  ~1 week)      │
                        └────────────────┘
```

SC3 stands alone — it's the diagnostic that produces a number today.
SC4 plugs into WW1's sizing math.
SC2 + SC1 are gated on paper-mode realized-outcome data; they upgrade TM1 and WW22.

---

## What this batch is NOT

- **Not new categories of signal.** Gordon already has momentum / mean-reversion / regime / microstructure / factor primitives. This batch is about *combining* them rigorously.
- **Not a replacement for the existing chain.** TM1 stays as cold-start fallback. WW1 still drives final sizing. The combination engine produces a *more rigorous score* once data accumulates.
- **Not a substitute for paper-mode runs.** SC2 + SC1 only become meaningful with real outcome data. The plan ships SC3 + SC4 first precisely because they don't need that data.

---

## Open questions to resolve before building

1. **Where do "signal series" come from before paper-mode?** Options: (a) backtest replay across all 12 gates, (b) shadow-mode structured observations from `agent-subscriptions.ts`, (c) synthetic test fixtures. Probably (a) + (c) for SC1/SC3 validation, (b) for live SC2/SC4 calibration. Need to decide which by start of build.

2. **TM1 fallback policy.** When `closedTradesPerSignal < 40`, SC1 returns equal-weight. Should TM1 keep firing in that regime, or should SC1 always replace TM1's output? Recommend: SC1 always called, falls back internally; TM1 retired once SC1 ships.

3. **Diagnostic surfacing.** Where does SC3's effective-N number land? `/status` slash command output is natural. Also: backtest formatter alongside other quality metrics. Deck claim updates downstream.

4. **Bootstrap performance for empiricalKelly.** Default 10k samples × ~100 returns is fast (< 100ms in JS). At larger historical sets (~10k returns) it's noticeable. Decide whether to expose `bootstrapSamples` as runtime-configurable.

5. **Naming conflict check.** `hurstExponent.ts` exists both in `trading/ops/` (WW14) and `trading/quant/`. New modules should land in `trading/quant/` to keep the math layer separate from the trading-discipline layer.

---

## Next step

Build SC3 first. ~2-3 days, no data dependency, produces a deck-quality number, and exercises the structured-observation extraction pipeline that SC1/SC2 will also need. Then SC4 in parallel (separate file, separate WW1-integration). SC2 + SC1 wait for paper-mode.
