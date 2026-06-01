/**
 * GARCH(1,1) volatility forecasting (Bollerslev 1986).
 *
 * Models conditional variance as
 *
 *     σ²_t = ω + α·ε²_{t-1} + β·σ²_{t-1}
 *
 * where ε_t = r_t − μ are the demeaned returns. Fits (ω, α, β) by maximizing
 * the Gaussian conditional log-likelihood, then exposes:
 *
 *   - the in-sample conditional-variance series,
 *   - the long-run (unconditional) variance ω/(1−α−β),
 *   - persistence α+β (vol-shock half-life), and
 *   - a multi-step-ahead variance forecast that mean-reverts toward the
 *     long-run variance.
 *
 * Complements the volatility-clustering test (`volatility/clustering.ts`,
 * which detects WHEN a GARCH model is warranted) and the Kalman vol filter
 * (`kalmanVolatility.ts`, the state-space alternative). Pure, deterministic
 * (fixed coarse grid + Nelder-Mead local refinement — NO Math.random).
 * NULL-on-insufficient-data (< 50 observations).
 *
 * Constraints enforced throughout: ω > 0, α ≥ 0, β ≥ 0, α+β < 1
 * (covariance-stationarity).
 */

const MIN_OBSERVATIONS = 50;
const PERSISTENCE_CEIL = 0.9995; // keep α+β strictly below 1
const VAR_FLOOR = 1e-12;

export interface GarchParams {
  omega: number;
  alpha: number;
  beta: number;
}

export interface GarchResult {
  params: GarchParams;
  /** Persistence α+β. Higher → vol shocks decay more slowly. */
  persistence: number;
  /** Unconditional variance ω/(1−α−β). */
  longRunVariance: number;
  /** ½-life of a vol shock in periods: ln(0.5)/ln(α+β). */
  shockHalfLifePeriods: number;
  /** In-sample conditional variance σ²_t for each observation. */
  conditionalVariance: number[];
  /** Latest conditional variance (the t+0 state). */
  currentVariance: number;
  /** Maximized Gaussian log-likelihood. */
  logLikelihood: number;
  sampleSize: number;
  /**
   * Multi-step-ahead variance forecast. E[σ²_{t+h}] reverts geometrically
   * toward the long-run variance at rate (α+β). `horizon` steps, 1-indexed.
   */
  forecast: (horizon: number) => number[];
  interpretation: string;
}

// ---------------------------------------------------------------------------
// Likelihood
// ---------------------------------------------------------------------------

/**
 * Filter the conditional-variance series for given params on demeaned
 * residuals. σ²_0 seeded with the sample variance of the residuals.
 */
function filterVariance(
  resid: number[],
  p: GarchParams,
  sampleVar: number,
): number[] {
  const n = resid.length;
  const cv: number[] = new Array(n);
  let prevVar = sampleVar > 0 ? sampleVar : VAR_FLOOR;
  let prevEps2 = sampleVar > 0 ? sampleVar : VAR_FLOOR; // ε²_{-1} seed
  for (let t = 0; t < n; t++) {
    const v = p.omega + p.alpha * prevEps2 + p.beta * prevVar;
    const vClamped = Math.max(v, VAR_FLOOR);
    cv[t] = vClamped;
    prevVar = vClamped;
    prevEps2 = resid[t]! * resid[t]!;
  }
  return cv;
}

/** Negative Gaussian log-likelihood (to minimize). +Infinity on invalid params. */
function negLogLikelihood(resid: number[], p: GarchParams, sampleVar: number): number {
  if (p.omega <= 0 || p.alpha < 0 || p.beta < 0) return Infinity;
  if (p.alpha + p.beta >= 1) return Infinity;
  const cv = filterVariance(resid, p, sampleVar);
  let nll = 0;
  for (let t = 0; t < resid.length; t++) {
    const v = cv[t]!;
    const e2 = resid[t]! * resid[t]!;
    // −2·logL_t = log(2π) + log(σ²_t) + ε²_t/σ²_t. Drop the constant.
    nll += Math.log(v) + e2 / v;
  }
  return 0.5 * nll;
}

// ---------------------------------------------------------------------------
// Deterministic optimizer: coarse grid → Nelder-Mead refinement
// ---------------------------------------------------------------------------

function clampParams(p: GarchParams, sampleVar: number): GarchParams {
  let alpha = Math.max(0, p.alpha);
  let beta = Math.max(0, p.beta);
  const sum = alpha + beta;
  if (sum >= PERSISTENCE_CEIL) {
    const scale = PERSISTENCE_CEIL / sum;
    alpha *= scale;
    beta *= scale;
  }
  // ω must stay positive; tie its floor to the data scale.
  const omega = Math.max(p.omega, VAR_FLOOR * Math.max(1, sampleVar));
  return { omega, alpha, beta };
}

