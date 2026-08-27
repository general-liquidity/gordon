/**
 * Damped-harmonic cycle decomposition (Prony's method).
 *
 * Decomposes a uniformly-sampled series into a sum of DAMPED sinusoids:
 *
 *     x[n] ≈ Σ_k  A_k · r_k^n · cos(ω_k·n + φ_k)
 *
 * i.e. exactly the e^(λτ)·R(ωτ) damped-rotation family. Each component
 * carries a period (2π/ω), a per-bar decay rate λ_k = ln(r_k), an
 * amplitude, and a phase. The decay rate is the point: it says whether a
 * cycle is PERSISTENT (λ≈0, an exploitable standing oscillation), DECAYING
 * (λ<0, a cycle that is dying — has a finite amplitude half-life), or
 * GROWING (λ>0, an unstable/expanding oscillation).
 *
 * This is the dimension Gordon's existing cycle tools don't capture:
 *   - mesaSpectrum.ts (Burg AR) gives the POWER spectrum + dominant period
 *     — which periods carry energy, not how persistent each one is.
 *   - hilbertTransform.ts gives instantaneous PHASE / cyclic-or-not.
 * Neither yields a per-cycle persistence/half-life. Prony does.
 *
 * Method:
 *   1. mean-center the series.
 *   2. forward linear prediction (least squares) → AR coefficients a_k:
 *      x[n] ≈ Σ a_k·x[n-k]. The characteristic polynomial
 *      z^p − a_1 z^{p−1} − … − a_p has roots z_k = r_k·e^{iω_k}.
 *   3. Durand-Kerner to find the complex roots (self-contained, no eigen).
 *   4. real least-squares over the {r^n cos(ωn), r^n sin(ωn)} basis for
 *      amplitude + phase per component; rank by amplitude.
 *
 * Caveats: Prony is sensitive to noise — feed a DETRENDED / lightly
 * smoothed series, keep the order modest, and read varianceExplained
 * before trusting a component. Complements (does not replace) MESA/Hilbert.
 */

import { transpose, multiply, multiplyVector, invert } from "../../../core/alpha/matrix.ts";

interface Complex {
  re: number;
  im: number;
}

const cAdd = (a: Complex, b: Complex): Complex => ({ re: a.re + b.re, im: a.im + b.im });
const cSub = (a: Complex, b: Complex): Complex => ({ re: a.re - b.re, im: a.im - b.im });
const cMul = (a: Complex, b: Complex): Complex => ({
  re: a.re * b.re - a.im * b.im,
  im: a.re * b.im + a.im * b.re,
});
const cAbs = (a: Complex): number => Math.hypot(a.re, a.im);
const cDiv = (a: Complex, b: Complex): Complex => {
  const d = b.re * b.re + b.im * b.im;
  return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d };
};

export type CyclePersistence = "persistent" | "decaying" | "growing";

export interface DampedCycle {
  /** Cycle length in bars (2π/ω). Null for a non-oscillatory (trend/DC) component. */
  periodBars: number | null;
  /** Per-bar decay rate λ = ln|z|. <0 decaying, ≈0 persistent, >0 growing. */
  decayPerBar: number;
  /** Amplitude half-life in bars (ln2 / −λ) when decaying; null when persistent/growing. */
  halfLifeBars: number | null;
  amplitude: number;
  phaseRad: number;
  persistence: CyclePersistence;
}

export interface DampedCycleResult {
  components: DampedCycle[];
  /** Period (bars) of the highest-amplitude oscillatory component. */
  dominantPeriodBars: number | null;
  /** Decay rate of that dominant oscillatory component. */
  dominantDecayPerBar: number | null;
  /** Fraction of (mean-centered) variance the fitted components explain ∈ (−∞, 1]. */
  varianceExplained: number;
  order: number;
  sampleSize: number;
  interpretation: string;
}

export interface DampedCycleOptions {
  /** AR / Prony order (≈ 2× the number of cycles to resolve). Default 6. */
  order?: number;
  /** Drop components whose amplitude is below this fraction of the largest. Default 0.05. */
  minAmplitudeFraction?: number;
  /** |λ| ≤ this counts as "persistent". Default 0.01 (per bar). */
  persistenceTolerance?: number;
}

const DEFAULT_ORDER = 6;
const DEFAULT_MIN_AMP_FRAC = 0.05;
const DEFAULT_PERSIST_TOL = 0.01;

function round(x: number, n = 6): number {
  return Number(x.toFixed(n));
}

function neutral(order: number, n: number, why: string): DampedCycleResult {
  return {
    components: [],
    dominantPeriodBars: null,
    dominantDecayPerBar: null,
    varianceExplained: 0,
    order,
    sampleSize: n,
    interpretation: `Neutral — ${why}.`,
  };
}

/** Evaluate a monic descending-coefficient polynomial at a complex point (Horner). */
function evalPoly(coeffs: number[], z: Complex): Complex {
  let acc: Complex = { re: 0, im: 0 };
  for (const c of coeffs) {
    acc = cAdd(cMul(acc, z), { re: c, im: 0 });
  }
  return acc;
}

