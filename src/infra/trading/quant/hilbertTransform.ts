/**
 * Hilbert Transform (GORDON_HILBERT_TRANSFORM).
 *
 * Ehlers's truncated Hilbert Transform from TSaM Ch 11. Extracts the
 * instantaneous phase of a price series with very little lag, useful
 * for cycle detection and trend-vs-sideways classification.
 *
 *   Q[t] = 0.0962 · p[t] + 0.5769 · p[t-2] - 0.5769 · p[t-4] - 0.0962 · p[t-6]
 *   I[t] = p[t-3]
 *   θ[t] = atan2(Q, I)  (degrees in [0, 360))
 *
 * Truncating the infinite series to 7 taps introduces some attenuation
 * at the edges of the cycle but is more than adequate for trading-
 * timescale signals.
 *
 * Cycle direction:
 *   - Phase angle increases steadily through a regular cycle.
 *   - When the phase becomes erratic, the cycle is breaking down
 *     (signal: the regime is shifting to trend or noise).
 */

export interface HilbertInput {
  prices: ReadonlyArray<number>;
  /** Pre-detrend the series by subtracting a SMA of this many bars. Default 0 (no detrend). */
  detrendPeriod?: number;
}

export interface HilbertResult {
  quadrature: number[];
  inPhase: number[];
  /** Phase angle in degrees [0, 360). NaN during warmup. */
  phaseDegrees: number[];
  /** True when the phase appears to advance monotonically over the past 5 bars. */
  cyclic: boolean;
  currentPhase: number;
  sampleSize: number;
  reasoning: string;
}

function detrend(prices: ReadonlyArray<number>, period: number): number[] {
  if (period <= 0) return [...prices];
  const out: number[] = new Array(prices.length).fill(0);
  let runningSum = 0;
  for (let i = 0; i < prices.length; i++) {
    runningSum += prices[i]!;
    if (i >= period) runningSum -= prices[i - period]!;
    const denom = Math.min(i + 1, period);
    out[i] = prices[i]! - runningSum / denom;
  }
  return out;
}

export function computeHilbertTransform(input: HilbertInput): HilbertResult {
  const period = input.detrendPeriod ?? 0;
  const series = detrend(input.prices, period);
  const n = series.length;
  const q: number[] = new Array(n).fill(Number.NaN);
  const ip: number[] = new Array(n).fill(Number.NaN);
  const phase: number[] = new Array(n).fill(Number.NaN);

  if (n < 7) {
    return {
      quadrature: q,
      inPhase: ip,
      phaseDegrees: phase,
      cyclic: false,
      currentPhase: Number.NaN,
      sampleSize: n,
      reasoning: `need at least 7 prices, got ${n}`,
    };
  }

  for (let t = 6; t < n; t++) {
    q[t] =
      0.0962 * series[t]! +
      0.5769 * series[t - 2]! -
      0.5769 * series[t - 4]! -
      0.0962 * series[t - 6]!;
    ip[t] = series[t - 3]!;
    const rad = Math.atan2(q[t]!, ip[t]!);
    let deg = (rad * 180) / Math.PI;
    if (deg < 0) deg += 360;
    phase[t] = deg;
  }

  // Cyclic if the last 5 phase samples are advancing.
  let cyclic = false;
  if (n >= 11) {
    let advances = 0;
    for (let t = n - 4; t < n; t++) {
      const prev = phase[t - 1]!;
      const curr = phase[t]!;
      if (!Number.isFinite(prev) || !Number.isFinite(curr)) continue;
      let delta = curr - prev;
      if (delta < -180) delta += 360;
      if (delta > 180) delta -= 360;
      if (delta > 0) advances += 1;
    }
    cyclic = advances >= 3;
  }

  const currentPhase = phase[n - 1]!;
  return {
    quadrature: q,
    inPhase: ip,
    phaseDegrees: phase,
    cyclic,
    currentPhase,
    sampleSize: n,
    reasoning: `phase ${Number.isFinite(currentPhase) ? `${currentPhase.toFixed(1)}°` : "n/a"}, ${cyclic ? "cyclic" : "non-cyclic"}`,
  };
}

export function hilbertToPayload(result: HilbertResult): Record<string, unknown> {
  return {
    kind: "hilbert_transform.computed",
    currentPhase: Number.isFinite(result.currentPhase)
      ? Number(result.currentPhase.toFixed(2))
      : null,
    cyclic: result.cyclic,
    sampleSize: result.sampleSize,
  };
}
