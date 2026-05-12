/**
 * Alpha Decay Analysis
 */

export interface AlphaDecayResult {
  baselineValue: number;
  delays: number[];
  metricValues: number[];
  decayRates: number[];
  maxTolerableDelay: number | null;
  decayAt1Min: number | null;
  decayAt5Min: number | null;
  decayAt15Min: number | null;
  decayAt60Min: number | null;
  summary: {
    baselinePerformance: number;
    worstPerformance: number;
    worstDelay: number;
    maxDecayPercent: number;
  };
}

export function analyzeAlphaDecay(
  results: Record<number, Record<string, unknown>>,
  metric: string = "return_pct"
): AlphaDecayResult | { error: string } {
  const delays = Object.keys(results)
    .map((key) => Number(key))
    .filter((value) => !Number.isNaN(value))
    .filter((delay) => {
      const entry = results[delay];
      return entry && typeof entry === "object" && !("error" in entry);
    })
    .sort((a, b) => a - b);

  if (delays.length === 0) {
    return { error: "No valid results found" };
  }

  const metricValues = delays.map((delay) => {
    const entry = results[delay] ?? {};
    const value = entry[metric];
    return typeof value === "number" ? value : 0;
  });

  if (metricValues.length === 0) {
    return { error: "No metric values found" };
  }

  const baselineValue = metricValues[0] ?? 0;

  const decayRates = metricValues.map((value, index) => {
    if (index === 0) {
      return 0;
    }
    if (baselineValue === 0) {
      return 0;
    }
    return ((baselineValue - value) / Math.abs(baselineValue)) * 100;
  });

  let maxTolerableDelay: number | null = null;
  for (let i = 0; i < decayRates.length; i++) {
    const rate = decayRates[i];
    if (rate !== undefined && rate < 10) {
      maxTolerableDelay = delays[i] ?? null;
    } else {
      break;
    }
  }

  const decayAtDelay = (target: number): number | null => {
    const idx = delays.indexOf(target);
    return idx >= 0 ? decayRates[idx] ?? null : null;
  };

  const worstPerformance = Math.min(...metricValues);
  const worstIndex = metricValues.indexOf(worstPerformance);

  return {
    baselineValue,
    delays,
    metricValues,
    decayRates,
    maxTolerableDelay,
    decayAt1Min: decayAtDelay(1),
    decayAt5Min: decayAtDelay(5),
    decayAt15Min: decayAtDelay(15),
    decayAt60Min: decayAtDelay(60),
    summary: {
      baselinePerformance: baselineValue,
      worstPerformance,
      worstDelay: delays[worstIndex] ?? delays[0] ?? 0,
      maxDecayPercent: decayRates.length > 0 ? Math.max(...decayRates) : 0,
    },
  };
}
