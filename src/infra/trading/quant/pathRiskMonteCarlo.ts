/**
 * Path-risk Monte Carlo — "a backtest is ONE path; we need to see 10,000."
 *
 * A single backtest is one realization of history. The question that decides survival
 * isn't the median outcome — it's: can the strategy survive the 5th-percentile PATH for
 * the whole contest without intervention? This module answers that by resampling many
 * synthetic paths from the strategy's own per-bar returns and reading the tail.
 *
 * The well-known trap (and why Gordon's existing `backtest/analysis/monte-carlo.ts` is
 * NOT enough here): vanilla Monte Carlo that SHUFFLES or draws IID-normal returns
 * destroys serial correlation + volatility clustering, so it badly UNDER-states tail
 * drawdown. Real losing streaks cluster. So we provide three resamplers, ordered by
 * realism, and report all three so the tail-widening is explicit:
 *   1. iidBootstrap      — resample single returns independently (the optimistic baseline).
 *   2. stationaryBootstrap — Politis-Romano: resample BLOCKS of geometric-random length,
 *                            preserving autocorrelation + vol clustering (the realistic one).
 *   3. garchPath          — fit GARCH(1,1) and simulate vol-clustered paths from the fitted
 *                           dynamics with resampled standardized residuals (fat tails kept).
 *
 * The output is the distribution of {total return, max drawdown} across N paths, with the
 * 5th/50th/95th percentiles and P(drawdown beyond a survival threshold) — the numbers a
 * quant desk uses to decide "trade it or not", regardless of the median.
 *
 * Pure: returns in, distribution out. Deterministic given a seed (no Math.random).
 */

import { fitGarch } from "../../../core/alpha/garch.ts";

// ── Seeded RNG (LCG + Box-Muller) — reproducible, no Math.random ─────────────
export function makeRng(seed: number): () => number {
  let s = (seed >>> 0) || 1;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}
