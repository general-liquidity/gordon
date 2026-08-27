/**
 * Delta-Price Divergence Detector — order-flow exhaustion classifier.
 *
 * Premise (Mati Conti 2026 market-maker framing; standard prop-trading
 * order-flow analysis): per-bar VOLUME DELTA (aggressive-buy minus
 * aggressive-sell volume) is the live measure of order-flow aggression.
 * Normally delta and price move together — buyers crossing the spread
 * push price up; sellers hitting the bid push it down. When they
 * DISAGREE, it signals exhaustion of the dominant side:
 *
 *   - Price UP + delta DOWN/NEGATIVE → BUYER EXHAUSTION
 *     (price grinding higher but aggressive buying drying up;
 *      reversal-down candidate)
 *
 *   - Price DOWN + delta UP/POSITIVE → SELLER EXHAUSTION
 *     (price dripping lower but aggressive buyers absorbing;
 *      reversal-up candidate)
 *
 * The diagnostic compares signed price-change vs signed cumulative-delta
 * over a lookback window, with magnitude thresholds on both axes so
 * insignificant noise doesn't trip the verdict.
 *
 * Distinct from:
 *   - `core/indicators/delta-ladder.ts`  (raw indicator: per-bar delta +
 *      cumulative delta + generic buy/sell signal; doesn't classify the
 *      price-vs-delta DISAGREEMENT into a verdict surface)
 *   - `aggression-ratio.ts` (LV22)        (single-bar taker-buy/sell
 *      ratio; doesn't compare against price direction)
 *   - `strategies/tier-2/sellers-exhaustion.ts` (volume-climax + price
 *      body recovery pattern; different mechanism — volume-based, not
 *      delta-vs-price divergence)
 *   - `reversal-timing.ts` (price-only multi-asset reversal alignment;
 *      no order-flow component)
 *
 * Composes with:
 *   - `delta-ladder` indicator        (supplies the delta input)
 *   - `aggression-ratio` (LV22)       (alternative delta proxy on
 *                                      crypto perps via exchange tape)
 *   - `ensemble-signal-combiner` (LV39) (feed the divergence as a
 *                                       directional signal into the
 *                                       composite)
 *   - `mae-stop-calibrator` (LV33)    (sets the tight stop for the
 *                                      reversal trade)
 *
 * Pure compute. Pedigree: Mati Conti 2026; standard prop-trading
 * order-flow analysis literature.
 */

export interface DeltaPriceBar {
  /** Closing price. */
  close: number;
  /** Per-bar delta (aggressive buy − aggressive sell volume). Signed. */
  delta: number;
}

export interface DeltaPriceDivergenceOptions {
  /**
   * Number of bars to evaluate the divergence over. Default 4.
   * Larger windows = more stable, smaller = more reactive.
   */
  lookbackBars?: number;
  /**
   * Min |price change| / starting price required for the price axis
   * to register a direction. Default 0.005 (0.5%). Below this, price
   * is "flat" and verdict is `insufficient_signal`.
   */
  minPriceMovePct?: number;
  /**
   * Min |cumulative delta| required for the delta axis to register a
   * direction. Operator sets per market (crypto perps vs futures vs
   * equities have wildly different delta scales). Default 0.
   */
  minAbsoluteDelta?: number;
  /**
   * Min number of bars in the input. Below this returns
   * insufficient_data. Default 5.
   */
  minBars?: number;
}

export type DeltaDirection = "up" | "down" | "flat";

export type DivergenceType =
  | "aligned_up"
  | "aligned_down"
  | "bullish_divergence"
  | "bearish_divergence"
  | "insufficient_signal";

export type DeltaDivergenceVerdict =
  | "bullish_divergence_signal"
  | "bearish_divergence_signal"
  | "aligned"
  | "insufficient_signal"
  | "insufficient_data";

