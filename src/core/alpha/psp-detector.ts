/**
 * Precision Swing Point (PSP) Detector — Same-Bar One-vs-Rest Close Divergence
 *
 * Cross-sectional snapshot test: given N correlated assets and the SAME
 * bar (same timeframe + same close timestamp), detect when one asset's
 * direction (close vs. open) is opposite to the consensus of the others.
 *
 * Distinct from:
 *   - `reversal-timing.ts`    (time-series correlation across the whole
 *                              series; not a single-bar snapshot)
 *   - `smt-divergence.ts`     (level-anchored sweep test, not candle-close
 *                              direction)
 *   - `effective-n.ts`        (correlation structure of returns, not
 *                              snapshot direction divergence)
 *
 * Input: array of N {symbol, open, close} pairs representing the SAME bar
 * across N assets. Caller is responsible for ensuring the bars are
 * aligned in time and timeframe — the primitive assumes they are.
 *
 * Output:
 *   - per-asset direction (bullish / bearish / doji)
 *   - majority direction (bullish / bearish / split)
 *   - dissenters (assets whose direction is opposite to the majority)
 *   - verdict: psp_detected when exactly one dissenter exists; majority
 *     verdict when all agree; split when no clear majority
 *
 * Honest scope: detects the geometric pattern. As with smt-divergence,
 * marketed performance claims (80%+ win rates from ICT/influencer
 * sources) are unverifiable single-source data. Operators should
 * measure the signal's actual edge against their own ledger.
 *
 * Pure function.
 */

export interface PspBar {
  symbol: string;
  open: number;
  close: number;
}

export interface PspOptions {
  /**
   * Doji band — |close - open| / open below this is treated as a doji
   * rather than bullish/bearish. Default 0 (any non-zero direction
   * counts; dojis only when open === close exactly).
   */
  dojiToleranceFraction?: number;
  /**
   * Treat dojis as part of the majority side when computing dissenters.
   * Default false — dojis are neither dissenters nor majority members,
   * they're set aside.
   */
  dojiCountsTowardMajority?: boolean;
}

export type BarDirection = "bullish" | "bearish" | "doji";
export type MajorityDirection = "bullish" | "bearish" | "split";

export type PspVerdict =
  | "psp_detected"
  | "all_bullish"
  | "all_bearish"
  | "split"
  | "insufficient_data";

export interface PspAssetStatus {
  symbol: string;
  direction: BarDirection;
  /** (close - open) / open. Negative = bearish. */
  changeFraction: number;
  isDissenter: boolean;
}

export interface PspResult {
  totalAssets: number;
  assetStatuses: PspAssetStatus[];
  bullishCount: number;
  bearishCount: number;
  dojiCount: number;
  majorityDirection: MajorityDirection;
  /** Assets whose direction is opposite to the majority. */
  dissenters: string[];
  /**
   * The single dissenting asset, only set when exactly one dissenter
   * exists AND the majority is clear. This is the PSP signature.
   */
  pspAsset: string | null;
  /**
   * Direction to trade given a PSP. If majority is bullish + 1 dissenter,
   * the dissenter is failing to confirm the bullish move → continuation-
   * long is the majority trade, against the dissenter. If majority is
   * bearish + 1 dissenter → continuation-short. null when no PSP.
   */
  recommendedDirection: "long" | "short" | null;
  verdict: PspVerdict;
  summary: string;
}

const DEFAULT_DOJI_TOLERANCE = 0;

function classify(open: number, close: number, dojiTol: number): BarDirection {
  if (open <= 0) return "doji";
  const change = (close - open) / open;
  if (Math.abs(change) <= dojiTol) return "doji";
  return change > 0 ? "bullish" : "bearish";
}

