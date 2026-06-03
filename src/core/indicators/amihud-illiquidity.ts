/**
 * Amihud (2002) Illiquidity Measure
 *
 * Average price impact per unit of dollar volume. For each bar:
 *   impact_t = |return_t| / dollarVolume_t
 * where return_t = close_t / close_{t-1} - 1 and dollarVolume_t = close_t * volume_t.
 * Amihud = mean(impact_t) over the window. Higher = more illiquid (price moves
 * more per dollar traded). Often scaled by 1e6 for readability.
 *
 * Amihud, Y. (2002). "Illiquidity and stock returns: cross-section and
 * time-series effects." Journal of Financial Markets.
 */

import type { Candle } from "./types.ts";

export interface AmihudResult {
  amihud: number; // raw mean |ret| / $vol
  amihudScaled: number; // x 1e6
  window: number;
  sampleSize: number;
  interpretation: string;
}

function neutral(window: number): AmihudResult {
  return {
    amihud: 0,
    amihudScaled: 0,
    window,
    sampleSize: 0,
    interpretation: "Insufficient data to compute Amihud illiquidity.",
  };
}

export function calculateAmihud(
  candles: Candle[],
  opts?: { window?: number },
): AmihudResult {
  if (candles == null || candles.length < 2) {
    return neutral(opts?.window ?? 0);
  }

  // Window counts bars used to derive returns (each return consumes a prior close).
  const maxReturns = candles.length - 1;
  const window =
    opts?.window != null && opts.window > 0
      ? Math.min(opts.window, maxReturns)
      : maxReturns;

  // Take the most recent `window` returns.
  const startIdx = candles.length - window;

  const impacts: number[] = [];
  for (let i = startIdx; i < candles.length; i++) {
    const cur = candles[i]!;
    const prev = candles[i - 1]!;
    const dollarVolume = cur.close * cur.volume;
    if (dollarVolume <= 0) continue; // skip zero/neg dollar-volume bars
    if (prev.close === 0) continue;
    const ret = cur.close / prev.close - 1;
    impacts.push(Math.abs(ret) / dollarVolume);
  }

  if (impacts.length === 0) {
    return neutral(window);
  }

  const amihud = impacts.reduce((a, b) => a + b, 0) / impacts.length;
  const amihudScaled = Number((amihud * 1e6).toFixed(4));

  let interpretation: string;
  if (amihudScaled >= 1) {
    interpretation = `High illiquidity (Amihud x1e6 = ${amihudScaled}): price moves materially per dollar traded.`;
  } else if (amihudScaled >= 0.01) {
    interpretation = `Moderate illiquidity (Amihud x1e6 = ${amihudScaled}).`;
  } else {
    interpretation = `Low illiquidity / deep liquidity (Amihud x1e6 = ${amihudScaled}): price absorbs dollar flow well.`;
  }

  return {
    amihud: Number(amihud.toFixed(12)),
    amihudScaled,
    window,
    sampleSize: impacts.length,
    interpretation,
  };
}