function gauss(rng: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ── Path statistics ──────────────────────────────────────────────────────────
/** Max drawdown of a per-bar return path, as a positive fraction (0.20 = 20% DD). */
export function pathMaxDrawdown(rets: number[]): number {
  let eq = 1;
  let peak = 1;
  let mdd = 0;
  for (const r of rets) {
    eq *= 1 + r;
    if (eq > peak) peak = eq;
    const dd = peak > 0 ? (peak - eq) / peak : 0;
    if (dd > mdd) mdd = dd;
  }
  return mdd;
}
export function pathTotalReturn(rets: number[]): number {
  let eq = 1;
  for (const r of rets) eq *= 1 + r;
  return eq - 1;
}

// ── Resamplers ────────────────────────────────────────────────────────────────

/** IID bootstrap: draw `pathLen` returns independently with replacement. */
export function iidBootstrap(returns: number[], pathLen: number, rng: () => number): number[] {
  const n = returns.length;
  const out = new Array<number>(pathLen);
  for (let i = 0; i < pathLen; i++) out[i] = returns[Math.floor(rng() * n)]!;
  return out;
}

/**
 * Stationary bootstrap (Politis & Romano 1994). Concatenate blocks whose lengths are
 * geometric(p) with mean block 1/p, each starting at a uniform-random index and wrapping
 * circularly. Preserves short-range autocorrelation + volatility clustering, while the
 * random block length keeps the resampled series stationary (no fixed-block artifacts).
 */
export function stationaryBootstrap(returns: number[], pathLen: number, meanBlock: number, rng: () => number): number[] {
  const n = returns.length;
  const p = meanBlock > 1 ? 1 / meanBlock : 1; // P(start a new block each step)
  const out = new Array<number>(pathLen);
  let idx = Math.floor(rng() * n);
  for (let i = 0; i < pathLen; i++) {
    if (i === 0 || rng() < p) idx = Math.floor(rng() * n); // start a fresh block
    else idx = (idx + 1) % n; // continue the current block (wrap)
    out[i] = returns[idx]!;
  }
  return out;
}

/**
 * GARCH(1,1) path. Fit the conditional-variance dynamics to the returns, then simulate
 * forward: σ²_t = ω + α·ε²_{t-1} + β·σ²_{t-1}, with shocks drawn by resampling the
 * empirical STANDARDIZED residuals (keeps the real fat tails) around the mean return.
 * Falls back to the stationary bootstrap if GARCH won't fit (too few obs / non-stationary).
 */
export function garchPath(returns: number[], pathLen: number, rng: () => number): number[] {
  const fit = fitGarch(returns);
  if (!fit || !(fit.currentVariance > 0)) {
    return stationaryBootstrap(returns, pathLen, Math.max(2, Math.round(Math.sqrt(returns.length))), rng);
  }
  const mu = returns.reduce((a, b) => a + b, 0) / returns.length;
  const { omega, alpha, beta } = fit.params;
  // Standardized residuals zᵢ = (rᵢ − μ)/σᵢ from the in-sample conditional variances.
  const z: number[] = [];
  for (let i = 0; i < returns.length; i++) {
    const sd = Math.sqrt(fit.conditionalVariance[i] ?? fit.currentVariance);
    if (sd > 0) z.push((returns[i]! - mu) / sd);
  }
  const drawZ = z.length > 1 ? () => z[Math.floor(rng() * z.length)]! : () => gauss(rng);

  const out = new Array<number>(pathLen);
  let varT = fit.currentVariance;
  let prevShock2 = fit.currentVariance;
  for (let i = 0; i < pathLen; i++) {
    varT = omega + alpha * prevShock2 + beta * varT;
    if (!(varT > 0)) varT = fit.longRunVariance > 0 ? fit.longRunVariance : 1e-12;
    const shock = Math.sqrt(varT) * drawZ();
    out[i] = mu + shock;
    prevShock2 = shock * shock;
  }
  return out;
}

/**
 * Antithetic GARCH pair (variance reduction). Generates two paths driven by NEGATIVELY
 * CORRELATED innovations, so averaging over pairs cuts the variance of MEAN-type estimators
 * (expected return, expected shortfall) — the classic antithetic win.
 *
 * The naive antithetic (reflect each return about μ: rₜ → 2μ − rₜ) is WRONG here: it is only
 * unbiased when the innovation distribution is symmetric, and real standardized residuals are
 * skewed — so the reflection biases the mean. Instead we antithetic the UNIFORM draw via the
 * inverse-CDF: with the residual pool sorted ascending, path A draws residual zₛ[⌊u·L⌋] and
 * path B draws zₛ[⌊(1−u)·L⌋]. Both u and 1−u are Uniform(0,1), so EACH path is still a valid
 * draw from the empirical residual distribution (unbiased, fat tails + skew intact); but
 * because the pool is sorted, u↔1−u pairs low residuals with high ones → the two paths are
 * negatively correlated. Each path runs its own variance recursion (the realistic vol paths
 * differ), which is correct.
 *
 * It does NOT meaningfully tighten the drawdown QUANTILES: max-drawdown is a non-monotone path
 * functional, so the pair isn't negatively correlated in drawdown. That asymmetry is why this
 * feeds only the mean-type outputs. (No antithetic for the iid / stationary bootstraps — they
 * resample real returns by index; the inverse-CDF trick is GARCH-only.)
 */
export function garchAntitheticPair(returns: number[], pathLen: number, rng: () => number): [number[], number[]] {
  const fit = fitGarch(returns);
  if (!fit || !(fit.currentVariance > 0)) {
    const mb = Math.max(2, Math.round(Math.sqrt(returns.length)));
    return [stationaryBootstrap(returns, pathLen, mb, rng), stationaryBootstrap(returns, pathLen, mb, rng)];
  }
  const mu = returns.reduce((a, b) => a + b, 0) / returns.length;
  const { omega, alpha, beta } = fit.params;
  const z: number[] = [];
  for (let i = 0; i < returns.length; i++) {
    const sd = Math.sqrt(fit.conditionalVariance[i] ?? fit.currentVariance);
    if (sd > 0) z.push((returns[i]! - mu) / sd);
  }
  z.sort((p, q) => p - q); // sorted pool → inverse-CDF antithetic on the uniform draw
  const L = z.length;
  const floorVar = (): number => (fit.longRunVariance > 0 ? fit.longRunVariance : 1e-12);

  const a = new Array<number>(pathLen);
  const b = new Array<number>(pathLen);
  let varA = fit.currentVariance;
  let varB = fit.currentVariance;
  let ps2A = fit.currentVariance;
  let ps2B = fit.currentVariance;
  for (let i = 0; i < pathLen; i++) {
    const u = rng();
    const za = L > 1 ? z[Math.min(L - 1, Math.floor(u * L))]! : gauss(rng);
    const zb = L > 1 ? z[Math.min(L - 1, Math.floor((1 - u) * L))]! : -za;
    varA = omega + alpha * ps2A + beta * varA;
    if (!(varA > 0)) varA = floorVar();
    varB = omega + alpha * ps2B + beta * varB;
    if (!(varB > 0)) varB = floorVar();
    const shockA = Math.sqrt(varA) * za;
    const shockB = Math.sqrt(varB) * zb;
    a[i] = mu + shockA;
    b[i] = mu + shockB;
    ps2A = shockA * shockA;
    ps2B = shockB * shockB;
  }
  return [a, b];
}

// ── Aggregation ────────────────────────────────────────────────────────────────

export type ResampleMethod = "iid" | "stationary" | "garch";

export interface PathRiskConfig {
  /** Number of simulated paths. Default 10_000. */
  nPaths?: number;
  /** Path length (bars). Default = the input length (one contest-window worth). */
  pathLen?: number;
  /** Mean block length for the stationary bootstrap. Default = √n (rule of thumb). */
  meanBlock?: number;
  /** Drawdown beyond which a path is "ruin" for P(breach). Default 0.20. */
  ruinDrawdown?: number;
  /** RNG seed. Default 12345. */
  seed?: number;
  /**
   * Antithetic variance reduction (GARCH method only; ignored otherwise). Generates paths in
   * mirrored pairs so the MEAN-type estimators (`expectedReturn`, `expectedShortfall5`)
   * converge with a lower standard error for the same path count. Default false (off), so
   * the drawdown distribution + all percentiles stay byte-identical to a plain run.
   */
  antithetic?: boolean;
}

export interface PathRiskResult {
  method: ResampleMethod;
  nPaths: number;
  pathLen: number;
  /** Total-return percentiles across paths. */
  returnP5: number;
  returnP50: number;
  returnP95: number;
  /** Max-drawdown percentiles (positive fractions). p95 = the BAD-path drawdown. */
  drawdownP50: number;
  drawdownP95: number;
  drawdownP99: number;
  /** Worst single-path drawdown observed. */
  drawdownWorst: number;
  /** Fraction of paths whose drawdown exceeded `ruinDrawdown`. */
  probRuin: number;
  /** Mean total return across paths (a mean estimator — sharpened by antithetic). */
  expectedReturn: number;
  /** Expected shortfall (CVaR) at 5%: the mean total return of the worst 5% of paths. */
  expectedShortfall5: number;
  /**
   * Standard error of `expectedReturn`. With `antithetic`, computed over mirrored-pair
   * means (the honest SE of the antithetic estimator), so it drops below the plain
   * √-law SE for the same path count — that gap IS the variance reduction.
   */
  returnStdError: number;
  /** Whether antithetic variance reduction was applied (GARCH only). */
  antithetic: boolean;
}

function percentile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))));
  return sorted[i]!;
}

