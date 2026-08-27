/**
 * Pring's KST — Know Sure Thing (GORDON_KST_INDEX).
 *
 * From TSaM Ch 19. Composite momentum indicator: four smoothed rate-of-
 * change series at progressively longer horizons, weighted 1/2/3/4 and
 * summed. A signal line (9-period MA of the KST) provides crossover
 * entries.
 *
 *   ROC1 = SMA(ROC(price, 10), 10)
 *   ROC2 = SMA(ROC(price, 15), 10)
 *   ROC3 = SMA(ROC(price, 20), 10)
 *   ROC4 = SMA(ROC(price, 30), 15)
 *   KST  = 1·ROC1 + 2·ROC2 + 3·ROC3 + 4·ROC4
 *
 * Pring designed KST to detect the dominant momentum at intermediate
 * horizons while filtering high-frequency noise.
 */

export interface KstInput {
  prices: ReadonlyArray<number>;
  /** ROC periods (length 4). Default [10, 15, 20, 30]. */
  rocPeriods?: [number, number, number, number];
  /** SMA periods applied to each ROC (length 4). Default [10, 10, 10, 15]. */
  smoothingPeriods?: [number, number, number, number];
  /** Weights for each smoothed ROC. Default [1, 2, 3, 4]. */
  weights?: [number, number, number, number];
  /** Signal-line SMA period over the KST. Default 9. */
  signalPeriod?: number;
}

export type KstCross = "bullish" | "bearish" | "none";

export interface KstResult {
  kst: number[];
  signal: number[];
  currentKst: number;
  currentSignal: number;
  lastCross: KstCross;
  sampleSize: number;
  reasoning: string;
}

const DEFAULT_ROC_PERIODS: [number, number, number, number] = [10, 15, 20, 30];
const DEFAULT_SMOOTH_PERIODS: [number, number, number, number] = [10, 10, 10, 15];
const DEFAULT_WEIGHTS: [number, number, number, number] = [1, 2, 3, 4];
const DEFAULT_SIGNAL = 9;

function rocSeries(prices: ReadonlyArray<number>, period: number): number[] {
  const out: number[] = new Array(prices.length).fill(Number.NaN);
  for (let i = period; i < prices.length; i++) {
    const prev = prices[i - period]!;
    if (prev !== 0) out[i] = ((prices[i]! - prev) / prev) * 100;
  }
  return out;
}

function smaSeries(values: ReadonlyArray<number>, period: number): number[] {
  const out: number[] = new Array(values.length).fill(Number.NaN);
  for (let i = period - 1; i < values.length; i++) {
    let sum = 0;
    let count = 0;
    for (let j = i - period + 1; j <= i; j++) {
      if (Number.isFinite(values[j]!)) {
        sum += values[j]!;
        count++;
      }
    }
    if (count === period) out[i] = sum / count;
  }
  return out;
}

export function computeKst(input: KstInput): KstResult {
  const rocPeriods = input.rocPeriods ?? DEFAULT_ROC_PERIODS;
  const smoothPeriods = input.smoothingPeriods ?? DEFAULT_SMOOTH_PERIODS;
  const weights = input.weights ?? DEFAULT_WEIGHTS;
  const signalPeriod = input.signalPeriod ?? DEFAULT_SIGNAL;
  const prices = input.prices;
  const n = prices.length;

  const minRequired = Math.max(...rocPeriods.map((r, i) => r + smoothPeriods[i]!));
  if (n < minRequired) {
    return {
      kst: new Array(n).fill(Number.NaN),
      signal: new Array(n).fill(Number.NaN),
      currentKst: Number.NaN,
      currentSignal: Number.NaN,
      lastCross: "none",
      sampleSize: n,
      reasoning: `need at least ${minRequired} prices, got ${n}`,
    };
  }

  const smoothed = rocPeriods.map((rp, i) => smaSeries(rocSeries(prices, rp), smoothPeriods[i]!));
  const kst: number[] = new Array(n).fill(Number.NaN);
  for (let i = 0; i < n; i++) {
    let allFinite = true;
    let sum = 0;
    for (let k = 0; k < 4; k++) {
      if (!Number.isFinite(smoothed[k]![i]!)) {
        allFinite = false;
        break;
      }
      sum += weights[k]! * smoothed[k]![i]!;
    }
    if (allFinite) kst[i] = sum;
  }

  const signal = smaSeries(kst, signalPeriod);

  let lastCross: KstCross = "none";
  for (let i = n - 1; i > 1; i--) {
    const kPrev = kst[i - 1]!;
    const sPrev = signal[i - 1]!;
    const kNow = kst[i]!;
    const sNow = signal[i]!;
    if ([kPrev, sPrev, kNow, sNow].some((v) => !Number.isFinite(v))) continue;
    if (kPrev <= sPrev && kNow > sNow) {
      lastCross = "bullish";
      break;
    }
    if (kPrev >= sPrev && kNow < sNow) {
      lastCross = "bearish";
      break;
    }
  }

  const currentKst = kst[n - 1]!;
  const currentSignal = signal[n - 1]!;
  return {
    kst,
    signal,
    currentKst,
    currentSignal,
    lastCross,
    sampleSize: n,
    reasoning: `KST ${Number.isFinite(currentKst) ? currentKst.toFixed(3) : "n/a"}, signal ${Number.isFinite(currentSignal) ? currentSignal.toFixed(3) : "n/a"}, last cross: ${lastCross}`,
  };
}

export function kstToPayload(result: KstResult): Record<string, unknown> {
  return {
    kind: "kst_index.computed",
    currentKst: Number.isFinite(result.currentKst) ? Number(result.currentKst.toFixed(4)) : null,
    currentSignal: Number.isFinite(result.currentSignal)
      ? Number(result.currentSignal.toFixed(4))
      : null,
    lastCross: result.lastCross,
    sampleSize: result.sampleSize,
  };
}