/** Coarse grid over (α, β); ω implied from the long-run-variance identity. */
function gridSearch(resid: number[], sampleVar: number): GarchParams {
  const alphaGrid = [0.02, 0.05, 0.1, 0.15, 0.2, 0.3];
  const betaGrid = [0.5, 0.6, 0.7, 0.8, 0.85, 0.9, 0.95];
  let best: GarchParams = { omega: sampleVar * 0.1, alpha: 0.1, beta: 0.8 };
  let bestNll = Infinity;
  for (const alpha of alphaGrid) {
    for (const beta of betaGrid) {
      if (alpha + beta >= 1) continue;
      // Pin long-run variance to the sample variance: ω = σ²·(1−α−β).
      const omega = Math.max(VAR_FLOOR, sampleVar * (1 - alpha - beta));
      const p = { omega, alpha, beta };
      const nll = negLogLikelihood(resid, p, sampleVar);
      if (nll < bestNll) {
        bestNll = nll;
        best = p;
      }
    }
  }
  return best;
}

type Vec3 = [number, number, number]; // [omega, alpha, beta]

function toVec(p: GarchParams): Vec3 {
  return [p.omega, p.alpha, p.beta];
}
function toParams(v: Vec3): GarchParams {
  return { omega: v[0], alpha: v[1], beta: v[2] };
}

/**
 * Nelder-Mead downhill simplex on (ω, α, β). Deterministic initial simplex
 * built from fixed perturbations of the grid optimum. Penalty handled by
 * negLogLikelihood returning +Infinity outside the feasible region, with a
 * clamp applied before evaluation so the simplex walks the boundary cleanly.
 */
