/**
 * Quantile-optimal leverage sizing (Rob Carver / Ed Thorp risk-appetite knob).
 *
 * A Kelly / Optimal-F investor maximises the geometric mean of wealth (log-growth)
 * at the MEDIAN outcome of the return distribution. That is provably optimal
 * asymptotically, but it ignores estimation error in the edge/Sharpe and accepts
 * the full distribution of finite-sample paths — including the unpleasant ones.
 *
 * A CONSERVATIVE investor should instead maximise the geometric mean at a LOWER
 * quantile (e.g. the 10th / 25th percentile) of the bootstrapped outcome
 * distribution. Optimising the bad-case growth rate rather than the median yields
 * lower, safer leverage and is robust to over-estimated Sharpe: if the realised
 * edge is weaker than the point estimate, the conservative leverage still survives.
 *
 * This generalises Kelly / Optimal-F with Carver's risk-appetite quantile:
 *   - quantile = 0.5  ≈ full-Kelly / Optimal-F (median growth)
 *   - quantile < 0.5  = conservative (optimise a lower percentile of outcomes)
 *
 * It PAIRS WITH the path-risk Monte-Carlo (monteCarloPath.ts), which REPORTS the
 * tail of a given leverage; this primitive PICKS the leverage by sweeping a grid
 * and choosing the one whose quantile log-growth is highest.
 *
 * Pure: no I/O, no Math.random (banned). Uses a deterministic seeded LCG and a
 * stationary / circular block bootstrap to preserve short-run autocorrelation.
 */

export interface QuantileLeverageOptions {
  /** Risk-appetite quantile of the outcome distribution to optimise. Default 0.5 (median ≈ Kelly). */
  quantile?: number;
  /** Path length in periods. Default = perPeriodReturns.length. */
  horizon?: number;
  /** Number of bootstrap paths per leverage. Default 2000. */
  nPaths?: number;
  /** Leverage multipliers to evaluate. Default 0..5 step 0.25. */
  leverageGrid?: number[];
  /** Block length for the circular block bootstrap. Default ~max(5, round(sqrt(n))). */
  blockSize?: number;
  /** Seed for the deterministic RNG. Default 1. */
  seed?: number;
}

export interface QuantileLeverageCurvePoint {
  leverage: number;
  /** Mean log-growth per period at the chosen quantile across paths. */
  geoMeanAtQuantile: number;
  /** Fraction of paths that hit ruin (1 + L·r ≤ 0 on some step) at this leverage. */
  ruinProb: number;
}

export interface QuantileLeverageResult {
  /** Leverage maximising geoMeanAtQuantile. */
  leverage: number;
  quantile: number;
  /** geoMeanAtQuantile at the chosen leverage. */
  geoMeanAtQuantile: number;
  /** Ruin probability at the chosen leverage. */
  ruinProbAtOptimal: number;
  curve: QuantileLeverageCurvePoint[];
}

/** Deterministic linear congruential generator — numerical-recipes constants. */
function makeLcg(seed: number): () => number {
  // Keep state in unsigned 32-bit space.
  let state = (seed >>> 0) || 1;
  return () => {
    // state = (1664525 * state + 1013904223) mod 2^32
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function defaultLeverageGrid(): number[] {
  const grid: number[] = [];
  for (let i = 0; i <= 20; i++) grid.push(i * 0.25);
  return grid;
}

/** Quantile of an ascending-sorted array via linear interpolation. */
function quantileSorted(sorted: number[], q: number): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  if (n === 1) return sorted[0]!;
  const clamped = q < 0 ? 0 : q > 1 ? 1 : q;
  const pos = clamped * (n - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo]!;
  const frac = pos - lo;
  return sorted[lo]! * (1 - frac) + sorted[hi]! * frac;
}

export function quantileOptimalLeverage(
  perPeriodReturns: number[],
  opts: QuantileLeverageOptions = {},
): QuantileLeverageResult {
  const quantile = opts.quantile ?? 0.5;

  const finite = perPeriodReturns.filter((r) => Number.isFinite(r));
  const n = finite.length;

  const leverageGrid =
    opts.leverageGrid && opts.leverageGrid.length > 0
      ? opts.leverageGrid.slice()
      : defaultLeverageGrid();

  if (n < 2) {
    return {
      leverage: 0,
      quantile,
      geoMeanAtQuantile: 0,
      ruinProbAtOptimal: 0,
      curve: leverageGrid.map((leverage) => ({
        leverage,
        geoMeanAtQuantile: 0,
        ruinProb: 0,
      })),
    };
  }

  const horizon = Math.max(1, Math.floor(opts.horizon ?? n));
  const nPaths = Math.max(1, Math.floor(opts.nPaths ?? 2000));
  const blockSize = Math.max(
    1,
    Math.floor(opts.blockSize ?? Math.max(5, Math.round(Math.sqrt(n)))),
  );
  const seed = opts.seed ?? 1;

  // Build all bootstrap paths ONCE (index paths) so every leverage is evaluated
  // on the same resampled worlds — a clean apples-to-apples comparison and it
  // makes the curve monotone-comparable.
  const rng = makeLcg(seed);
  const paths: number[][] = [];
  for (let p = 0; p < nPaths; p++) {
    const path: number[] = new Array(horizon);
    let t = 0;
    while (t < horizon) {
      // Stationary block bootstrap: start a circular block at a random index,
      // with a geometric block length of mean blockSize.
      let idx = Math.floor(rng() * n) % n;
      do {
        path[t] = finite[idx]!;
        t++;
        idx = (idx + 1) % n;
        // Geometric stopping: prob 1/blockSize of ending the block each step.
      } while (t < horizon && rng() >= 1 / blockSize);
    }
    paths.push(path);
  }

  const curve: QuantileLeverageCurvePoint[] = leverageGrid.map((leverage) => {
    const terminalLogWealth: number[] = new Array(nPaths);
    let ruinCount = 0;

    for (let p = 0; p < nPaths; p++) {
      const path = paths[p]!;
      let logWealth = 0;
      let ruined = false;
      for (let t = 0; t < horizon; t++) {
        const gross = 1 + leverage * path[t]!;
        if (gross <= 0) {
          ruined = true;
          break;
        }
        logWealth += Math.log(gross);
      }
      if (ruined) {
        terminalLogWealth[p] = -Infinity;
        ruinCount++;
      } else {
        terminalLogWealth[p] = logWealth;
      }
    }

    const sorted = terminalLogWealth.slice().sort((a, b) => a - b);
    const qTerminal = quantileSorted(sorted, quantile);
    // Geometric mean = mean log-growth PER PERIOD (annualisation-agnostic).
    const geoMeanAtQuantile = Number.isFinite(qTerminal)
      ? qTerminal / horizon
      : qTerminal;

    return {
      leverage,
      geoMeanAtQuantile,
      ruinProb: ruinCount / nPaths,
    };
  });

  let best = curve[0]!;
  for (const point of curve) {
    const bestVal = best.geoMeanAtQuantile;
    const val = point.geoMeanAtQuantile;
    // -Infinity (quantile fell in ruin region) never beats a finite value.
    if (val > bestVal || (Number.isFinite(val) && !Number.isFinite(bestVal))) {
      best = point;
    }
  }

  return {
    leverage: best.leverage,
    quantile,
    geoMeanAtQuantile: best.geoMeanAtQuantile,
    ruinProbAtOptimal: best.ruinProb,
    curve,
  };
}
