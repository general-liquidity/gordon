/**
 * Time Under Water (TUW) — the drawdown metric backtests ignore.
 *
 * From Kieran Duff, "Time under water: the metric your backtest ignores".
 * Max-drawdown captures DEPTH; it says nothing about DURATION. Two identical
 * 5% drawdowns are different products if one recovers in three weeks and the
 * other in ten months — the second is the one that loses allocators across an
 * annual review. TUW measures how long the equity curve stays below its prior
 * peak.
 *
 * Distinct from recoveryFactor.ts (depth + peak/trough of the single largest
 * drawdown, no duration) and risk-ratio-triple.ts (Calmar, no time dimension).
 * This walks every underwater EPISODE and reports duration statistics + the
 * MAR ratio (CAGR / maxDD) the letter pairs with it.
 *
 * Durations are in PERIODS (the caller's bar size). Pure compute, O(N).
 */

export interface TimeUnderWaterInput {
  /** Per-period returns, e.g. [0.01, -0.02, 0.005, ...]. */
  returns: ReadonlyArray<number>;
  initialEquity?: number;
  /** "compound" (product of 1+r) or "simple" (sum). Default "compound". */
  compoundMode?: "simple" | "compound";
  /** Periods per year — enables CAGR + MAR. Omit to skip MAR. */
  periodsPerYear?: number;
}

export interface UnderwaterEpisode {
  /** Index of the peak the curve fell from. */
  peakIndex: number;
  /** Index of the deepest point of the episode. */
  troughIndex: number;
  /** Index where the prior peak was reclaimed; null if still underwater. */
  recoveryIndex: number | null;
  /** Periods from peak to recovery (or to series end if ongoing). */
  durationPeriods: number;
  /** Episode depth as a fraction of the peak. */
  depthPct: number;
  ongoing: boolean;
}

export interface TimeUnderWaterResult {
  /** Longest underwater spell in periods (the headline TUW). */
  maxUnderwaterPeriods: number;
  /** Periods underwater right now (0 if at a high). */
  currentUnderwaterPeriods: number;
  currentlyUnderwater: boolean;
  /** Fraction of periods spent below a prior peak. */
  pctTimeUnderwater: number;
  numEpisodes: number;
  avgUnderwaterPeriods: number;
  /** Deepest drawdown over the series, as a fraction. */
  maxDrawdownPct: number;
  /** CAGR / maxDrawdownPct. Null when periodsPerYear absent or maxDD = 0. */
  mar: number | null;
  episodes: UnderwaterEpisode[];
  sampleSize: number;
  interpretation: string;
}

const round = (x: number, n: number) => parseFloat(x.toFixed(n));

export function computeTimeUnderWater(input: TimeUnderWaterInput): TimeUnderWaterResult {
  const returns = input.returns;
  const N = returns.length;
  const initial = input.initialEquity ?? 1;
  const mode = input.compoundMode ?? "compound";

  const neutral: TimeUnderWaterResult = {
    maxUnderwaterPeriods: 0,
    currentUnderwaterPeriods: 0,
    currentlyUnderwater: false,
    pctTimeUnderwater: 0,
    numEpisodes: 0,
    avgUnderwaterPeriods: 0,
    maxDrawdownPct: 0,
    mar: null,
    episodes: [],
    sampleSize: N,
    interpretation: "Insufficient data for time-under-water",
  };
  if (N === 0) return neutral;
  if (initial <= 0) throw new Error("initialEquity must be positive");

  const equity = new Array<number>(N + 1);
  equity[0] = initial;
  for (let i = 0; i < N; i++) {
    equity[i + 1] =
      mode === "compound" ? equity[i]! * (1 + returns[i]!) : equity[i]! + returns[i]! * initial;
  }

  const episodes: UnderwaterEpisode[] = [];
  let runningPeak = equity[0]!;
  let peakIdx = 0;
  let underwaterCount = 0;
  let maxDrawdownPct = 0;

  let inEpisode = false;
  let epPeakIdx = 0;
  let epTroughIdx = 0;
  let epTroughEquity = Infinity;

  const closeEpisode = (recoveryIdx: number | null, endIdx: number) => {
    const peakEq = equity[epPeakIdx]!;
    const depthPct = peakEq > 0 ? (peakEq - epTroughEquity) / peakEq : 0;
    episodes.push({
      peakIndex: epPeakIdx,
      troughIndex: epTroughIdx,
      recoveryIndex: recoveryIdx,
      durationPeriods: endIdx - epPeakIdx,
      depthPct: round(depthPct, 6),
      ongoing: recoveryIdx === null,
    });
  };

  for (let i = 1; i <= N; i++) {
    const e = equity[i]!;
    if (e >= runningPeak) {
      if (inEpisode) {
        closeEpisode(i, i);
        inEpisode = false;
      }
      runningPeak = e;
      peakIdx = i;
    } else {
      underwaterCount++;
      const ddPct = (runningPeak - e) / runningPeak;
      if (ddPct > maxDrawdownPct) maxDrawdownPct = ddPct;
      if (!inEpisode) {
        inEpisode = true;
        epPeakIdx = peakIdx;
        epTroughIdx = i;
        epTroughEquity = e;
      } else if (e < epTroughEquity) {
        epTroughEquity = e;
        epTroughIdx = i;
      }
    }
  }
  if (inEpisode) closeEpisode(null, N);

  const durations = episodes.map((ep) => ep.durationPeriods);
  const maxUnderwaterPeriods = durations.length > 0 ? Math.max(...durations) : 0;
  const avgUnderwaterPeriods =
    durations.length > 0 ? durations.reduce((s, d) => s + d, 0) / durations.length : 0;
  const lastEp = episodes[episodes.length - 1];
  const currentlyUnderwater = lastEp?.ongoing === true;
  const currentUnderwaterPeriods = currentlyUnderwater ? lastEp!.durationPeriods : 0;

  let mar: number | null = null;
  if (input.periodsPerYear && input.periodsPerYear > 0 && maxDrawdownPct > 0) {
    const finalEquity = equity[N]!;
    const cagr = (finalEquity / initial) ** (input.periodsPerYear / N) - 1;
    mar = round(cagr / maxDrawdownPct, 4);
  }

  const interpretation =
    `${N} periods: longest underwater spell ${maxUnderwaterPeriods} periods, ` +
    `${((underwaterCount / N) * 100).toFixed(1)}% of time underwater across ${episodes.length} episode(s); ` +
    `max drawdown ${(maxDrawdownPct * 100).toFixed(2)}%` +
    (currentlyUnderwater
      ? `; currently ${currentUnderwaterPeriods} periods underwater`
      : "; at/near a high") +
    (mar !== null ? `; MAR ${mar}` : "") +
    ". " +
    (maxUnderwaterPeriods === 0
      ? "Never underwater — monotonic-up sample (likely too short or curve-fit)."
      : "Longer underwater spells are the allocator-losing risk depth alone hides.");

  return {
    maxUnderwaterPeriods,
    currentUnderwaterPeriods,
    currentlyUnderwater,
    pctTimeUnderwater: round(underwaterCount / N, 6),
    numEpisodes: episodes.length,
    avgUnderwaterPeriods: round(avgUnderwaterPeriods, 4),
    maxDrawdownPct: round(maxDrawdownPct, 6),
    mar,
    episodes,
    sampleSize: N,
    interpretation,
  };
}