/** Durand-Kerner: all complex roots of a monic polynomial (coeffs descending, coeffs[0]=1). */
function polyRoots(coeffs: number[]): Complex[] {
  const p = coeffs.length - 1;
  if (p <= 0) return [];
  const seed: Complex = { re: 0.4, im: 0.9 };
  const roots: Complex[] = [];
  let acc: Complex = { re: 1, im: 0 };
  for (let k = 0; k < p; k++) {
    roots.push({ ...acc });
    acc = cMul(acc, seed);
  }
  for (let iter = 0; iter < 500; iter++) {
    let maxDelta = 0;
    for (let k = 0; k < p; k++) {
      const num = evalPoly(coeffs, roots[k]!);
      let den: Complex = { re: 1, im: 0 };
      for (let j = 0; j < p; j++) {
        if (j === k) continue;
        den = cMul(den, cSub(roots[k]!, roots[j]!));
      }
      if (cAbs(den) < 1e-30) continue;
      const delta = cDiv(num, den);
      roots[k] = cSub(roots[k]!, delta);
      maxDelta = Math.max(maxDelta, cAbs(delta));
    }
    if (maxDelta < 1e-12) break;
  }
  return roots;
}

/**
 * Least-squares solve B·c = y (B: rows × cols) with a tiny Tikhonov ridge.
 * The ridge (scaled to the diagonal magnitude) makes over-ordered / rank-
 * deficient fits — exactly what happens when the chosen order exceeds the
 * true number of cycles — degrade gracefully instead of going singular.
 */
function lstsq(B: number[][], y: number[]): number[] | null {
  const Bt = transpose(B);
  const BtB = multiply(Bt, B);
  const m = BtB.length;
  let trace = 0;
  for (let i = 0; i < m; i++) trace += BtB[i]![i]!;
  const ridge = (trace / Math.max(1, m)) * 1e-9;
  for (let i = 0; i < m; i++) BtB[i]![i]! += ridge;
  const inv = invert(BtB);
  if (inv == null) return null;
  const Bty = multiplyVector(Bt, y);
  return multiplyVector(inv, Bty);
}

