/**
 * Hurst Exponent (GORDON_HURST_EXPONENT).
 *
 * Port of Ch 14 from Ryan Wright. Measures the "memory" of a price
 * series: does today's move predict tomorrow's direction?
 *
 *   H < 0.5  → mean-reverting (range trader's habitat)
 *   H ≈ 0.5  → random walk (no exploitable memory)
 *   H > 0.5  → trending (momentum/trend-follower's habitat)
 *
 * Wright's framing: "the only tool that distinguishes choppy from
 * trending without lagging price." Pair with `regimeClassifier` (which
 * gives Gordon's 6-value enum) to enrich quadrant classification in
 * WW10 weeklyRegimeCheck.
 *
 * Implementation uses the standard rescaled range (R/S) method over
 * log-returns. Output is noisy on small samples; minimum 64 data points
 * recommended for stability.
 */

export const HURST_EXPONENT_FLAG_ENV = "GORDON_HURST_EXPONENT";

export function isHurstExponentEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    env[HURST_EXPONENT_FLAG_ENV] === "1" ||
    env[HURST_EXPONENT_FLAG_ENV] === "true"
  );
}

export type HurstRegime = "mean_reverting" | "random_walk" | "trending";

export interface HurstResult {
  hurst: number;
  regime: HurstRegime;
  n: number;
  /** True when the sample is large enough for the estimate to be stable. */
  reliable: boolean;
}

function mean(xs: number[]): number {
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

function rescaledRange(returns: number[], chunkSize: number): number {
  let totalRS = 0;
  let chunks = 0;
  for (let start = 0; start + chunkSize <= returns.length; start += chunkSize) {
    const chunk = returns.slice(start, start + chunkSize);
    const m = mean(chunk);
    const deviations = chunk.map((x) => x - m);
    const cumDev: number[] = [];
    let running = 0;
    for (const d of deviations) {
      running += d;
      cumDev.push(running);
    }
    const range = Math.max(...cumDev) - Math.min(...cumDev);
    const stddev = Math.sqrt(
      deviations.reduce((s, d) => s + d * d, 0) / chunk.length,
    );
    if (stddev > 0) {
      totalRS += range / stddev;
      chunks += 1;
    }
  }
  return chunks > 0 ? totalRS / chunks : 0;
}

const MIN_RELIABLE_N = 64;

export function calculateHurst(returns: ReadonlyArray<number>): HurstResult {
  const n = returns.length;
  if (n < 16) {
    return { hurst: 0.5, regime: "random_walk", n, reliable: false };
  }
  const arr = [...returns];
  const sizes: number[] = [];
  for (let s = 8; s <= Math.floor(n / 2); s = Math.floor(s * 1.5)) sizes.push(s);
  if (sizes.length < 3) {
    return { hurst: 0.5, regime: "random_walk", n, reliable: false };
  }

  const logSizes: number[] = [];
  const logRS: number[] = [];
  for (const size of sizes) {
    const rs = rescaledRange(arr, size);
    if (rs > 0) {
      logSizes.push(Math.log(size));
      logRS.push(Math.log(rs));
    }
  }
  if (logSizes.length < 3) {
    return { hurst: 0.5, regime: "random_walk", n, reliable: false };
  }

  const mx = mean(logSizes);
  const my = mean(logRS);
  let num = 0;
  let den = 0;
  for (let i = 0; i < logSizes.length; i++) {
    num += (logSizes[i]! - mx) * (logRS[i]! - my);
    den += (logSizes[i]! - mx) ** 2;
  }
  const h = den > 0 ? num / den : 0.5;

  let regime: HurstRegime;
  if (h < 0.45) regime = "mean_reverting";
  else if (h > 0.55) regime = "trending";
  else regime = "random_walk";

  return {
    hurst: Math.max(0, Math.min(1, h)),
    regime,
    n,
    reliable: n >= MIN_RELIABLE_N,
  };
}

export function hurstToPayload(result: HurstResult): Record<string, unknown> {
  return {
    kind: "hurst_exponent.computed",
    hurst: Number(result.hurst.toFixed(3)),
    regime: result.regime,
    n: result.n,
    reliable: result.reliable,
  };
}
