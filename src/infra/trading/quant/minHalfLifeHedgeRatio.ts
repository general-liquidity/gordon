export interface MinHalfLifeResult {
  hedgeRatio: number;
  halfLife: number;
  olsHedgeRatio: number;
  sampleSize: number;
  interpretation: string;
}

function round6(value: number): number {
  if (!Number.isFinite(value)) return value;
  return Number(value.toFixed(6));
}

/**
 * Half-life of mean reversion for the spread s = y - beta*x.
 * Regress Δs_t on s_{t-1}: Δs_t = α + λ·s_{t-1} + ε.
 * half-life = -ln(2)/ln(1+λ) when -1 < λ < 0, else Infinity.
 */
function halfLifeForBeta(
  pricesY: ReadonlyArray<number>,
  pricesX: ReadonlyArray<number>,
  beta: number,
): number {
  const n = pricesY.length;
  const spread = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    spread[i] = pricesY[i]! - beta * pricesX[i]!;
  }

  // Regress delta vs lagged level.
  const m = n - 1;
  if (m < 2) return Infinity;

  let sumLag = 0;
  let sumDelta = 0;
  for (let i = 1; i < n; i++) {
    sumLag += spread[i - 1]!;
    sumDelta += spread[i]! - spread[i - 1]!;
  }
  const meanLag = sumLag / m;
  const meanDelta = sumDelta / m;

  let cov = 0;
  let varLag = 0;
  for (let i = 1; i < n; i++) {
    const lag = spread[i - 1]! - meanLag;
    const delta = spread[i]! - spread[i - 1]! - meanDelta;
    cov += lag * delta;
    varLag += lag * lag;
  }

  if (varLag === 0) return Infinity;
  const lambda = cov / varLag;
  if (lambda >= 0 || lambda <= -1) return Infinity;

  const hl = -Math.LN2 / Math.log(1 + lambda);
  return hl > 0 && Number.isFinite(hl) ? hl : Infinity;
}

function olsBeta(pricesY: ReadonlyArray<number>, pricesX: ReadonlyArray<number>): number {
  const n = pricesY.length;
  let meanX = 0;
  let meanY = 0;
  for (let i = 0; i < n; i++) {
    meanX += pricesX[i]!;
    meanY += pricesY[i]!;
  }
  meanX /= n;
  meanY /= n;

  let cov = 0;
  let varX = 0;
  for (let i = 0; i < n; i++) {
    const dx = pricesX[i]! - meanX;
    cov += dx * (pricesY[i]! - meanY);
    varX += dx * dx;
  }
  if (varX === 0) return 0;
  return cov / varX;
}

export function computeMinHalfLifeHedgeRatio(input: {
  pricesY: ReadonlyArray<number>;
  pricesX: ReadonlyArray<number>;
}): MinHalfLifeResult {
  const { pricesY, pricesX } = input;
  const sampleSize = Math.min(pricesY.length, pricesX.length);

  if (sampleSize < 10) {
    return {
      hedgeRatio: 0,
      halfLife: Infinity,
      olsHedgeRatio: 0,
      sampleSize,
      interpretation:
        "Insufficient data: need at least 10 aligned price points to estimate a mean-reverting hedge ratio.",
    };
  }

  // Align to the common length (defensive at the boundary).
  const y = pricesY.slice(0, sampleSize);
  const x = pricesX.slice(0, sampleSize);

  const betaOls = olsBeta(y, x);

  // Coarse grid around the OLS beta.
  const lo = betaOls * 0.2;
  const hi = betaOls * 1.8;
  const steps = 60;

  let bestBeta = betaOls;
  let bestHl = halfLifeForBeta(y, x, betaOls);
  let bestIdx = -1;
  const gridBetas = new Array<number>(steps + 1);
  const gridHls = new Array<number>(steps + 1);

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const beta = lo + (hi - lo) * t;
    const hl = halfLifeForBeta(y, x, beta);
    gridBetas[i] = beta;
    gridHls[i] = hl;
    if (hl < bestHl) {
      bestHl = hl;
      bestBeta = beta;
      bestIdx = i;
    }
  }

  // Golden-section refine on the bracket around the best grid point.
  if (bestIdx >= 0 && Number.isFinite(bestHl)) {
    const lowIdx = Math.max(0, bestIdx - 1);
    const highIdx = Math.min(steps, bestIdx + 1);
    let a = gridBetas[lowIdx]!;
    let b = gridBetas[highIdx]!;

    const gr = (Math.sqrt(5) - 1) / 2; // ~0.618
    let c = b - gr * (b - a);
    let d = a + gr * (b - a);
    let fc = halfLifeForBeta(y, x, c);
    let fd = halfLifeForBeta(y, x, d);

    for (let iter = 0; iter < 50 && Math.abs(b - a) > 1e-9; iter++) {
      if (fc < fd) {
        b = d;
        d = c;
        fd = fc;
        c = b - gr * (b - a);
        fc = halfLifeForBeta(y, x, c);
      } else {
        a = c;
        c = d;
        fc = fd;
        d = a + gr * (b - a);
        fd = halfLifeForBeta(y, x, d);
      }
    }

    const mid = (a + b) / 2;
    const fmid = halfLifeForBeta(y, x, mid);
    if (fmid < bestHl) {
      bestHl = fmid;
      bestBeta = mid;
    }
    if (fc < bestHl) {
      bestHl = fc;
      bestBeta = c;
    }
    if (fd < bestHl) {
      bestHl = fd;
      bestBeta = d;
    }
  }

  if (!Number.isFinite(bestHl)) {
    return {
      hedgeRatio: 0,
      halfLife: Infinity,
      olsHedgeRatio: round6(betaOls),
      sampleSize,
      interpretation:
        "No hedge ratio in the searched range produced a mean-reverting spread (no AR(1) coefficient in (-1, 0)); the pair does not appear cointegrated.",
    };
  }

  const interpretation = `Min-half-life hedge ratio β=${round6(
    bestBeta,
  )} yields a spread with mean-reversion half-life of ${round6(bestHl)} bars (OLS β=${round6(
    betaOls,
  )}). Lower half-life means faster reversion and faster profit realization.`;

  return {
    hedgeRatio: round6(bestBeta),
    halfLife: round6(bestHl),
    olsHedgeRatio: round6(betaOls),
    sampleSize,
    interpretation,
  };
}
