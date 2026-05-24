/**
 * Volume-Pattern Edge Classifier — Koroush AK / ZCT Volume Masterclass.
 *
 * Classifies a recent volume window into one of:
 *   - increasing     : sustained slope upward            → momentum-favorable
 *   - flat           : neither building nor decaying     → mean-reversion-favorable
 *   - decreasing     : sustained slope downward          → no_edge (often exhaustion)
 *   - spike_isolated : terminal-bar volume spike, no     → no_edge (Koroush:
 *                       coincident price spike            "less reliable")
 *   - spike_with_price: terminal volume spike + price    → reversal_setup
 *                       expansion (large body)
 *
 * Mapping to edge activation:
 *   - increasing            → momentum_favorable
 *   - flat                  → mean_reversion_favorable
 *   - spike_with_price      → reversal_setup
 *   - decreasing            → no_edge
 *   - spike_isolated        → no_edge
 *
 * Distinct from:
 *   - `volume-trend.ts`     (single-direction slope verdict; doesn't have
 *                            the explicit "flat" intermediate state nor
 *                            the spike+price coincidence trigger)
 *   - `volume-exhaustion.ts` (single-bar exhaustion pattern)
 *   - `highest-volume-ever.ts` (single-bar volume extreme detector)
 *   - `aggression-ratio.ts` (taker-buy/sell ratio from exchange tape)
 *
 * Composes with:
 *   - `ma-crossover-cleanness` (LV31)   (volume pattern + trend cleanness
 *                                       must agree before activating
 *                                       momentum edge)
 *   - `institutional-footprint` (LV27)  (multi-bar volume signature
 *                                       confirms accumulation)
 *
 * Pure function. Caller supplies OHLCV bars.
 */

export interface VolumePatternBar {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface VolumePatternOptions {
  /** Lookback window of volume bars to score. Default 20. */
  window?: number;
  /**
   * Slope (%/bar of window-mean) threshold to call the pattern
   * "increasing". Default 0.03 (≥3% growth per bar relative to window
   * mean). The "decreasing" threshold mirrors this with a sign flip.
   */
  trendingSlopePctPerBar?: number;
  /**
   * Multiple of window-mean volume that the terminal bar must reach to
   * qualify as a spike. Default 2.5×.
   */
  spikeMultiple?: number;
  /**
   * Body size (|close-open|/open) on the spike bar that, together with
   * a volume spike, escalates to spike_with_price. Default 0.03 (3%).
   */
  priceSpikeBodyFraction?: number;
  /** Minimum bars required for a verdict. Default 5. */
  minBars?: number;
}

export type VolumePattern =
  | "increasing"
  | "flat"
  | "decreasing"
  | "spike_isolated"
  | "spike_with_price"
  | "insufficient_data";

export type VolumeEdge =
  | "momentum_favorable"
  | "mean_reversion_favorable"
  | "reversal_setup"
  | "no_edge"
  | "insufficient_data";

export interface VolumePatternResult {
  totalBars: number;
  windowUsed: number;
  meanVolume: number;
  /** Standard deviation of volume in the window. */
  volumeStd: number;
  /** OLS slope of volume vs bar index. */
  volumeSlope: number;
  /** Volume slope expressed as fraction of window mean per bar. */
  volumeSlopePctPerBar: number;
  /** Most-recent bar volume. */
  terminalVolume: number;
  /** Most-recent bar volume / mean volume. */
  terminalVolumeMultiple: number;
  /** Most-recent bar body fraction |close-open|/open. */
  terminalBodyFraction: number;
  pattern: VolumePattern;
  edgeActivation: VolumeEdge;
  /** 0..1 score: confidence the pattern is unambiguous. */
  patternScore: number;
  summary: string;
}

const DEFAULT_WINDOW = 20;
const DEFAULT_SLOPE_PCT = 0.03;
const DEFAULT_SPIKE_MULT = 2.5;
const DEFAULT_BODY_FRAC = 0.03;
const DEFAULT_MIN_BARS = 5;

function meanOf(values: number[]): number {
  if (values.length === 0) return 0;
  let s = 0;
  for (const v of values) s += v;
  return s / values.length;
}

function olsSlope(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  const xMean = (n - 1) / 2;
  const yMean = meanOf(values);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    const dx = i - xMean;
    num += dx * (values[i]! - yMean);
    den += dx * dx;
  }
  return den === 0 ? 0 : num / den;
}

function stdOf(values: number[]): number {
  if (values.length < 2) return 0;
  const m = meanOf(values);
  let ss = 0;
  for (const v of values) ss += (v - m) * (v - m);
  return Math.sqrt(ss / (values.length - 1));
}

function insufficient(reason: string, bars: number): VolumePatternResult {
  return {
    totalBars: bars,
    windowUsed: 0,
    meanVolume: 0,
    volumeStd: 0,
    volumeSlope: 0,
    volumeSlopePctPerBar: 0,
    terminalVolume: 0,
    terminalVolumeMultiple: 0,
    terminalBodyFraction: 0,
    pattern: "insufficient_data",
    edgeActivation: "insufficient_data",
    patternScore: 0,
    summary: reason,
  };
}

