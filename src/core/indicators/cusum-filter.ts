import type { Candle } from "./types.ts";

/**
 * López de Prado symmetric CUSUM filter — an event sampler that flags bars
 * where the cumulative change since the last event exceeds a threshold.
 */
export interface CusumFilterResult {
  eventIndices: number[];
  eventCount: number;
  threshold: number;
  lastEventIndex: number | null;
  firedThisBar: boolean;
  interpretation: string;
}

function stdev(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance =
    values.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (n - 1);
  return Math.sqrt(variance);
}

export function calculateCusumFilter(
  candles: Candle[],
  opts?: { threshold?: number },
): CusumFilterResult {
  if (candles.length < 3) {
    return {
      eventIndices: [],
      eventCount: 0,
      threshold: 0,
      lastEventIndex: null,
      firedThisBar: false,
      interpretation: "Insufficient data (need at least 3 candles).",
    };
  }

  const logReturns: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1]!.close;
    const curr = candles[i]!.close;
    logReturns.push(Math.log(curr / prev));
  }

  const rawThreshold =
    opts?.threshold != null ? opts.threshold : stdev(logReturns);
  const threshold = Number(rawThreshold.toFixed(8));

  const eventIndices: number[] = [];
  let sPos = 0;
  let sNeg = 0;

  for (let i = 0; i < logReturns.length; i++) {
    const r = logReturns[i]!;
    const barIndex = i + 1; // logReturns[i] corresponds to candles[i+1]
    sPos = Math.max(0, sPos + r);
    sNeg = Math.min(0, sNeg + r);

    if (sPos >= threshold) {
      eventIndices.push(barIndex);
      sPos = 0;
    } else if (sNeg <= -threshold) {
      eventIndices.push(barIndex);
      sNeg = 0;
    }
  }

  const lastBarIndex = candles.length - 1;
  const lastEventIndex =
    eventIndices.length > 0 ? eventIndices[eventIndices.length - 1]! : null;
  const firedThisBar = lastEventIndex === lastBarIndex;

  let interpretation: string;
  if (eventIndices.length === 0) {
    interpretation = `No CUSUM events — cumulative change stayed within ±${threshold} (no significant change-points).`;
  } else {
    interpretation = `${eventIndices.length} CUSUM event(s) at threshold ${threshold}.${
      firedThisBar ? " Event fired on the latest bar." : ""
    }`;
  }

  return {
    eventIndices,
    eventCount: eventIndices.length,
    threshold,
    lastEventIndex,
    firedThisBar,
    interpretation,
  };
}
