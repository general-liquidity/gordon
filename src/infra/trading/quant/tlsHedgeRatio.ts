export interface TlsHedgeRatioResult {
  hedgeRatio: number;
  intercept: number;
  olsHedgeRatio: number;
  sampleSize: number;
  interpretation: string;
}

const round6 = (x: number): number => parseFloat(x.toFixed(6));

/**
 * Total-Least-Squares (orthogonal / Deming) hedge ratio for a 2-asset spread.
 * Errors-in-variables alternative to OLS: β_TLS minimizes orthogonal distance
 * rather than vertical residuals, so noise in x doesn't bias the slope toward zero.
 */
export function computeTlsHedgeRatio(input: {
  pricesY: ReadonlyArray<number>;
  pricesX: ReadonlyArray<number>;
}): TlsHedgeRatioResult {
  const { pricesY, pricesX } = input;
  const n = Math.min(pricesY.length, pricesX.length);

  if (n < 3) {
    return {
      hedgeRatio: 0,
      intercept: 0,
      olsHedgeRatio: 0,
      sampleSize: n,
      interpretation:
        "Insufficient data: need at least 3 paired points to estimate a hedge ratio.",
    };
  }

  let sumY = 0;
  let sumX = 0;
  for (let i = 0; i < n; i++) {
    sumY += pricesY[i]!;
    sumX += pricesX[i]!;
  }
  const meanY = sumY / n;
  const meanX = sumX / n;

  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    const dx = pricesX[i]! - meanX;
    const dy = pricesY[i]! - meanY;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }

  if (Math.abs(sxy) < 1e-12) {
    return {
      hedgeRatio: 0,
      intercept: 0,
      olsHedgeRatio: 0,
      sampleSize: n,
      interpretation:
        "Degenerate: covariance(x,y) ≈ 0, the two series are uncorrelated so no hedge ratio is defined.",
    };
  }

  const diff = syy - sxx;
  const beta = (diff + Math.sqrt(diff * diff + 4 * sxy * sxy)) / (2 * sxy);
  const intercept = meanY - beta * meanX;
  const olsBeta = sxy / sxx;

  const gap = Math.abs(beta - olsBeta);
  const interpretation =
    gap < 1e-6
      ? `TLS and OLS agree (β≈${round6(beta)}); little measurement error in x — hedge ${round6(
          beta,
        )} units of X per unit of Y.`
      : `TLS β=${round6(beta)} vs OLS β=${round6(
          olsBeta,
        )}; the gap reflects errors-in-variables — OLS attenuates toward zero when X is noisy, so prefer TLS for the hedge.`;

  return {
    hedgeRatio: round6(beta),
    intercept: round6(intercept),
    olsHedgeRatio: round6(olsBeta),
    sampleSize: n,
    interpretation,
  };
}