export function classifyVolumePatternEdge(
  bars: ReadonlyArray<VolumePatternBar>,
  options: VolumePatternOptions = {},
): VolumePatternResult {
  const window = options.window ?? DEFAULT_WINDOW;
  const slopeThreshold = options.trendingSlopePctPerBar ?? DEFAULT_SLOPE_PCT;
  const spikeMult = options.spikeMultiple ?? DEFAULT_SPIKE_MULT;
  const bodyFrac = options.priceSpikeBodyFraction ?? DEFAULT_BODY_FRAC;
  const minBars = options.minBars ?? DEFAULT_MIN_BARS;

  if (bars.length < minBars) {
    return insufficient(`Insufficient bars (${bars.length} < ${minBars}).`, bars.length);
  }

  const used = Math.min(window, bars.length);
  const slice = bars.slice(-used);
  const volumes = slice.map((b) => b.volume);
  const mean = meanOf(volumes);
  if (mean <= 0) {
    return insufficient("All volumes are zero or negative.", bars.length);
  }
  const std = stdOf(volumes);
  const slope = olsSlope(volumes);
  const slopePctPerBar = slope / mean;

  const terminal = slice[slice.length - 1]!;
  const terminalVol = terminal.volume;
  const terminalMult = terminalVol / mean;
  const terminalBody =
    terminal.open > 0 ? Math.abs(terminal.close - terminal.open) / terminal.open : 0;

  // Detect spike first (terminal-bar dominant)
  let pattern: VolumePattern;
  if (terminalMult >= spikeMult) {
    pattern = terminalBody >= bodyFrac ? "spike_with_price" : "spike_isolated";
  } else if (slopePctPerBar >= slopeThreshold) {
    pattern = "increasing";
  } else if (slopePctPerBar <= -slopeThreshold) {
    pattern = "decreasing";
  } else {
    pattern = "flat";
  }

  let edgeActivation: VolumeEdge;
  switch (pattern) {
    case "increasing":
      edgeActivation = "momentum_favorable";
      break;
    case "flat":
      edgeActivation = "mean_reversion_favorable";
      break;
    case "spike_with_price":
      edgeActivation = "reversal_setup";
      break;
    case "decreasing":
    case "spike_isolated":
      edgeActivation = "no_edge";
      break;
    default:
      edgeActivation = "insufficient_data";
  }

  // Pattern score: how unambiguous is the verdict
  let patternScore = 0;
  if (pattern === "increasing" || pattern === "decreasing") {
    patternScore = Math.min(1, Math.abs(slopePctPerBar) / (slopeThreshold * 3));
  } else if (pattern === "flat") {
    patternScore = Math.max(
      0,
      1 - Math.abs(slopePctPerBar) / slopeThreshold,
    );
  } else if (pattern === "spike_with_price") {
    const volComp = Math.min(1, (terminalMult - spikeMult) / spikeMult + 0.5);
    const bodyComp = Math.min(1, terminalBody / (bodyFrac * 3));
    patternScore = (volComp + bodyComp) / 2;
  } else if (pattern === "spike_isolated") {
    patternScore = Math.min(1, (terminalMult - spikeMult) / spikeMult);
  }
  patternScore = parseFloat(Math.max(0, Math.min(1, patternScore)).toFixed(4));

  const summary =
    `${edgeActivation.toUpperCase()} — pattern: ${pattern}. ` +
    `Window ${used} bars, mean vol ${mean.toFixed(0)}, slope ${(slopePctPerBar * 100).toFixed(2)}%/bar, ` +
    `terminal ${terminalMult.toFixed(2)}× mean ` +
    `(body ${(terminalBody * 100).toFixed(2)}%).`;

  return {
    totalBars: bars.length,
    windowUsed: used,
    meanVolume: parseFloat(mean.toFixed(2)),
    volumeStd: parseFloat(std.toFixed(2)),
    volumeSlope: parseFloat(slope.toFixed(4)),
    volumeSlopePctPerBar: parseFloat(slopePctPerBar.toFixed(6)),
    terminalVolume: parseFloat(terminalVol.toFixed(2)),
    terminalVolumeMultiple: parseFloat(terminalMult.toFixed(4)),
    terminalBodyFraction: parseFloat(terminalBody.toFixed(6)),
    pattern,
    edgeActivation,
    patternScore,
    summary,
  };
}

export function formatVolumePatternEdge(result: VolumePatternResult): string {
  const lines = [
    `Volume-Pattern Edge — ${result.edgeActivation.toUpperCase()} (score ${result.patternScore.toFixed(2)})`,
    "",
    `  Bars supplied:       ${result.totalBars}`,
    `  Window used:         ${result.windowUsed}`,
    `  Mean volume:         ${result.meanVolume}`,
    `  Volume std:          ${result.volumeStd}`,
    `  Slope (%/bar):       ${(result.volumeSlopePctPerBar * 100).toFixed(2)}%`,
    `  Terminal volume:     ${result.terminalVolume} (${result.terminalVolumeMultiple.toFixed(2)}× mean)`,
    `  Terminal body:       ${(result.terminalBodyFraction * 100).toFixed(2)}%`,
    `  Pattern:             ${result.pattern}`,
    "",
    `Summary: ${result.summary}`,
  ];
  return lines.join("\n");
}