export function detectPsp(
  bars: ReadonlyArray<PspBar>,
  options: PspOptions = {},
): PspResult {
  const dojiTol = options.dojiToleranceFraction ?? DEFAULT_DOJI_TOLERANCE;
  const dojiCountsAsMajority = options.dojiCountsTowardMajority ?? false;

  if (bars.length < 2) {
    return {
      totalAssets: bars.length,
      assetStatuses: [],
      bullishCount: 0,
      bearishCount: 0,
      dojiCount: 0,
      majorityDirection: "split",
      dissenters: [],
      pspAsset: null,
      recommendedDirection: null,
      verdict: "insufficient_data",
      summary: "Need at least 2 assets to detect a PSP.",
    };
  }

  const statuses: PspAssetStatus[] = bars.map((b) => {
    const dir = classify(b.open, b.close, dojiTol);
    const change = b.open > 0 ? (b.close - b.open) / b.open : 0;
    return {
      symbol: b.symbol,
      direction: dir,
      changeFraction: parseFloat(change.toFixed(6)),
      isDissenter: false,
    };
  });

  const bullishCount = statuses.filter((s) => s.direction === "bullish").length;
  const bearishCount = statuses.filter((s) => s.direction === "bearish").length;
  const dojiCount = statuses.filter((s) => s.direction === "doji").length;

  let majorityDirection: MajorityDirection;
  if (bullishCount > bearishCount + (dojiCountsAsMajority ? 0 : -dojiCount)) {
    majorityDirection = "bullish";
  } else if (bearishCount > bullishCount + (dojiCountsAsMajority ? 0 : -dojiCount)) {
    majorityDirection = "bearish";
  } else if (bullishCount === bearishCount) {
    majorityDirection = "split";
  } else {
    majorityDirection = bullishCount > bearishCount ? "bullish" : "bearish";
  }

  // Re-evaluate majority cleanly: simply whichever direction has more bars
  if (bullishCount > bearishCount) majorityDirection = "bullish";
  else if (bearishCount > bullishCount) majorityDirection = "bearish";
  else majorityDirection = "split";

  for (const s of statuses) {
    if (s.direction === "doji") continue;
    if (majorityDirection === "split") continue;
    if (
      (majorityDirection === "bullish" && s.direction === "bearish") ||
      (majorityDirection === "bearish" && s.direction === "bullish")
    ) {
      s.isDissenter = true;
    }
  }
  const dissenterList = statuses.filter((s) => s.isDissenter).map((s) => s.symbol);

  let verdict: PspVerdict;
  let pspAsset: string | null = null;
  let recommendedDirection: "long" | "short" | null = null;

  if (majorityDirection === "split") {
    verdict = "split";
  } else if (dissenterList.length === 0) {
    verdict = majorityDirection === "bullish" ? "all_bullish" : "all_bearish";
  } else if (dissenterList.length === 1) {
    verdict = "psp_detected";
    pspAsset = dissenterList[0]!;
    recommendedDirection = majorityDirection === "bullish" ? "long" : "short";
  } else {
    // Multiple dissenters — verdict is split unless the majority is
    // overwhelming. Treat as split to avoid false-positive PSP signals.
    verdict = "split";
  }

  const summary =
    `Same-bar snapshot across ${bars.length} assets: ` +
    `${bullishCount} bullish, ${bearishCount} bearish, ${dojiCount} doji. ` +
    `Majority: ${majorityDirection}. ` +
    (pspAsset
      ? `PSP detected — dissenter: ${pspAsset}. Recommended ${recommendedDirection}.`
      : `Verdict: ${verdict}.`);

  return {
    totalAssets: bars.length,
    assetStatuses: statuses,
    bullishCount,
    bearishCount,
    dojiCount,
    majorityDirection,
    dissenters: dissenterList,
    pspAsset,
    recommendedDirection,
    verdict,
    summary,
  };
}

export function formatPsp(result: PspResult): string {
  const lines = [
    `PSP Detector — ${result.verdict.toUpperCase()}`,
    "",
    `  Assets: ${result.totalAssets} (${result.bullishCount} bull, ${result.bearishCount} bear, ${result.dojiCount} doji)`,
    `  Majority direction: ${result.majorityDirection}`,
  ];
  for (const a of result.assetStatuses) {
    const tag =
      a.direction === "bullish" ? "▲ bull" : a.direction === "bearish" ? "▼ bear" : "· doji";
    const dissent = a.isDissenter ? " ← dissenter" : "";
    lines.push(`    ${a.symbol.padEnd(8)} ${tag.padEnd(8)} ${(a.changeFraction * 100).toFixed(3)}%${dissent}`);
  }
  if (result.pspAsset) {
    lines.push("");
    lines.push(`  PSP asset: ${result.pspAsset}`);
    if (result.recommendedDirection) {
      lines.push(`  Recommended direction: ${result.recommendedDirection}`);
    }
  }
  lines.push("");
  lines.push(`Summary: ${result.summary}`);
  return lines.join("\n");
}
