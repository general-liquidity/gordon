/**
 * CBOE-style Volume-Weighted Bull/Bear/Stagnant Odds Oscillator
 *
 * A three-state probability oscillator derived from a volume-weighted money-flow
 * index (MFI-like) re-weighted by Stoch-RSI momentum.
 *
 * Stage 1 — marketIndex (0..100), MFI-style volume-weighted money-flow bias:
 *   Classify each bar up/down (close vs prior close). Over a rolling `length`
 *   window:
 *     upFlow   = Σ(volume · typicalPrice) on up bars
 *     downFlow = Σ(volume · typicalPrice) on down bars
 *     R = upFlow / downFlow
 *     marketIndex = 100 − 100/(1 + R)
 *   (typicalPrice = (high+low+close)/3). 100 = pure inflow, 0 = pure outflow.
 *
 * Stage 2 — momentum: Stoch-RSI %K computed on the marketIndex series.
 *
 * Stage 3 — DECOMPOSITION (chosen scheme — source weights not fully specified):
 *   bias = (marketIndex − 50) / 50          ∈ [−1, 1]   directional pull
 *   mom  = (%K − 50) / 50                    ∈ [−1, 1]   momentum confirmation
 *   agree = sign(bias) === sign(mom) ? +1 : −1
 *   w = 1 + 0.5·agree·|mom|                  ∈ [0.5, 1.5]  momentum modulator
 *   directionalStrength = clamp01( |bias| · w )
 *   oddStagnant = (1 − directionalStrength) · 100
 *   directional = directionalStrength · 100, routed entirely to the side of
 *   sign(bias): bias ≥ 0 → oddBull, bias < 0 → oddBear.
 *
 * Momentum is a modulator centred at 1 (w=1 when momentum is unknown/flat) so a
 * lack of momentum data never penalises a saturated flow bias. Confirming
 * momentum amplifies (up to ×1.5, clamped); disagreeing momentum damps (×0.5).
 *
 * Properties: oddBull + oddBear + oddStagnant ≡ 100; each ∈ [0,100]; monotonic
 * in |bias| and in confirming momentum. Stagnant peaks when marketIndex ≈ 50
 * (bias≈0) and/or momentum disagrees with the bias (chop / indecision).
 *
 * Reuses calculateStochasticRSI for the %K re-weighting.
 */

import type { Candle } from "./types.ts";
import { calculateStochasticRSI } from "./stochastic-rsi.ts";

export interface CboeOddsResult {
  /** Volume-weighted money-flow bias 0..100 (null in warmup) */
  marketIndex: (number | null)[];
  /** P(bull) 0..100 (null in warmup) */
  oddBull: (number | null)[];
  /** P(bear) 0..100 (null in warmup) */
  oddBear: (number | null)[];
  /** P(stagnant / range) 0..100 (null in warmup) */
  oddStagnant: (number | null)[];
  current: {
    marketIndex: number | null;
    oddBull: number | null;
    oddBear: number | null;
    oddStagnant: number | null;
    state: "bull" | "bear" | "stagnant" | null;
  };
  interpretation: string;
}