export interface DeltaPriceDivergenceResult {
  totalBars: number;
  lookbackUsed: number;
  startClose: number;
  endClose: number;
  priceChange: number;
  priceChangePct: number;
  cumulativeDelta: number;
  absoluteDelta: number;
  priceDirection: DeltaDirection;
  deltaDirection: DeltaDirection;
  divergenceType: DivergenceType;
  /** 0..1 — higher = stronger divergence (magnitudes on both axes large). */
  divergenceMagnitude: number;
  verdict: DeltaDivergenceVerdict;
  summary: string;
}

const DEFAULT_LOOKBACK = 4;
const DEFAULT_MIN_PRICE_PCT = 0.005;
const DEFAULT_MIN_DELTA = 0;
const DEFAULT_MIN_BARS = 5;

function classify(value: number, threshold: number): DeltaDirection {
  if (value > threshold) return "up";
  if (value < -threshold) return "down";
  return "flat";
}

export function detectDeltaPriceDivergence(
  bars: ReadonlyArray<DeltaPriceBar>,
  options: DeltaPriceDivergenceOptions = {},
): DeltaPriceDivergenceResult {
  const lookback = options.lookbackBars ?? DEFAULT_LOOKBACK;
  const minPriceMovePct = options.minPriceMovePct ?? DEFAULT_MIN_PRICE_PCT;
  const minAbsDelta = options.minAbsoluteDelta ?? DEFAULT_MIN_DELTA;
  const minBars = options.minBars ?? DEFAULT_MIN_BARS;

  if (bars.length < minBars) {
    return {
      totalBars: bars.length,
      lookbackUsed: 0,
      startClose: 0,
      endClose: 0,
      priceChange: 0,
      priceChangePct: 0,
      cumulativeDelta: 0,
      absoluteDelta: 0,
      priceDirection: "flat",
      deltaDirection: "flat",
      divergenceType: "insufficient_signal",
      divergenceMagnitude: 0,
      verdict: "insufficient_data",
      summary: `Insufficient bars (${bars.length} < ${minBars}).`,
    };
  }

  const effectiveLookback = Math.min(lookback, bars.length - 1);
  const slice = bars.slice(-(effectiveLookback + 1)); // need lookback+1 bars to compute change
  const startBar = slice[0]!;
  const endBar = slice[slice.length - 1]!;
  const startClose = startBar.close;
  const endClose = endBar.close;
  if (startClose <= 0) {
    return {
      totalBars: bars.length,
      lookbackUsed: effectiveLookback,
      startClose,
      endClose,
      priceChange: 0,
      priceChangePct: 0,
      cumulativeDelta: 0,
      absoluteDelta: 0,
      priceDirection: "flat",
      deltaDirection: "flat",
      divergenceType: "insufficient_signal",
      divergenceMagnitude: 0,
      verdict: "insufficient_data",
      summary: "Start close is non-positive.",
    };
  }

  const priceChange = endClose - startClose;
  const priceChangePct = priceChange / startClose;

  // Cumulative delta is the sum of deltas over the lookback bars
  // (i.e., the most-recent `effectiveLookback` bars, not including the
  // start bar's delta which precedes the change window).
  let cumulativeDelta = 0;
  for (let i = 1; i < slice.length; i++) {
    const d = slice[i]!.delta;
    if (Number.isFinite(d)) cumulativeDelta += d;
  }
  const absoluteDelta = Math.abs(cumulativeDelta);

  const priceDirection = classify(priceChangePct, minPriceMovePct);
  const deltaDirection = classify(cumulativeDelta, minAbsDelta);

  // Classification
  let divergenceType: DivergenceType;
  if (priceDirection === "flat" || deltaDirection === "flat") {
    divergenceType = "insufficient_signal";
  } else if (priceDirection === "up" && deltaDirection === "up") {
    divergenceType = "aligned_up";
  } else if (priceDirection === "down" && deltaDirection === "down") {
    divergenceType = "aligned_down";
  } else if (priceDirection === "up" && deltaDirection === "down") {
    divergenceType = "bearish_divergence";
  } else {
    divergenceType = "bullish_divergence";
  }

  // Verdict
  let verdict: DeltaDivergenceVerdict;
  switch (divergenceType) {
    case "bullish_divergence":
      verdict = "bullish_divergence_signal";
      break;
    case "bearish_divergence":
      verdict = "bearish_divergence_signal";
      break;
    case "aligned_up":
    case "aligned_down":
      verdict = "aligned";
      break;
    case "insufficient_signal":
      verdict = "insufficient_signal";
      break;
  }

  // Magnitude: geometric mean of normalized price-move and delta magnitudes,
  // each capped at 1. Operator-tunable normalizers.
  const priceMagNorm = Math.min(1, Math.abs(priceChangePct) / (minPriceMovePct * 4));
  const deltaMagNorm =
    minAbsDelta > 0
      ? Math.min(1, absoluteDelta / (minAbsDelta * 4))
      : Math.min(1, absoluteDelta / 1); // unscaled if no threshold supplied
  const divergenceMagnitude =
    divergenceType === "bullish_divergence" || divergenceType === "bearish_divergence"
      ? parseFloat(Math.sqrt(priceMagNorm * deltaMagNorm).toFixed(4))
      : 0;

  const summary = (() => {
    const pricePct = (priceChangePct * 100).toFixed(2);
    const deltaStr = cumulativeDelta.toFixed(0);
    switch (verdict) {
      case "bullish_divergence_signal":
        return `BULLISH DIVERGENCE (seller exhaustion) — price ${pricePct}% but delta ${deltaStr} positive. Aggressive buyers absorbing; reversal-up candidate.`;
      case "bearish_divergence_signal":
        return `BEARISH DIVERGENCE (buyer exhaustion) — price ${pricePct}% but delta ${deltaStr} negative. Aggressive selling absorbing; reversal-down candidate.`;
      case "aligned":
        return `ALIGNED — price ${pricePct}% and delta ${deltaStr} move together (${priceDirection}). No exhaustion signal.`;
      case "insufficient_signal":
        return `INSUFFICIENT SIGNAL — price ${pricePct}% (need ≥${(minPriceMovePct * 100).toFixed(2)}%) or |delta| ${absoluteDelta.toFixed(0)} (need ≥${minAbsDelta}) below threshold.`;
    }
  })();

  return {
    totalBars: bars.length,
    lookbackUsed: effectiveLookback,
    startClose: parseFloat(startClose.toFixed(6)),
    endClose: parseFloat(endClose.toFixed(6)),
    priceChange: parseFloat(priceChange.toFixed(6)),
    priceChangePct: parseFloat(priceChangePct.toFixed(6)),
    cumulativeDelta: parseFloat(cumulativeDelta.toFixed(2)),
    absoluteDelta: parseFloat(absoluteDelta.toFixed(2)),
    priceDirection,
    deltaDirection,
    divergenceType,
    divergenceMagnitude,
    verdict,
    summary,
  };
}

export function formatDeltaPriceDivergence(result: DeltaPriceDivergenceResult): string {
  const lines = [
    `Delta-Price Divergence — ${result.verdict.toUpperCase()}`,
    "",
    `  Total bars / lookback used:   ${result.totalBars} / ${result.lookbackUsed}`,
    `  Start close → end close:       ${result.startClose.toFixed(2)} → ${result.endClose.toFixed(2)}`,
    `  Price change:                  ${result.priceChange.toFixed(2)}  (${(result.priceChangePct * 100).toFixed(2)}%)`,
    `  Cumulative delta:              ${result.cumulativeDelta.toFixed(0)}`,
    `  Price / delta direction:       ${result.priceDirection} / ${result.deltaDirection}`,
    `  Divergence type:               ${result.divergenceType}`,
    `  Divergence magnitude (0..1):   ${result.divergenceMagnitude.toFixed(3)}`,
    "",
    `Summary: ${result.summary}`,
  ];
  return lines.join("\n");
}
