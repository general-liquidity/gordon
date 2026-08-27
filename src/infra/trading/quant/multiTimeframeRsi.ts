/**
 * Multi-Timeframe RSI Weighted Alignment (GORDON_MTF_RSI).
 *
 * Computes RSI across multiple timeframes (5m / 15m / 1h / 4h / 1d / 1w
 * by default, or any caller-supplied subset) and folds them into a
 * single weighted directional bias.
 *
 * Higher-timeframe RSIs receive more weight in the consensus — a daily
 * RSI of 75 is structurally more important than a 5-minute RSI of 75.
 * The output flags how many timeframes agree on a zone (oversold /
 * overbought / neutral) which is a cleaner signal than any single
 * timeframe in isolation.
 *
 * Complements Gordon's existing single-timeframe `regime/detector.ts`
 * which does hourly+daily *regime* consensus but not RSI-level alignment.
 *
 * Pure compute. No I/O.
 */

export type Timeframe = "5m" | "15m" | "1h" | "4h" | "1d" | "1w";

export interface MtfRsiInput {
  /** Per-timeframe close-price arrays, oldest-first. Missing timeframes are skipped. */
  closes: Partial<Record<Timeframe, ReadonlyArray<number>>>;
  /** RSI period (Wilder). Default 14. */
  rsiPeriod?: number;
  /** Optional weight override per timeframe. Defaults to higher-TF-heavier scaling. */
  weights?: Partial<Record<Timeframe, number>>;
  /** Overbought level. Default 70. */
  overbought?: number;
  /** Oversold level. Default 30. */
  oversold?: number;
}

export type MtfRsiZone = "overbought" | "uptrend" | "neutral" | "downtrend" | "oversold";

export interface PerTimeframeRsi {
  timeframe: Timeframe;
  rsi: number;
  zone: MtfRsiZone;
  weight: number;
}

export type MtfRsiBias = "long" | "short" | "neutral";

export interface MtfRsiResult {
  perTimeframe: PerTimeframeRsi[];
  weightedAverage: number;
  dominantZone: MtfRsiZone;
  alignedCount: number;
  totalCount: number;
  bias: MtfRsiBias;
  reasoning: string;
}

const DEFAULT_RSI_PERIOD = 14;
const DEFAULT_OVERBOUGHT = 70;
const DEFAULT_OVERSOLD = 30;

// Higher timeframes get more weight. Calibrated so that a single daily
// signal counts roughly the same as three 5-minute signals.
const DEFAULT_WEIGHTS: Record<Timeframe, number> = {
  "5m": 1,
  "15m": 2,
  "1h": 3,
  "4h": 4,
  "1d": 5,
  "1w": 6,
};

const TF_ORDER: Timeframe[] = ["5m", "15m", "1h", "4h", "1d", "1w"];

function calcWilderRsi(prices: ReadonlyArray<number>, period: number): number {
  if (prices.length < period + 1) return Number.NaN;
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const d = prices[i]! - prices[i - 1]!;
    if (d > 0) avgGain += d;
    else avgLoss += -d;
  }
  avgGain /= period;
  avgLoss /= period;
  for (let i = period + 1; i < prices.length; i++) {
    const d = prices[i]! - prices[i - 1]!;
    const gain = d > 0 ? d : 0;
    const loss = d < 0 ? -d : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }
  return avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
}

function classifyZone(rsi: number, overbought: number, oversold: number): MtfRsiZone {
  if (rsi > overbought) return "overbought";
  if (rsi >= 60) return "uptrend";
  if (rsi < oversold) return "oversold";
  if (rsi <= 40) return "downtrend";
  return "neutral";
}

export function computeMtfRsi(input: MtfRsiInput): MtfRsiResult {
  const period = input.rsiPeriod ?? DEFAULT_RSI_PERIOD;
  const overbought = input.overbought ?? DEFAULT_OVERBOUGHT;
  const oversold = input.oversold ?? DEFAULT_OVERSOLD;
  const weights = { ...DEFAULT_WEIGHTS, ...(input.weights ?? {}) };

  const perTimeframe: PerTimeframeRsi[] = [];
  for (const tf of TF_ORDER) {
    const closes = input.closes[tf];
    if (!closes || closes.length < period + 1) continue;
    const rsi = calcWilderRsi(closes, period);
    if (!Number.isFinite(rsi)) continue;
    perTimeframe.push({
      timeframe: tf,
      rsi,
      zone: classifyZone(rsi, overbought, oversold),
      weight: weights[tf] ?? 1,
    });
  }

  if (perTimeframe.length === 0) {
    return {
      perTimeframe: [],
      weightedAverage: Number.NaN,
      dominantZone: "neutral",
      alignedCount: 0,
      totalCount: 0,
      bias: "neutral",
      reasoning: "no timeframe had enough data",
    };
  }

  let totalWeight = 0;
  let weightedRsi = 0;
  const zoneCounts: Record<MtfRsiZone, number> = {
    overbought: 0,
    uptrend: 0,
    neutral: 0,
    downtrend: 0,
    oversold: 0,
  };
  for (const entry of perTimeframe) {
    totalWeight += entry.weight;
    weightedRsi += entry.rsi * entry.weight;
    zoneCounts[entry.zone]++;
  }
  const weightedAverage = weightedRsi / totalWeight;

  let dominantZone: MtfRsiZone = "neutral";
  let bestCount = 0;
  for (const z of Object.keys(zoneCounts) as MtfRsiZone[]) {
    if (zoneCounts[z] > bestCount) {
      bestCount = zoneCounts[z];
      dominantZone = z;
    }
  }
  const alignedCount = bestCount;

  // Bias: weighted RSI determines the directional lean. Extremes flip
  // to mean-reversion (multiple TF overbought → expect pullback → short bias).
  let bias: MtfRsiBias = "neutral";
  if (weightedAverage > overbought && zoneCounts.overbought >= 2) bias = "short";
  else if (weightedAverage < oversold && zoneCounts.oversold >= 2) bias = "long";
  else if (dominantZone === "uptrend") bias = "long";
  else if (dominantZone === "downtrend") bias = "short";

  const reasoning =
    `${perTimeframe.length} TFs analysed, weighted RSI=${weightedAverage.toFixed(1)}, ` +
    `${alignedCount}/${perTimeframe.length} aligned in ${dominantZone} → ${bias}`;

  return {
    perTimeframe,
    weightedAverage,
    dominantZone,
    alignedCount,
    totalCount: perTimeframe.length,
    bias,
    reasoning,
  };
}

export function mtfRsiToPayload(result: MtfRsiResult): Record<string, unknown> {
  return {
    kind: "mtf_rsi.computed",
    weightedAverage: Number.isFinite(result.weightedAverage)
      ? Number(result.weightedAverage.toFixed(2))
      : null,
    dominantZone: result.dominantZone,
    bias: result.bias,
    alignedCount: result.alignedCount,
    totalCount: result.totalCount,
    perTimeframe: result.perTimeframe.map((e) => ({
      timeframe: e.timeframe,
      rsi: Number(e.rsi.toFixed(2)),
      zone: e.zone,
    })),
  };
}
