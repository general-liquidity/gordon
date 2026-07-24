/**
 * Empirical Kelly with Monte Carlo Edge Uncertainty (GORDON_EMPIRICAL_KELLY).
 *
 * Standard Kelly assumes known win-rate and payoff:
 *   f_kelly = (p × b − q) / b
 *
 * Reality has estimation error. Empirical Kelly discounts the Kelly
 * fraction by the bootstrap-estimated coefficient of variation of the
 * edge:
 *   CV_edge   = stddev(bootstrap_edge_estimates) / |mean|
 *   f_empirical = max(f_kelly × (1 − CV_edge), 0)
 *
 * CV ≥ 1 → the edge wobbles as much as it averages → untradable; return 0.
 *
 * Complementary to WW24 backtestTax: backtestTax shrinks raw estimates
 * via a fixed heuristic (15% on win-rate, 25% on payoff); empirical Kelly
 * shrinks via the variance the data itself reveals under resampling.
 * Apply both as independent shrinks for the most conservative sizing.
 */

export type EdgeUncertainty = "low" | "medium" | "high" | "untradable";

export interface EmpiricalKellyInput {
  winRate: number;
  payoffRatio: number;
  historicalReturns: ReadonlyArray<number>;
  /** Bootstrap resample count. Default 10000. */
  bootstrapSamples?: number;
  /** Seed for deterministic tests. Math.random() when omitted. */
  seed?: number;
}

export interface EmpiricalKellyResult {
  fKelly: number;
  fEmpirical: number;
  cvEdge: number;
  meanBootstrapEdge: number;
  bootstrapStddev: number;
  edgeUncertainty: EdgeUncertainty;
  recommendedFraction: number;
}

const DEFAULT_BOOTSTRAP_SAMPLES = 10_000;

function makeRng(seed?: number): () => number {
  if (seed === undefined) return Math.random;
  let s = (seed >>> 0) || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function classifyUncertainty(cv: number): EdgeUncertainty {
  if (!Number.isFinite(cv) || cv >= 1) return "untradable";
  if (cv >= 0.5) return "high";
  if (cv >= 0.2) return "medium";
  return "low";
}

export function empiricalKelly(input: EmpiricalKellyInput): EmpiricalKellyResult {
  const p = input.winRate;
  const q = 1 - p;
  const b = input.payoffRatio;
  const fKelly = b > 0 ? (p * b - q) / b : 0;

  const m = input.historicalReturns.length;
  if (m < 2) {
    return {
      fKelly,
      fEmpirical: 0,
      cvEdge: Number.POSITIVE_INFINITY,
      meanBootstrapEdge: 0,
      bootstrapStddev: 0,
      edgeUncertainty: "untradable",
      recommendedFraction: 0,
    };
  }

  const samples = input.bootstrapSamples ?? DEFAULT_BOOTSTRAP_SAMPLES;
  const rng = makeRng(input.seed);
  const returns = input.historicalReturns;
  const edges: number[] = new Array(samples);
  for (let s = 0; s < samples; s++) {
    let sum = 0;
    for (let i = 0; i < m; i++) {
      const idx = Math.floor(rng() * m);
      sum += returns[idx]!;
    }
    edges[s] = sum / m;
  }

  let meanEdge = 0;
  for (const e of edges) meanEdge += e;
  meanEdge /= samples;

  let varSum = 0;
  for (const e of edges) {
    const diff = e - meanEdge;
    varSum += diff * diff;
  }
  const stddev = Math.sqrt(varSum / samples);

  const cv = Math.abs(meanEdge) > 0 ? stddev / Math.abs(meanEdge) : Number.POSITIVE_INFINITY;
  const uncertainty = classifyUncertainty(cv);

  const fEmpirical =
    uncertainty === "untradable" || fKelly <= 0
      ? 0
      : Math.max(fKelly * (1 - cv), 0);

  return {
    fKelly,
    fEmpirical,
    cvEdge: cv,
    meanBootstrapEdge: meanEdge,
    bootstrapStddev: stddev,
    edgeUncertainty: uncertainty,
    recommendedFraction: fEmpirical,
  };
}

export function empiricalKellyToPayload(result: EmpiricalKellyResult): Record<string, unknown> {
  return {
    kind: "empirical_kelly.computed",
    fKelly: Number(result.fKelly.toFixed(4)),
    fEmpirical: Number(result.fEmpirical.toFixed(4)),
    cvEdge: Number.isFinite(result.cvEdge) ? Number(result.cvEdge.toFixed(3)) : null,
    edgeUncertainty: result.edgeUncertainty,
  };
}
