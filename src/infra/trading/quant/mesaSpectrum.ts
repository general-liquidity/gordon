/**
 * Maximum Entropy Spectral Analysis — Burg method (GORDON_MESA_SPECTRUM).
 *
 * From TSaM Ch 11 (Ehlers's contribution). MESA fits an autoregressive
 * model to a price series, then derives the power spectrum from the AR
 * coefficients. Unlike Fourier methods (which need ~256 samples and
 * many cycle repetitions), Burg-style AR fitting recovers a useful
 * spectrum from short windows (~16-50 samples) — ideal for the short-
 * lived market cycles Ehlers studies.
 *
 * Algorithm: standard Burg recursion to estimate AR coefficients of
 * order `arOrder`, then compute the spectral density at a grid of
 * periods. The dominant cycle is the period with the highest power.
 *
 *   spectrum(f) = σ² / |1 - Σ a[k] · exp(-i · 2π · f · k)|²
 *
 * Output includes the AR coefficients, the period grid, the power at
 * each grid point, the dominant period, and a peak-strength ratio
 * (peak / median power) so callers can judge how cyclic the signal is.
 */

export interface MesaInput {
  /** Detrended price series (subtract a SMA before feeding in for best results). */
  prices: ReadonlyArray<number>;
  /** AR model order. Default 8. Must be < prices.length. */
  arOrder?: number;
  /** Shortest period to evaluate. Default 4. */
  minPeriod?: number;
  /** Longest period to evaluate. Default 40. */
  maxPeriod?: number;
}

export interface SpectrumPoint {
  period: number;
  power: number;
}

export interface MesaResult {
  arCoefficients: number[];
  /** White-noise variance (Burg's σ²). */
  variance: number;
  spectrum: SpectrumPoint[];
  dominantPeriod: number;
  peakStrengthRatio: number;
  reasoning: string;
}

const DEFAULT_ORDER = 8;
const DEFAULT_MIN_PERIOD = 4;
const DEFAULT_MAX_PERIOD = 40;

/** Burg's AR coefficient estimation. Returns [a1..aN, variance]. */
function burgAr(x: ReadonlyArray<number>, order: number): { a: number[]; variance: number } {
  const n = x.length;
  // Forward and backward prediction errors.
  let f = x.slice();
  let b = x.slice();
  let a = [1];
  let variance = 0;
  for (const v of x) variance += v * v;
  variance /= n;

  for (let m = 0; m < order; m++) {
    let num = 0;
    let denom = 0;
    for (let i = m + 1; i < n; i++) {
      num += f[i]! * b[i - 1]!;
      denom += f[i]! * f[i]! + b[i - 1]! * b[i - 1]!;
    }
    const k = denom > 0 ? (2 * num) / denom : 0;
    const newA: number[] = new Array(a.length + 1).fill(0);
    newA[0] = 1;
    for (let i = 1; i <= a.length - 1; i++) {
      newA[i] = a[i]! - k * a[a.length - 1 - i + 1]!;
    }
    newA[a.length] = -k;
    a = newA;
    variance *= 1 - k * k;
    // Update prediction errors.
    const newF = f.slice();
    const newB = b.slice();
    for (let i = m + 1; i < n; i++) {
      newF[i] = f[i]! - k * b[i - 1]!;
      newB[i] = b[i - 1]! - k * f[i]!;
    }
    f = newF;
    b = newB;
  }
  // Return as coefficients [a1..aOrder] (drop leading 1, flip sign convention so
  // spectrum = variance / |1 - sum(a[k] · exp(-i · ω · k))|²).
  const coeffs = a.slice(1).map((v) => -v);
  return { a: coeffs, variance };
}

function evaluateSpectrum(coeffs: number[], variance: number, period: number): number {
  const omega = (2 * Math.PI) / period;
  let real = 1;
  let imag = 0;
  for (let k = 0; k < coeffs.length; k++) {
    const angle = omega * (k + 1);
    real -= coeffs[k]! * Math.cos(angle);
    imag -= -coeffs[k]! * Math.sin(angle);
  }
  const denom = real * real + imag * imag;
  return denom > 0 ? variance / denom : 0;
}

export function computeMesaSpectrum(input: MesaInput): MesaResult {
  const order = input.arOrder ?? DEFAULT_ORDER;
  const minP = input.minPeriod ?? DEFAULT_MIN_PERIOD;
  const maxP = input.maxPeriod ?? DEFAULT_MAX_PERIOD;
  const prices = input.prices;
  const n = prices.length;

  if (n <= order + 1 || maxP < minP) {
    return {
      arCoefficients: [],
      variance: Number.NaN,
      spectrum: [],
      dominantPeriod: Number.NaN,
      peakStrengthRatio: Number.NaN,
      reasoning: `need at least ${order + 2} samples; got ${n}`,
    };
  }

  // Detrend by subtracting the mean.
  const mean = prices.reduce((s, v) => s + v, 0) / n;
  const centered = prices.map((v) => v - mean);

  const { a, variance } = burgAr(centered, order);

  const spectrum: SpectrumPoint[] = [];
  for (let p = minP; p <= maxP; p++) {
    spectrum.push({ period: p, power: evaluateSpectrum(a, variance, p) });
  }

  let dominant = spectrum[0]!;
  for (const s of spectrum) if (s.power > dominant.power) dominant = s;
  const powers = spectrum
    .map((s) => s.power)
    .slice()
    .sort((x, y) => x - y);
  const median = powers[Math.floor(powers.length / 2)] ?? 0;
  const peakStrength = median > 0 ? dominant.power / median : Number.POSITIVE_INFINITY;

  return {
    arCoefficients: a,
    variance,
    spectrum,
    dominantPeriod: dominant.period,
    peakStrengthRatio: peakStrength,
    reasoning: `dominant period ${dominant.period}, peak/median power ratio ${Number.isFinite(peakStrength) ? peakStrength.toFixed(2) : "∞"}`,
  };
}

export function mesaToPayload(result: MesaResult): Record<string, unknown> {
  return {
    kind: "mesa_spectrum.computed",
    dominantPeriod: Number.isFinite(result.dominantPeriod) ? result.dominantPeriod : null,
    peakStrengthRatio: Number.isFinite(result.peakStrengthRatio)
      ? Number(result.peakStrengthRatio.toFixed(3))
      : null,
    spectrumLength: result.spectrum.length,
  };
}
