/**
 * Fill-Quality Probe Diagnostic — Livermore/Zanger probing operationalized.
 *
 * Premise (Zanger via Kyna Kosling, May 2026): institutions reveal themselves
 * through the difficulty of buying their stocks. A POOR fill (slow, partial,
 * with adverse slippage) on a probe order means supply is being withheld —
 * institutions are accumulating. A CLEAN, EASY fill means someone is selling
 * into your liquidity — supply is available, accumulation is not visible.
 *
 * Inputs (per probe):
 *   - intendedQty / filledQty        → fill completeness ratio
 *   - submitMidPrice / avgFillPrice  → realized slippage vs midpoint
 *   - expectedSlippageBps            → operator's pretrade slippage forecast
 *   - latencyMs / latencyBudgetMs    → time-to-fill vs budget
 *   - side                           → BUY / SELL (slippage sign convention)
 *
 * Verdict:
 *   - aggressive_demand : 2+ "poor" axes → supply withheld, institutional bid
 *   - neutral_fill      : 1 poor axis, rest clean
 *   - easy_fill         : 0 poor axes, all clean → supply available, bearish
 *   - insufficient_data : zero qty / missing reference prices
 *
 * Three axes, each scored:
 *   1. Fill completeness   : filledQty / intendedQty
 *   2. Slippage excess     : realizedSlippageBps − expectedSlippageBps
 *   3. Fill latency        : latencyMs / latencyBudgetMs
 *
 * Distinct from:
 *   - `dark-pool-adverse-selection.ts`  (venue-post-fill quality at dark pools)
 *   - `latency-cost.ts`                 (modeled latency cost, forward-looking)
 *   - `infra/trading/quant/implementationShortfall.ts` (4-bucket post-trade TCA
 *                                       cost attribution — accounting, not
 *                                       supply/demand inference)
 *   - `infra/trading/quant/transientImpact.ts` (Obizhaeva-Wang decay model)
 *
 * Composes with:
 *   - `aggression-ratio` (LV22)        (tape-level taker imbalance + probe
 *                                       fill-quality together = stronger
 *                                       institutional-bid read)
 *   - `institutional-footprint` (LV27) (chart shows the multi-bar signature;
 *                                       probe confirms supply is withheld now)
 *
 * Pure function. Caller supplies probe-order observation.
 */

export type ProbeSide = "BUY" | "SELL";

export interface FillQualityProbeInput {
  side: ProbeSide;
  /** Qty intended at order submission (positive). */
  intendedQty: number;
  /** Qty actually filled at the time of measurement (positive). */
  filledQty: number;
  /** Midpoint at order submission. */
  submitMidPrice: number;
  /** Volume-weighted average price of fills so far. */
  avgFillPrice: number;
  /** Operator's pretrade expected slippage in bps (positive number). */
  expectedSlippageBps: number;
  /** Latency from submit to measurement, in ms. */
  latencyMs: number;
  /** Acceptable latency budget, in ms. */
  latencyBudgetMs: number;
}

export interface FillQualityProbeOptions {
  /**
   * Threshold: filledQty / intendedQty BELOW which the completeness axis
   * counts as "poor". Default 0.60.
   */
  poorFillRatioThreshold?: number;
  /**
   * Slippage excess multiple above expected that counts as "poor".
   * Default 2.0 (realized > 2× expected → poor).
   */
  poorSlippageMultiple?: number;
  /**
   * Latency multiple of budget that counts as "poor". Default 2.0
   * (latency > 2× budget → poor).
   */
  poorLatencyMultiple?: number;
  /**
   * Inverse thresholds for "clean" axes (used to detect easy fills):
   * fill ratio AT OR ABOVE this AND slippage AT OR BELOW this AND latency
   * AT OR BELOW this all signal easy supply.
   */
  cleanFillRatioThreshold?: number;
  cleanSlippageMultiple?: number;
  cleanLatencyMultiple?: number;
}

export type FillQualityVerdict =
  | "aggressive_demand"
  | "neutral_fill"
  | "easy_fill"
  | "insufficient_data";