export function computeDampedCycleDecomposition(input: {
  values: ReadonlyArray<number>;
  options?: DampedCycleOptions;
}): DampedCycleResult {
  const opts = input.options ?? {};
  const order = Math.max(2, Math.floor(opts.order ?? DEFAULT_ORDER));
  const minAmpFrac = opts.minAmplitudeFraction ?? DEFAULT_MIN_AMP_FRAC;
  const persistTol = opts.persistenceTolerance ?? DEFAULT_PERSIST_TOL;

  const raw = (input.values ?? []).filter((v) => Number.isFinite(v));
  const n = raw.length;
  if (n < Math.max(24, 3 * order)) {
    return neutral(order, n, `need ≥ max(24, 3·order=${3 * order}) finite samples, got ${n}`);
  }

  // Mean-center.
  let mean = 0;
  for (const v of raw) mean += v;
  mean /= n;
  const x = raw.map((v) => v - mean);

  let ssTotal = 0;
  for (const v of x) ssTotal += v * v;
  if (ssTotal < 1e-300) return neutral(order, n, "series is constant (no variation to decompose)");

  // Forward linear prediction: x[i] ≈ Σ_{k=1..p} a_k · x[i-k].
  const M: number[][] = [];
  const t: number[] = [];
  for (let i = order; i < n; i++) {
    const row: number[] = [];
    for (let k = 1; k <= order; k++) row.push(x[i - k]!);
    M.push(row);
    t.push(x[i]!);
  }
  const a = lstsq(M, t);
  if (a == null) return neutral(order, n, "linear-prediction normal equations are singular");

  // Characteristic polynomial z^p − a_1 z^{p−1} − … − a_p (monic, descending).
  const coeffs: number[] = [1, ...a.map((v) => -v)];
  const roots = polyRoots(coeffs);

  // Build the real basis: real roots → r^n ; conjugate pairs → r^n cos, r^n sin (once).
  interface Group {
    r: number;
    theta: number; // 0 for real, >0 for the kept representative of a pair
    isPair: boolean;
    colStart: number;
  }
  const groups: Group[] = [];
  const used = new Array<boolean>(roots.length).fill(false);
  const columns: number[][] = []; // each is length n

  for (let i = 0; i < roots.length; i++) {
    if (used[i]) continue;
    const z = roots[i]!;
    const r = cAbs(z);
    const theta = Math.atan2(z.im, z.re);
    if (Math.abs(theta) < 1e-6 || Math.abs(Math.abs(theta) - Math.PI) < 1e-6) {
      // Real root (DC/trend or Nyquist): single r^n column.
      used[i] = true;
      const col: number[] = [];
      for (let m = 0; m < n; m++) col.push(r ** m * (theta === 0 ? 1 : Math.cos(theta * m)));
      groups.push({
        r,
        theta: Math.abs(theta) < 1e-6 ? 0 : Math.PI,
        isPair: false,
        colStart: columns.length,
      });
      columns.push(col);
    } else {
      // Find the conjugate partner.
      let partner = -1;
      for (let j = i + 1; j < roots.length; j++) {
        if (used[j]) continue;
        const zj = roots[j]!;
        if (
          Math.abs(cAbs(zj) - r) < 1e-3 * (1 + r) &&
          Math.abs(Math.atan2(zj.im, zj.re) + theta) < 1e-3
        ) {
          partner = j;
          break;
        }
      }
      used[i] = true;
      if (partner >= 0) used[partner] = true;
      const w = Math.abs(theta);
      const cosCol: number[] = [];
      const sinCol: number[] = [];
      for (let m = 0; m < n; m++) {
        const rn = r ** m;
        cosCol.push(rn * Math.cos(w * m));
        sinCol.push(rn * Math.sin(w * m));
      }
      groups.push({ r, theta: w, isPair: true, colStart: columns.length });
      columns.push(cosCol, sinCol);
    }
  }

  if (columns.length === 0) return neutral(order, n, "no usable cycle components recovered");

  // Real LS over the basis columns to recover amplitudes/phases.
  const B: number[][] = [];
  for (let m = 0; m < n; m++) B.push(columns.map((c) => c[m]!));
  const coef = lstsq(B, x);
  if (coef == null) return neutral(order, n, "amplitude least-squares is singular");

  // Reconstruct + variance explained.
  const fitted = new Array<number>(n).fill(0);
  for (let m = 0; m < n; m++) {
    let s = 0;
    for (let c = 0; c < columns.length; c++) s += coef[c]! * columns[c]![m]!;
    fitted[m] = s;
  }
  let ssResid = 0;
  for (let m = 0; m < n; m++) ssResid += (x[m]! - fitted[m]!) ** 2;
  const varianceExplained = 1 - ssResid / ssTotal;

  // Assemble components.
  const comps: DampedCycle[] = groups.map((g) => {
    const lambda = Math.log(g.r);
    let amplitude: number;
    let phase: number;
    if (g.isPair) {
      const cc = coef[g.colStart]!;
      const cs = coef[g.colStart + 1]!;
      amplitude = Math.hypot(cc, cs);
      phase = Math.atan2(-cs, cc);
    } else {
      amplitude = Math.abs(coef[g.colStart]!);
      phase = coef[g.colStart]! >= 0 ? 0 : Math.PI;
    }
    const oscillatory = g.isPair && g.theta > 1e-6;
    const periodBars = oscillatory ? (2 * Math.PI) / g.theta : null;
    const persistence: CyclePersistence =
      lambda > persistTol ? "growing" : lambda < -persistTol ? "decaying" : "persistent";
    // Half-life only for genuinely decaying cycles (persistent/growing → null).
    const halfLifeBars = persistence === "decaying" ? Math.LN2 / -lambda : null;
    return {
      periodBars: periodBars == null ? null : round(periodBars, 3),
      decayPerBar: round(lambda),
      halfLifeBars: halfLifeBars == null ? null : round(halfLifeBars, 3),
      amplitude: round(amplitude),
      phaseRad: round(phase),
      persistence,
    };
  });

  // Drop negligible components, rank by amplitude.
  const maxAmp = comps.reduce((mx, c) => Math.max(mx, c.amplitude), 0);
  const kept = comps
    .filter((c) => maxAmp <= 0 || c.amplitude >= minAmpFrac * maxAmp)
    .sort((p1, p2) => p2.amplitude - p1.amplitude);

  const dominantOsc = kept.find((c) => c.periodBars != null) ?? null;

  let interpretation: string;
  if (dominantOsc == null) {
    interpretation =
      `No oscillatory cycle dominates (components are trend/DC). ` +
      `Variance explained ${round(varianceExplained * 100, 1)}%.`;
  } else {
    const persistNote =
      dominantOsc.persistence === "persistent"
        ? "persistent (standing cycle — exploitable)"
        : dominantOsc.persistence === "decaying"
          ? `decaying (half-life ${dominantOsc.halfLifeBars} bars — cycle is dying, don't fade into it)`
          : "growing (unstable/expanding — treat with caution)";
    interpretation =
      `Dominant cycle ≈ ${dominantOsc.periodBars} bars, λ=${dominantOsc.decayPerBar}/bar → ${persistNote}. ` +
      `${kept.length} component(s), variance explained ${round(varianceExplained * 100, 1)}%. ` +
      `Complements MESA (power) / Hilbert (phase) with per-cycle persistence; sensitive to noise — feed a detrended series.`;
  }

  return {
    components: kept,
    dominantPeriodBars: dominantOsc?.periodBars ?? null,
    dominantDecayPerBar: dominantOsc?.decayPerBar ?? null,
    varianceExplained: round(varianceExplained),
    order,
    sampleSize: n,
    interpretation,
  };
}