function clamp01(x: number): number {
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

/**
 * Calculate the CBOE-style volume-weighted odds oscillator.
 *
 * @param candles - OHLCV candle array
 * @param params.length - money-flow rolling window (default 14)
 * @param params.rsiPeriod - Stoch-RSI RSI period (default 14)
 * @param params.stochPeriod - Stoch-RSI stochastic lookback (default 14)
 * @returns CboeOddsResult
 */
export function calculateCboeOdds(
  candles: Candle[],
  params?: { length?: number; rsiPeriod?: number; stochPeriod?: number }
): CboeOddsResult {
  const length = params?.length ?? 14;
  const rsiPeriod = params?.rsiPeriod ?? 14;
  const stochPeriod = params?.stochPeriod ?? 14;
  const n = candles.length;

  const empty = (): CboeOddsResult => ({
    marketIndex: candles.map(() => null),
    oddBull: candles.map(() => null),
    oddBear: candles.map(() => null),
    oddStagnant: candles.map(() => null),
    current: {
      marketIndex: null,
      oddBull: null,
      oddBear: null,
      oddStagnant: null,
      state: null,
    },
    interpretation: "Insufficient data for CBOE odds oscillator",
  });

  if (n < length + 1) {
    return empty();
  }

  const typical: number[] = candles.map((c) => (c.high + c.low + c.close) / 3);

  // Per-bar up/down flow contribution (close vs prior close).
  const upContrib: number[] = new Array(n).fill(0);
  const downContrib: number[] = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    const flow = typical[i]! * candles[i]!.volume;
    if (candles[i]!.close > candles[i - 1]!.close) {
      upContrib[i] = flow;
    } else if (candles[i]!.close < candles[i - 1]!.close) {
      downContrib[i] = flow;
    }
  }

  // Stage 1: rolling marketIndex.
  const marketIndex: (number | null)[] = new Array(n).fill(null);
  for (let i = length; i < n; i++) {
    let up = 0;
    let down = 0;
    for (let j = i - length + 1; j <= i; j++) {
      up += upContrib[j]!;
      down += downContrib[j]!;
    }
    let mi: number;
    if (down < 1e-12) {
      mi = up < 1e-12 ? 50 : 100;
    } else {
      const r = up / down;
      mi = 100 - 100 / (1 + r);
    }
    marketIndex[i] = mi;
  }

  // Stage 2: Stoch-RSI %K on the marketIndex series. Feed a dense numeric
  // series (use 50 for warmup slots so indexing stays aligned to candle bars).
  const miSeries: number[] = marketIndex.map((v) => (v == null ? 50 : v));
  const stoch = calculateStochasticRSI(miSeries, rsiPeriod, stochPeriod, 3, 3);

  // Stage 3: decomposition.
  const oddBull: (number | null)[] = new Array(n).fill(null);
  const oddBear: (number | null)[] = new Array(n).fill(null);
  const oddStagnant: (number | null)[] = new Array(n).fill(null);

  for (let i = 0; i < n; i++) {
    const mi = marketIndex[i];
    if (mi == null) continue;

    const bias = (mi - 50) / 50; // [-1, 1]
    const k = stoch.k[i];
    const mom = k == null ? 0 : (k - 50) / 50; // [-1, 1], 0 when momentum unknown

    const biasSign = bias >= 0 ? 1 : -1;
    const momSign = mom >= 0 ? 1 : -1;
    const agree = biasSign === momSign ? 1 : -1;

    const w = 1 + 0.5 * agree * Math.abs(mom);
    const directionalStrength = clamp01(Math.abs(bias) * w);
    const stagnant = (1 - directionalStrength) * 100;
    const directional = directionalStrength * 100;

    const bull = bias >= 0 ? directional : 0;
    const bear = bias < 0 ? directional : 0;

    oddBull[i] = parseFloat(bull.toFixed(2));
    oddBear[i] = parseFloat(bear.toFixed(2));
    oddStagnant[i] = parseFloat(stagnant.toFixed(2));
  }

  const curMI = marketIndex[n - 1] ?? null;
  const curBull = oddBull[n - 1] ?? null;
  const curBear = oddBear[n - 1] ?? null;
  const curStag = oddStagnant[n - 1] ?? null;

  let state: "bull" | "bear" | "stagnant" | null = null;
  if (curBull != null && curBear != null && curStag != null) {
    if (curStag >= curBull && curStag >= curBear) state = "stagnant";
    else if (curBull >= curBear) state = "bull";
    else state = "bear";
  }

  const interpretation = buildInterpretation(curMI, curBull, curBear, curStag, state);

  return {
    marketIndex,
    oddBull,
    oddBear,
    oddStagnant,
    current: {
      marketIndex: curMI == null ? null : parseFloat(curMI.toFixed(2)),
      oddBull: curBull,
      oddBear: curBear,
      oddStagnant: curStag,
      state,
    },
    interpretation,
  };
}

function buildInterpretation(
  mi: number | null,
  bull: number | null,
  bear: number | null,
  stag: number | null,
  state: "bull" | "bear" | "stagnant" | null
): string {
  if (mi == null || bull == null || bear == null || stag == null) {
    return "Insufficient data for CBOE odds oscillator.";
  }

  const odds = `Bull ${bull.toFixed(0)}% / Bear ${bear.toFixed(0)}% / Stagnant ${stag.toFixed(0)}%`;
  let msg = `CBOE Odds: market-index ${mi.toFixed(1)} (volume-weighted flow bias). ${odds}. `;

  if (state === "bull") {
    msg += "Inflow + confirming momentum favor the BULL case.";
  } else if (state === "bear") {
    msg += "Outflow + confirming momentum favor the BEAR case.";
  } else {
    msg += "Flow near balance or momentum at odds with bias — STAGNANT/range most likely.";
  }

  return msg;
}