function nelderMead(
  resid: number[],
  sampleVar: number,
  start: GarchParams,
  iterations: number,
): GarchParams {
  const f = (v: Vec3): number => negLogLikelihood(resid, clampParams(toParams(v), sampleVar), sampleVar);

  const s0 = toVec(start);
  // Fixed, scale-aware perturbations (no randomness).
  const omegaStep = Math.max(VAR_FLOOR, Math.abs(s0[0]) * 0.5 + VAR_FLOOR);
  const simplex: Vec3[] = [
    s0,
    [s0[0] + omegaStep, s0[1], s0[2]],
    [s0[0], Math.min(0.6, s0[1] + 0.05), s0[2]],
    [s0[0], s0[1], Math.min(0.98, s0[2] + 0.05)],
  ];
  let fvals = simplex.map(f);

  const alphaR = 1; // reflection
  const gamma = 2; // expansion
  const rho = 0.5; // contraction
  const sigma = 0.5; // shrink

  for (let iter = 0; iter < iterations; iter++) {
    // Order by ascending f.
    const idx = [0, 1, 2, 3].sort((a, b) => fvals[a]! - fvals[b]!);
    const ordered = idx.map((i) => simplex[i]!);
    const orderedF = idx.map((i) => fvals[i]!);
    for (let i = 0; i < 4; i++) {
      simplex[i] = ordered[i]!;
      fvals[i] = orderedF[i]!;
    }

    const best = fvals[0]!;
    const worst = fvals[3]!;
    if (!Number.isFinite(best)) break;
    if (Math.abs(worst - best) < 1e-12 * (Math.abs(best) + 1e-12)) break;

    // Centroid of the best 3 (exclude worst).
    const cen: Vec3 = [0, 0, 0];
    for (let i = 0; i < 3; i++) {
      cen[0] += simplex[i]![0] / 3;
      cen[1] += simplex[i]![1] / 3;
      cen[2] += simplex[i]![2] / 3;
    }
    const worstV = simplex[3]!;

    const reflect: Vec3 = [
      cen[0] + alphaR * (cen[0] - worstV[0]),
      cen[1] + alphaR * (cen[1] - worstV[1]),
      cen[2] + alphaR * (cen[2] - worstV[2]),
    ];
    const fReflect = f(reflect);

    if (fReflect < fvals[0]!) {
      const expand: Vec3 = [
        cen[0] + gamma * (reflect[0] - cen[0]),
        cen[1] + gamma * (reflect[1] - cen[1]),
        cen[2] + gamma * (reflect[2] - cen[2]),
      ];
      const fExpand = f(expand);
      if (fExpand < fReflect) {
        simplex[3] = expand;
        fvals[3] = fExpand;
      } else {
        simplex[3] = reflect;
        fvals[3] = fReflect;
      }
    } else if (fReflect < fvals[2]!) {
      simplex[3] = reflect;
      fvals[3] = fReflect;
    } else {
      // Contraction toward the centroid.
      const contract: Vec3 = [
        cen[0] + rho * (worstV[0] - cen[0]),
        cen[1] + rho * (worstV[1] - cen[1]),
        cen[2] + rho * (worstV[2] - cen[2]),
      ];
      const fContract = f(contract);
      if (fContract < fvals[3]!) {
        simplex[3] = contract;
        fvals[3] = fContract;
      } else {
        // Shrink toward the best vertex.
        const b = simplex[0]!;
        for (let i = 1; i < 4; i++) {
          simplex[i] = [
            b[0] + sigma * (simplex[i]![0] - b[0]),
            b[1] + sigma * (simplex[i]![1] - b[1]),
            b[2] + sigma * (simplex[i]![2] - b[2]),
          ];
          fvals[i] = f(simplex[i]!);
        }
      }
    }
  }

  // Return the best feasible vertex.
  let bestIdx = 0;
  for (let i = 1; i < 4; i++) if (fvals[i]! < fvals[bestIdx]!) bestIdx = i;
  return clampParams(toParams(simplex[bestIdx]!), sampleVar);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface GarchOptions {
  /** Demean the returns before fitting. Default true. */
  demean?: boolean;
  /** Nelder-Mead iterations after the grid pass. Default 400. */
  iterations?: number;
}

/**
 * Fit a GARCH(1,1) model to a return series (NOT prices). Returns null when
 * the series is shorter than 50 observations or contains non-finite values.
 */
export function fitGarch(returns: number[], options: GarchOptions = {}): GarchResult | null {
  const n = returns.length;
  if (n < MIN_OBSERVATIONS) return null;
  for (const r of returns) if (!Number.isFinite(r)) return null;

  const demean = options.demean ?? true;
  const iterations = options.iterations ?? 400;

  let mean = 0;
  if (demean) {
    for (const r of returns) mean += r;
    mean /= n;
  }
  const resid = returns.map((r) => r - mean);

  let sampleVar = 0;
  for (const e of resid) sampleVar += e * e;
  sampleVar /= n;
  if (sampleVar <= 0) return null;

  const seed = gridSearch(resid, sampleVar);
  const params = nelderMead(resid, sampleVar, seed, iterations);

  const conditionalVariance = filterVariance(resid, params, sampleVar);
  const currentVariance = conditionalVariance[n - 1]!;
  const persistence = params.alpha + params.beta;
  const longRunVariance = persistence < 1 ? params.omega / (1 - persistence) : sampleVar;
  const shockHalfLifePeriods =
    persistence > 0 && persistence < 1 ? Math.log(0.5) / Math.log(persistence) : Infinity;

  const ll = -negLogLikelihood(resid, params, sampleVar);

  const forecast = (horizon: number): number[] => {
    const h = Math.max(0, Math.floor(horizon));
    const out: number[] = new Array(h);
    // σ²_{t+k} = LR + (α+β)^k · (σ²_{t} − LR).  k = 1..h.
    let v = currentVariance;
    for (let k = 0; k < h; k++) {
      v = params.omega + persistence * v; // one-step recursion
      out[k] = parseFloat(v.toFixed(12));
    }
    return out;
  };

  const regime =
    persistence >= 0.95
      ? "highly persistent (slow mean reversion — shocks linger)"
      : persistence >= 0.85
        ? "moderately persistent"
        : "weakly persistent (vol mean-reverts quickly)";
  const interpretation =
    `GARCH(1,1): ω=${params.omega.toExponential(2)}, α=${params.alpha.toFixed(3)}, ` +
    `β=${params.beta.toFixed(3)}, persistence α+β=${persistence.toFixed(3)} → ${regime}. ` +
    `Long-run vol ${(Math.sqrt(longRunVariance) * 100).toFixed(2)}%/period, ` +
    `current vol ${(Math.sqrt(currentVariance) * 100).toFixed(2)}%/period, ` +
    `shock half-life ${Number.isFinite(shockHalfLifePeriods) ? shockHalfLifePeriods.toFixed(1) + " periods" : "∞"}.`;

  return {
    params: {
      omega: parseFloat(params.omega.toFixed(12)),
      alpha: parseFloat(params.alpha.toFixed(6)),
      beta: parseFloat(params.beta.toFixed(6)),
    },
    persistence: parseFloat(persistence.toFixed(6)),
    longRunVariance: parseFloat(longRunVariance.toFixed(12)),
    shockHalfLifePeriods: Number.isFinite(shockHalfLifePeriods)
      ? parseFloat(shockHalfLifePeriods.toFixed(2))
      : Infinity,
    conditionalVariance: conditionalVariance.map((v) => parseFloat(v.toFixed(12))),
    currentVariance: parseFloat(currentVariance.toFixed(12)),
    logLikelihood: parseFloat(ll.toFixed(4)),
    sampleSize: n,
    forecast,
    interpretation,
  };
}
