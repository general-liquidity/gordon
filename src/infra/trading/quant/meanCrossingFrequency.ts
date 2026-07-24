/**
 * Mean-Crossing Frequency (GORDON_MEAN_CROSSING_FREQUENCY).
 *
 * Port of Ch 3.5 condition 4 from Sarmento & Horta, "A Machine Learning based
 * Pairs Trading Investment Strategy" (Springer 2020).
 *
 * Counts how often a spread series crosses its own mean and annualises that
 * count. Sarmento's eligibility rule requires a tradable pair's spread to
 * cross its mean at least 12 times/year (≥ once per month) — without this
 * frequency the spread reverts too slowly to generate exit opportunities
 * even when it is statistically mean-reverting.
 *
 * Direct quote (p. 32):
 *   "we enforce that every spread crosses its mean at least once per month,
 *    to provide enough liquidity. … both properties [mean-crossing count and
 *    half-life] are not necessarily interchangeable. Adding this constraint
 *    might not merely enforce the previous condition but also discard pairs
 *    that in spite of meeting the mean-reversion timing conditions, do not
 *    cross the mean, providing no opportunities to exit a position."
 *
 * Useful beyond pairs trading — any oscillator/spread strategy benefits from
 * a "did the signal actually cross zero often enough to trade" diagnostic.
 *
 * Pure compute. No I/O.
 */

export interface MeanCrossingFrequencyInput {
  /** Time series (e.g. a cointegration spread). */
  series: ReadonlyArray<number>;
  /** Periods per year for annualisation (e.g. 252 daily, 52 weekly, 12 monthly). Default 252. */
  periodsPerYear?: number;
  /** Override the mean instead of computing it from the series (e.g. theoretical 0 for a residual). */
  reference?: number;
}

export interface MeanCrossingFrequencyResult {
  /** Number of zero-crossings of (series − reference). */
  crossingCount: number;
  /** crossingCount × (periodsPerYear / series.length). */
  crossingsPerYear: number;
  /** Reference value used (either explicit `reference` or the sample mean). */
  referenceValue: number;
  /** Sample size used. */
  sampleSize: number;
  reasoning: string;
}

export function computeMeanCrossingFrequency(
  input: MeanCrossingFrequencyInput,
): MeanCrossingFrequencyResult {
  const series = input.series;
  const ppy = input.periodsPerYear ?? 252;
  const N = series.length;

  if (N < 2) {
    return {
      crossingCount: 0,
      crossingsPerYear: 0,
      referenceValue: input.reference ?? (N === 1 ? series[0]! : 0),
      sampleSize: N,
      reasoning: `series length ${N} < 2; no crossings possible`,
    };
  }

  let reference: number;
  if (input.reference !== undefined) {
    reference = input.reference;
  } else {
    let sum = 0;
    for (const x of series) sum += x;
    reference = sum / N;
  }

  let count = 0;
  for (let i = 1; i < N; i++) {
    const a = series[i - 1]! - reference;
    const b = series[i]! - reference;
    // A crossing occurs when the sign of (series - reference) flips. We
    // treat the strict-zero boundary as a crossing (a · b ≤ 0 with at
    // least one of them non-zero) to avoid undercounting when the series
    // touches the mean exactly.
    if (a * b < 0) {
      count++;
    } else if (a === 0 && b !== 0) {
      count++;
    }
  }

  const crossingsPerYear = (count * ppy) / N;

  const reasoning =
    `N=${N}, reference=${reference.toFixed(6)}, ` +
    `crossings=${count}, annualised=${crossingsPerYear.toFixed(2)}/year`;

  return {
    crossingCount: count,
    crossingsPerYear,
    referenceValue: reference,
    sampleSize: N,
    reasoning,
  };
}

export function meanCrossingFrequencyToPayload(
  result: MeanCrossingFrequencyResult,
): Record<string, unknown> {
  return {
    kind: "mean_crossing_frequency.computed",
    crossingCount: result.crossingCount,
    crossingsPerYear: Number(result.crossingsPerYear.toFixed(4)),
    referenceValue: Number(result.referenceValue.toFixed(8)),
    sampleSize: result.sampleSize,
  };
}
