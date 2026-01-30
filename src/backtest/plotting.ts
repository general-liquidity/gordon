/**
 * Backtest Plotting Utilities
 */

import asciichart from "asciichart";
import type { OHLC } from "./types.ts";

function downsample(values: number[], maxPoints: number): number[] {
  if (values.length <= maxPoints) {
    return values;
  }

  const step = Math.ceil(values.length / maxPoints);
  const sampled: number[] = [];
  for (let i = 0; i < values.length; i += step) {
    sampled.push(values[i]!);
  }
  return sampled;
}

export function generateBacktestChart(
  ohlcData: OHLC[],
  stats: { equityCurve?: number[] } = {},
  title: string = "Backtest Result"
): { status: "success" | "error"; chart?: string; title?: string; error?: string } {
  try {
    if (ohlcData.length === 0) {
      return { status: "error", error: "No OHLC data provided" };
    }

    const prices = downsample(ohlcData.map((bar) => bar.close), 120);
    const equity = stats.equityCurve ? downsample(stats.equityCurve, 120) : null;

    const series = equity ? [prices, equity] : [prices];

    const chart = asciichart.plot(series, {
      height: 12,
      format: (value: number) => value.toFixed(2),
    });

    return {
      status: "success",
      chart: `${title}\n${chart}`,
      title,
    };
  } catch (error) {
    return {
      status: "error",
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
