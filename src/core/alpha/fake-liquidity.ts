/**
 * Fake-Liquidity / Wash-Trade Detector
 *
 * Spicy's Bonus Resource #1: "If a coin can move a large distance on
 * no volume, there is nothing in the order book." High USD volume
 * alone is NOT sufficient — wash trading inflates the volume number
 * without depositing real limit orders into the book. The tell is
 * price-move-per-dollar-traded: if price moves 10% on $50k cumulative
 * volume, the book is thin or the volume is wash.
 *
 * Procedure:
 *   1. Per candle: compute |close - open| / open as relative move
 *      and close × volume as USD volume
 *   2. Compute "move efficiency" = relative move per $1 of volume
 *      → high efficiency means price moves a lot per dollar traded
 *        (thin book / wash)
 *      → low efficiency means price moves little per dollar traded
 *        (thick book / real liquidity)
 *   3. Outlier candles trigger the gate
 *
 * `usdVolumeGate.ts` answers "is the headline volume large enough?".
 * This answers "given that headline volume, is the BOOK actually thick
 * enough to support that volume?". Both must pass before a tool acts.
 *
 * Pure function.
 */
import { mean } from "./helpers.ts";

export interface FakeLiquidityCandle {
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
}

export interface FakeLiquidityOptions {
  /** Lookback in candles. Default 60. */
  window?: number;
  /** Minimum candles to produce a verdict. Default 20. */
  minCandles?: number;
  /**
   * Outlier threshold expressed as a robust z-score (modified z) using
   * the median + MAD. The classical 0.6745 × (x − median) / MAD form.
   * Default 3.5 — Iglewicz–Hoaglin's canonical recommendation. MAD is
   * used instead of std so the test resists heavy contamination
   * (which is the whole point — we're detecting wash trading).
   */
  outlierZThreshold?: number;
  /**
   * Fraction of candles within window that must trip the outlier
   * threshold before the whole window is flagged as fake-liquidity.
   * Default 0.10 (10%).
   */
  outlierFractionThreshold?: number;
  /**
   * Optional absolute floor — candles with USD volume below this
   * cannot trip the outlier check (avoids degenerate divide-by-tiny).
   * Default $1.
   */
  minVolUSD?: number;
}

export type FakeLiquidityVerdict =
  | "real_liquidity"
  | "suspicious"
  | "fake_liquidity"
  | "insufficient_data";

export interface CandleEfficiency {
  index: number;
  relativeMove: number;
  volUSD: number;
  movePerDollar: number;
  z: number;
  outlier: boolean;
}

export interface FakeLiquidityResult {
  windowSize: number;
  medianMovePerDollar: number;
  meanMovePerDollar: number;
  /** Median absolute deviation of move-per-dollar (robust spread). */
  madMovePerDollar: number;
  outlierCount: number;
  outlierFraction: number;
  candleSamples: CandleEfficiency[];
  verdict: FakeLiquidityVerdict;
  summary: string;
}

