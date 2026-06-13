/**
 * Reference indicator implementations — the differential oracle.
 *
 * Independent, deliberately un-optimized re-implementations of Gordon's core
 * indicators, written straight from the canonical published definitions. They
 * exist to be DIFFERENTIAL-TESTED against the production implementations: if the
 * optimized version in `../<indicator>.ts` diverges from the textbook version
 * here, the bench surfaces it (oracleBench.ts).
 *
 * This is Loop-Driven Development's "oracle" leg applied to Gordon's quant math —
 * measurement over judgment. Honest provenance caveat (per LDD's own ranking):
 * both implementations are first-party, so a shared *definition* error would pass
 * undetected. The bench mitigates that with hand-verifiable golden anchors (a
 * monotone series → RSI 100/0, a constant series → zero-width Bollinger), and the
 * stronger external oracle (TA-Lib / a published conformance vector set) is the
 * documented future plug — slot it in as another reference here.
 *
 * Conventions are matched to the production code on purpose (so the bench is a
 * clean pass/fail gate, not a convention dispute):
 *   - SMA/EMA emit `null` for the first `period-1` samples; EMA is SMA-seeded
 *     with a `2/(period+1)` multiplier (Wilder/standard, TA-Lib-compatible).
 *   - RSI is Wilder (1978): simple first average, then `(prev*(p-1)+cur)/p`
 *     smoothing; `null` for the first `period` samples; zero avg-loss → 100.
 *   - Bollinger uses POPULATION standard deviation (÷n), the band standard.
 */

function mean(xs: number[]): number {
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

/** Simple moving average — arithmetic mean of the trailing window. */
export function refSMA(data: number[], period: number): (number | null)[] {
  if (period <= 0 || data.length < period) return data.map(() => null);
  return data.map((_, i) => (i < period - 1 ? null : mean(data.slice(i - period + 1, i + 1))));
}

/** Exponential moving average — SMA-seeded, multiplier 2/(period+1). */
export function refEMA(data: number[], period: number): (number | null)[] {
  if (period <= 0 || data.length < period) return data.map(() => null);
  const k = 2 / (period + 1);
  const out: (number | null)[] = [];
  for (let i = 0; i < period - 1; i++) out.push(null);
  let ema = mean(data.slice(0, period));
  out.push(ema);
  for (let i = period; i < data.length; i++) {
    ema = (data[i]! - ema) * k + ema;
    out.push(ema);
  }
  return out;
}

/** Linearly-weighted moving average — weights 1..period, most-recent heaviest. */
export function refWMA(data: number[], period: number): (number | null)[] {
  if (period <= 0 || data.length < period) return data.map(() => null);
  const denom = (period * (period + 1)) / 2;
  return data.map((_, i) => {
    if (i < period - 1) return null;
    let s = 0;
    for (let j = 0; j < period; j++) s += data[i - period + 1 + j]! * (j + 1);
    return s / denom;
  });
}

/** Wilder's RSI (1978). */
export function refRSI(closes: number[], period: number): (number | null)[] {
  if (period <= 0 || closes.length < period + 1) return closes.map(() => null);
  const deltas: number[] = [];
  for (let i = 1; i < closes.length; i++) deltas.push(closes[i]! - closes[i - 1]!);

  let g = 0;
  let l = 0;
  for (let i = 0; i < period; i++) {
    const d = deltas[i]!;
    if (d > 0) g += d;
    else l += Math.abs(d);
  }
  g /= period;
  l /= period;

  const rsiOf = (gain: number, loss: number): number => (loss === 0 ? 100 : 100 - 100 / (1 + gain / loss));
  const out: (number | null)[] = [];
  for (let i = 0; i < period; i++) out.push(null);
  out.push(rsiOf(g, l));
  for (let i = period; i < deltas.length; i++) {
    const d = deltas[i]!;
    g = (g * (period - 1) + (d > 0 ? d : 0)) / period;
    l = (l * (period - 1) + (d < 0 ? Math.abs(d) : 0)) / period;
    out.push(rsiOf(g, l));
  }
  return out;
}

/** Population standard deviation (÷n) of a window. */
export function refPopStdDev(window: number[]): number {
  const m = mean(window);
  return Math.sqrt(mean(window.map((v) => (v - m) ** 2)));
}

export interface RefBollinger {
  upper: (number | null)[];
  middle: (number | null)[];
  lower: (number | null)[];
}

/** Bollinger Bands — middle = SMA, bands = SMA ± k·popStdDev(window). */
export function refBollinger(closes: number[], period: number, k: number): RefBollinger {
  const middle = refSMA(closes, period);
  const upper: (number | null)[] = [];
  const lower: (number | null)[] = [];
  for (let i = 0; i < closes.length; i++) {
    const m = middle[i];
    if (i < period - 1 || m === null || m === undefined) {
      upper.push(null);
      lower.push(null);
      continue;
    }
    const sd = refPopStdDev(closes.slice(i - period + 1, i + 1));
    upper.push(m + k * sd);
    lower.push(m - k * sd);
  }
  return { upper, middle, lower };
}