export interface AxisScore {
  axis: "completeness" | "slippage" | "latency";
  observed: number;
  /** "poor" / "neutral" / "clean" classification of this axis. */
  classification: "poor" | "neutral" | "clean";
  description: string;
}

export interface FillQualityProbeResult {
  side: ProbeSide;
  fillRatio: number;
  realizedSlippageBps: number;
  slippageExcessBps: number;
  latencyRatio: number;
  axes: AxisScore[];
  poorAxesCount: number;
  cleanAxesCount: number;
  verdict: FillQualityVerdict;
  /** 0..1 score: higher = more aggressive demand. */
  demandScore: number;
  summary: string;
}

const DEFAULT_POOR_FILL = 0.6;
const DEFAULT_POOR_SLIPPAGE = 2.0;
const DEFAULT_POOR_LATENCY = 2.0;
const DEFAULT_CLEAN_FILL = 0.95;
const DEFAULT_CLEAN_SLIPPAGE = 0.5;
const DEFAULT_CLEAN_LATENCY = 0.5;

export function analyzeFillQualityProbe(
  input: FillQualityProbeInput,
  options: FillQualityProbeOptions = {},
): FillQualityProbeResult {
  const poorFill = options.poorFillRatioThreshold ?? DEFAULT_POOR_FILL;
  const poorSlip = options.poorSlippageMultiple ?? DEFAULT_POOR_SLIPPAGE;
  const poorLat = options.poorLatencyMultiple ?? DEFAULT_POOR_LATENCY;
  const cleanFill = options.cleanFillRatioThreshold ?? DEFAULT_CLEAN_FILL;
  const cleanSlip = options.cleanSlippageMultiple ?? DEFAULT_CLEAN_SLIPPAGE;
  const cleanLat = options.cleanLatencyMultiple ?? DEFAULT_CLEAN_LATENCY;

  if (
    input.intendedQty <= 0 ||
    input.submitMidPrice <= 0 ||
    input.avgFillPrice <= 0 ||
    input.latencyBudgetMs <= 0 ||
    input.expectedSlippageBps < 0 ||
    input.filledQty < 0
  ) {
    return {
      side: input.side,
      fillRatio: 0,
      realizedSlippageBps: 0,
      slippageExcessBps: 0,
      latencyRatio: 0,
      axes: [],
      poorAxesCount: 0,
      cleanAxesCount: 0,
      verdict: "insufficient_data",
      demandScore: 0,
      summary: "Invalid probe input (non-positive size, price, or budget).",
    };
  }

  const fillRatio = Math.min(1, input.filledQty / input.intendedQty);
  // Sign convention: for a BUY a fill ABOVE midpoint is adverse → positive bps;
  // for a SELL a fill BELOW midpoint is adverse → positive bps.
  const directional =
    input.side === "BUY"
      ? (input.avgFillPrice - input.submitMidPrice) / input.submitMidPrice
      : (input.submitMidPrice - input.avgFillPrice) / input.submitMidPrice;
  const realizedSlippageBps = directional * 10_000;
  const slippageExcessBps = realizedSlippageBps - input.expectedSlippageBps;
  const slippageMultiple =
    input.expectedSlippageBps > 0
      ? realizedSlippageBps / input.expectedSlippageBps
      : realizedSlippageBps > 0
        ? Infinity
        : 0;
  const latencyRatio = input.latencyMs / input.latencyBudgetMs;

  function classify(
    axis: AxisScore["axis"],
    observed: number,
    poorThreshold: number,
    cleanThreshold: number,
    poorIsAbove: boolean,
  ): AxisScore {
    let classification: AxisScore["classification"];
    if (poorIsAbove) {
      if (observed > poorThreshold) classification = "poor";
      else if (observed <= cleanThreshold) classification = "clean";
      else classification = "neutral";
    } else {
      if (observed < poorThreshold) classification = "poor";
      else if (observed >= cleanThreshold) classification = "clean";
      else classification = "neutral";
    }
    let description: string;
    if (axis === "completeness")
      description = `Fill ratio ${(observed * 100).toFixed(1)}% (poor < ${(poorThreshold * 100).toFixed(0)}%, clean ≥ ${(cleanThreshold * 100).toFixed(0)}%).`;
    else if (axis === "slippage")
      description = `Realized/expected slippage ${observed.toFixed(2)}× (poor > ${poorThreshold.toFixed(1)}×, clean ≤ ${cleanThreshold.toFixed(1)}×).`;
    else
      description = `Latency ratio ${observed.toFixed(2)}× budget (poor > ${poorThreshold.toFixed(1)}×, clean ≤ ${cleanThreshold.toFixed(1)}×).`;
    return { axis, observed: parseFloat(observed.toFixed(4)), classification, description };
  }

  const axes: AxisScore[] = [
    classify("completeness", fillRatio, poorFill, cleanFill, false),
    classify(
      "slippage",
      Number.isFinite(slippageMultiple) ? slippageMultiple : poorSlip * 10,
      poorSlip,
      cleanSlip,
      true,
    ),
    classify("latency", latencyRatio, poorLat, cleanLat, true),
  ];
  const poorAxesCount = axes.filter((a) => a.classification === "poor").length;
  const cleanAxesCount = axes.filter((a) => a.classification === "clean").length;

  let verdict: FillQualityVerdict;
  if (poorAxesCount >= 2) verdict = "aggressive_demand";
  else if (cleanAxesCount === 3) verdict = "easy_fill";
  else verdict = "neutral_fill";

  // Demand score: 0 (perfectly easy) to 1 (perfectly aggressive).
  // Map each axis to [0,1] where 1 = poor, 0 = clean.
  function axisToScore(a: AxisScore): number {
    if (a.classification === "poor") return 1;
    if (a.classification === "clean") return 0;
    return 0.5;
  }
  const demandScore = parseFloat((axes.reduce((s, a) => s + axisToScore(a), 0) / 3).toFixed(4));

  const summary =
    `${verdict.toUpperCase()} — ${poorAxesCount} poor / ${cleanAxesCount} clean axes ` +
    `(fill ${(fillRatio * 100).toFixed(0)}%, slip ${realizedSlippageBps.toFixed(1)}bps vs ${input.expectedSlippageBps.toFixed(1)} expected, ` +
    `latency ${latencyRatio.toFixed(2)}× budget). ${verdict === "aggressive_demand" ? "Supply withheld → institutional bid likely." : verdict === "easy_fill" ? "Supply available → no accumulation visible." : "Mixed; treat as inconclusive."}`;

  return {
    side: input.side,
    fillRatio: parseFloat(fillRatio.toFixed(6)),
    realizedSlippageBps: parseFloat(realizedSlippageBps.toFixed(4)),
    slippageExcessBps: parseFloat(slippageExcessBps.toFixed(4)),
    latencyRatio: parseFloat(latencyRatio.toFixed(4)),
    axes,
    poorAxesCount,
    cleanAxesCount,
    verdict,
    demandScore,
    summary,
  };
}

export function formatFillQualityProbe(result: FillQualityProbeResult): string {
  const lines = [
    `Fill-Quality Probe — ${result.verdict.toUpperCase()} (demand ${result.demandScore.toFixed(2)})`,
    "",
    `  Side:              ${result.side}`,
    `  Fill ratio:        ${(result.fillRatio * 100).toFixed(1)}%`,
    `  Realized slippage: ${result.realizedSlippageBps.toFixed(2)} bps`,
    `  Slippage excess:   ${result.slippageExcessBps.toFixed(2)} bps`,
    `  Latency ratio:     ${result.latencyRatio.toFixed(2)}× budget`,
    "",
    `  Poor axes:  ${result.poorAxesCount}`,
    `  Clean axes: ${result.cleanAxesCount}`,
  ];
  for (const a of result.axes) {
    const tag =
      a.classification === "poor" ? "[POOR]" : a.classification === "clean" ? "[CLEAN]" : "[NEUT]";
    lines.push(`    ${tag} ${a.axis}: ${a.description}`);
  }
  lines.push("");
  lines.push(`Summary: ${result.summary}`);
  return lines.join("\n");
}