const DEFAULT_WINDOW = 60;
const DEFAULT_MIN_CANDLES = 20;
const DEFAULT_OUTLIER_Z = 3.5;
const DEFAULT_OUTLIER_FRAC = 0.1;
const DEFAULT_MIN_VOL_USD = 1;
const MODIFIED_Z_CONST = 0.6745;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export function analyzeFakeLiquidity(
  candles: ReadonlyArray<FakeLiquidityCandle>,
  options: FakeLiquidityOptions = {},
): FakeLiquidityResult {
  const window = options.window ?? DEFAULT_WINDOW;
  const minCandles = options.minCandles ?? DEFAULT_MIN_CANDLES;
  const zThreshold = options.outlierZThreshold ?? DEFAULT_OUTLIER_Z;
  const fracThreshold = options.outlierFractionThreshold ?? DEFAULT_OUTLIER_FRAC;
  const minVolUSD = options.minVolUSD ?? DEFAULT_MIN_VOL_USD;

  if (candles.length < minCandles) {
    return {
      windowSize: candles.length,
      medianMovePerDollar: 0,
      meanMovePerDollar: 0,
      madMovePerDollar: 0,
      outlierCount: 0,
      outlierFraction: 0,
      candleSamples: [],
      verdict: "insufficient_data",
      summary: `Insufficient candles (${candles.length} < ${minCandles}).`,
    };
  }

  const effectiveWindow = Math.min(window, candles.length);
  const tail = candles.slice(candles.length - effectiveWindow);

  const efficiencies: CandleEfficiency[] = [];
  for (let i = 0; i < tail.length; i++) {
    const c = tail[i]!;
    if (c.open <= 0) continue;
    const relativeMove = Math.abs(c.close - c.open) / c.open;
    const volUSD = c.close * c.volume;
    if (volUSD < minVolUSD) {
      if (relativeMove > 0) {
        efficiencies.push({
          index: i,
          relativeMove,
          volUSD,
          movePerDollar: Number.POSITIVE_INFINITY,
          z: Number.POSITIVE_INFINITY,
          outlier: true,
        });
      }
      continue;
    }
    const movePerDollar = relativeMove / volUSD;
    efficiencies.push({
      index: i,
      relativeMove,
      volUSD,
      movePerDollar,
      z: 0,
      outlier: false,
    });
  }

  const finiteValues = efficiencies
    .filter((e) => Number.isFinite(e.movePerDollar))
    .map((e) => e.movePerDollar);

  if (finiteValues.length < minCandles) {
    return {
      windowSize: effectiveWindow,
      medianMovePerDollar: 0,
      meanMovePerDollar: 0,
      madMovePerDollar: 0,
      outlierCount: efficiencies.filter((e) => e.outlier).length,
      outlierFraction: 0,
      candleSamples: efficiencies,
      verdict: "insufficient_data",
      summary: `Insufficient candles with non-zero USD volume (${finiteValues.length} < ${minCandles}).`,
    };
  }

  const med = median(finiteValues);
  const avg = mean(finiteValues);
  // MAD: median of |x_i − median|. Robust to up to 50% contamination.
  const absDevs = finiteValues.map((v) => Math.abs(v - med));
  const mad = median(absDevs);

  for (const eff of efficiencies) {
    if (!Number.isFinite(eff.movePerDollar)) continue;
    if (mad === 0) {
      // Degenerate (>50% identical values). Fall back to ratio rule:
      // outlier iff > 5× median. Tracks the spirit of the check.
      eff.z = med > 0 ? eff.movePerDollar / med : 0;
      eff.outlier = med > 0 && eff.movePerDollar > 5 * med;
    } else {
      eff.z = (MODIFIED_Z_CONST * (eff.movePerDollar - med)) / mad;
      eff.outlier = eff.z > zThreshold;
    }
  }

  const outlierCount = efficiencies.filter((e) => e.outlier).length;
  const outlierFraction = outlierCount / effectiveWindow;

  let verdict: FakeLiquidityVerdict;
  if (outlierFraction >= fracThreshold * 2) verdict = "fake_liquidity";
  else if (outlierFraction >= fracThreshold) verdict = "suspicious";
  else verdict = "real_liquidity";

  const summary =
    `${effectiveWindow}-candle window: median move-per-$ = ${med.toExponential(2)}, ` +
    `${outlierCount} outlier candle(s) (${(outlierFraction * 100).toFixed(1)}%) → ${verdict}`;

  return {
    windowSize: effectiveWindow,
    medianMovePerDollar: med,
    meanMovePerDollar: avg,
    madMovePerDollar: mad,
    outlierCount,
    outlierFraction: parseFloat(outlierFraction.toFixed(4)),
    candleSamples: efficiencies,
    verdict,
    summary,
  };
}

export function formatFakeLiquidity(result: FakeLiquidityResult): string {
  const lines = [
    `Fake-Liquidity Check — ${result.verdict.toUpperCase()}`,
    "",
    `  Window: ${result.windowSize} candles`,
    `  Median move-per-$: ${result.medianMovePerDollar.toExponential(2)}`,
    `  MAD move-per-$:    ${result.madMovePerDollar.toExponential(2)}`,
    `  Outlier candles: ${result.outlierCount} (${(result.outlierFraction * 100).toFixed(1)}%)`,
    "",
    `Summary: ${result.summary}`,
  ];
  if (result.verdict === "fake_liquidity") {
    lines.push("");
    lines.push("⚠ Headline volume may be wash-traded; book is thinner than it appears.");
    lines.push("  Recommend skipping or reducing position size dramatically.");
  } else if (result.verdict === "suspicious") {
    lines.push("");
    lines.push("⚠ Some candles show large moves on small dollar volume.");
    lines.push("  Use defensive position sizing.");
  }
  return lines.join("\n");
}
