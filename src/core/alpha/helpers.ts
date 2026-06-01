/**
 * Shared statistical helpers for the alpha-diagnostic surface.
 *
 * Kept narrow + dependency-free — no random-number engines, no
 * external stats libraries. Edge cases (constant arrays, NaN values,
 * insufficient length) collapse to safe defaults the caller can
 * recognize (NaN → 0, correlations → null when undefined).
 */

/**
 * Pearson correlation coefficient between two equal-length arrays.
 * Returns null when:
 *   - lengths differ
 *   - sample size < 3
 *   - either series has zero variance (constant)
 *   - any value is non-finite
 */
export function pearsonCorrelation(xs: number[], ys: number[]): number | null {
  if (xs.length !== ys.length) return null;
  const n = xs.length;
  if (n < 3) return null;
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(xs[i]!) || !Number.isFinite(ys[i]!)) return null;
  }

  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    sx += xs[i]!;
    sy += ys[i]!;
  }
  const mx = sx / n;
  const my = sy / n;

  let num = 0;
  let dx2 = 0;
  let dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - mx;
    const dy = ys[i]! - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }

  if (dx2 === 0 || dy2 === 0) return null;
  return num / Math.sqrt(dx2 * dy2);
}

/**
 * Average ranks of `values` (1-based), assigning the mean rank to ties.
 * e.g. [10, 20, 20, 30] → [1, 2.5, 2.5, 4].
 */
function averageRanks(values: number[]): number[] {
  const n = values.length;
  const indexed = values.map((v, i) => ({ v, i }));
  indexed.sort((a, b) => a.v - b.v);

  const ranks = new Array<number>(n);
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && indexed[j + 1]!.v === indexed[i]!.v) {
      j += 1;
    }
    // Tied block spans indexed[i..j]; average of 1-based ranks (i+1)..(j+1).
    const avgRank = (i + 1 + (j + 1)) / 2;
    for (let k = i; k <= j; k++) {
      ranks[indexed[k]!.i] = avgRank;
    }
    i = j + 1;
  }
  return ranks;
}

/**
 * Spearman rank correlation coefficient — Pearson correlation computed on
 * the average-rank transform of both series. Captures monotonic (including
 * non-linear monotonic) association where Pearson would understate it.
 *
 * Returns null under the same conditions as `pearsonCorrelation` (length
 * mismatch, n < 3, constant series after ranking, non-finite input).
 */
export function spearmanCorrelation(xs: number[], ys: number[]): number | null {
  if (xs.length !== ys.length) return null;
  const n = xs.length;
  if (n < 3) return null;
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(xs[i]!) || !Number.isFinite(ys[i]!)) return null;
  }
  return pearsonCorrelation(averageRanks(xs), averageRanks(ys));
}

/**
 * Sample standard deviation (Bessel-corrected, divisor n-1).
 * Returns 0 for arrays of length < 2.
 */
export function sampleStd(values: number[]): number {
  if (values.length < 2) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  const mean = sum / values.length;
  let sumSq = 0;
  for (const v of values) sumSq += (v - mean) * (v - mean);
  return Math.sqrt(sumSq / (values.length - 1));
}

/**
 * Slope of a least-squares linear regression of `ys` on the index
 * 0..n-1 (i.e. the time-trend coefficient when xs are evenly-spaced
 * sample indices). Returns 0 for n < 2.
 *
 * Used by IC tracker to detect signal decay — negative slope on a
 * |IC| series means the signal is fading.
 */
export function trendSlope(ys: number[]): number {
  const n = ys.length;
  if (n < 2) return 0;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += ys[i]!;
    sumXY += i * ys[i]!;
    sumX2 += i * i;
  }
  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return 0;
  return (n * sumXY - sumX * sumY) / denom;
}

/**
 * Approximate 95% confidence interval half-width for a sample-mean
 * given std error: 1.96 × se. Returns 0 for n < 2.
 */
export function ci95HalfWidth(std: number, n: number): number {
  if (n < 2) return 0;
  const se = std / Math.sqrt(n);
  return 1.96 * se;
}

/**
 * Coefficient of variation: |std / mean|. Returns Infinity when mean
 * is 0 (avoids divide-by-zero; callers treat Infinity as "max
 * uncertainty").
 */
export function coefficientOfVariation(mean: number, std: number): number {
  if (mean === 0) return Infinity;
  return Math.abs(std / mean);
}

/**
 * Compute the mean of a non-empty number array. Returns 0 for empty.
 */
export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}