const arrMean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** Standard error of the mean: √(sample-variance / n). */
function plainStdError(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = arrMean(xs);
  const v = xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(v / xs.length);
}

/**
 * Standard error of the antithetic mean estimator: treat each mirrored pair's average as
 * one iid observation, so the negative within-pair correlation is folded into a lower SE.
 * `xs` must be in generation order [a₀, b₀, a₁, b₁, …].
 */
function pairedStdError(xs: number[]): number {
  const pairMeans: number[] = [];
  for (let k = 0; k + 1 < xs.length; k += 2) pairMeans.push((xs[k]! + xs[k + 1]!) / 2);
  if (pairMeans.length < 2) return 0;
  const m = arrMean(pairMeans);
  const v = pairMeans.reduce((s, x) => s + (x - m) ** 2, 0) / (pairMeans.length - 1);
  return Math.sqrt(v / pairMeans.length);
}

function resample(method: ResampleMethod, returns: number[], pathLen: number, meanBlock: number, rng: () => number): number[] {
  if (method === "iid") return iidBootstrap(returns, pathLen, rng);
  if (method === "garch") return garchPath(returns, pathLen, rng);
  return stationaryBootstrap(returns, pathLen, meanBlock, rng);
}

/** Run the path-risk Monte Carlo for one resampling method. */
export function monteCarloPathRisk(returns: number[], method: ResampleMethod, config: PathRiskConfig = {}): PathRiskResult {
  const nPathsReq = config.nPaths ?? 10_000;
  const pathLen = config.pathLen ?? returns.length;
  const meanBlock = config.meanBlock ?? Math.max(2, Math.round(Math.sqrt(returns.length)));
  const ruin = config.ruinDrawdown ?? 0.2;
  const rng = makeRng(config.seed ?? 12345);
  const useAntithetic = (config.antithetic ?? false) && method === "garch";

  const retsRaw: number[] = []; // generation order — preserved for the paired SE
  const dds: number[] = [];
  let ruinCount = 0;
  const record = (path: number[]): void => {
    retsRaw.push(pathTotalReturn(path));
    const dd = pathMaxDrawdown(path);
    dds.push(dd);
    if (dd > ruin) ruinCount++;
  };

  let nPaths: number;
  if (useAntithetic) {
    const nPairs = Math.max(1, Math.floor(nPathsReq / 2));
    nPaths = nPairs * 2;
    for (let p = 0; p < nPairs; p++) {
      const [a, b] = garchAntitheticPair(returns, pathLen, rng);
      record(a);
      record(b);
    }
  } else {
    nPaths = nPathsReq;
    for (let p = 0; p < nPaths; p++) record(resample(method, returns, pathLen, meanBlock, rng));
  }

  // Mean-type estimators (computed in generation order — this is where antithetic pays off).
  const expectedReturn = arrMean(retsRaw);
  const returnStdError = useAntithetic ? pairedStdError(retsRaw) : plainStdError(retsRaw);

  const rets = [...retsRaw].sort((a, b) => a - b);
  dds.sort((a, b) => a - b);
  const tailN = Math.max(1, Math.ceil(0.05 * rets.length));
  const expectedShortfall5 = arrMean(rets.slice(0, tailN)); // CVaR₅: mean of the worst 5% paths

  return {
    method,
    nPaths,
    pathLen,
    returnP5: percentile(rets, 0.05),
    returnP50: percentile(rets, 0.5),
    returnP95: percentile(rets, 0.95),
    drawdownP50: percentile(dds, 0.5),
    drawdownP95: percentile(dds, 0.95),
    drawdownP99: percentile(dds, 0.99),
    drawdownWorst: dds[dds.length - 1]!,
    probRuin: ruinCount / nPaths,
    expectedReturn,
    expectedShortfall5,
    returnStdError,
    antithetic: useAntithetic,
  };
}

/** Run all three methods so the tail-widening (iid → stationary → garch) is explicit. */
export function pathRiskComparison(returns: number[], config: PathRiskConfig = {}): Record<ResampleMethod, PathRiskResult> {
  return {
    iid: monteCarloPathRisk(returns, "iid", config),
    stationary: monteCarloPathRisk(returns, "stationary", config),
    garch: monteCarloPathRisk(returns, "garch", config),
  };
}
