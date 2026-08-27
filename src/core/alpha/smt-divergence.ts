/**
 * Multi-Asset Level-Anchored Divergence (cross-sectional SMT)
 *
 * Generalizes the ICT/"Smart Money Technique" idea — one of N correlated
 * assets sweeps a key level while the others refuse — into a pure cross-
 * sectional primitive. Distinct from:
 *
 *   - `reversal-timing.ts`        (pair-level reversal-timing correlation
 *                                  across the WHOLE series; not anchored
 *                                  to any specific level)
 *   - `effective-n.ts`            (correlation structure, not level-anchored)
 *   - `smc-patterns/detectLiquiditySweeps`  (single-asset sweep detection;
 *                                            does NOT compare across assets)
 *
 * The cross-asset level-anchored check is the missing piece. This works
 * for N ≥ 2 — pair (NQ vs ES), triad (NQ + ES + YM), or anything more.
 *
 * Procedure:
 *   1. Caller supplies, per asset: a recent OHLC window + the asset's
 *      reference level (e.g. previous-day high) + sweep direction.
 *   2. For each asset, check whether its window high/low crossed the
 *      reference level by ≥ minSweepFraction × ADR (asset's own scale).
 *   3. Count assets that swept vs. refused.
 *   4. Verdict: confirmed_sweep (all swept, continuation) /
 *      divergent_sweep (one swept, N-1 refused, manipulation/reversal) /
 *      partial (in between) / no_sweep (nobody crossed).
 *
 * Honest scope: this primitive detects the geometric pattern. The
 * marketed "81% win rate" from the influencer source is unverifiable —
 * operators should backtest the geometric signal against their own
 * data rather than trust marketing claims.
 *
 * Pure function. No I/O.
 */

export interface AssetSnapshot {
  /** Label, e.g. "NQ" / "ES" / "YM" / "BTC" / "ETH". */
  symbol: string;
  /** Highest high in the recent window. */
  windowHigh: number;
  /** Lowest low in the recent window. */
  windowLow: number;
  /** The reference level being tested (e.g. previous day's high). */
  referenceLevel: number;
  /** ADR (or any per-asset scale unit) for normalizing the sweep size. */
  adr: number;
}

export interface SmtDivergenceOptions {
  /**
   * Sweep direction the caller is testing. "up" = checking which assets
   * sweep ABOVE the reference level. "down" = checking which assets
   * sweep BELOW. Required because reference level interpretation
   * differs (PDH vs PDL are tested in opposite directions).
   */
  direction: "up" | "down";
  /**
   * Minimum sweep amount expressed as a fraction of the asset's own ADR.
   * Default 0.05 (5% of ADR — small, but enough to require a real cross
   * rather than rounding noise).
   */
  minSweepFraction?: number;
  /**
   * Maximum sweep amount expressed as a fraction of ADR — sweeps larger
   * than this are treated as full breakouts, not stops-hunt sweeps.
   * Default 1.5 (large enough that a true breakout reads as full
   * confirmation rather than a stops grab).
   */
  maxSweepFraction?: number;
}

export type SmtVerdict =
  | "confirmed_sweep"
  | "divergent_sweep"
  | "partial_confirmation"
  | "no_sweep"
  | "insufficient_data";

export interface PerAssetSweepStatus {
  symbol: string;
  /** Distance past the reference level expressed in ADR units. */
  sweepFractionOfAdr: number;
  swept: boolean;
  refused: boolean;
}

export interface SmtDivergenceResult {
  direction: "up" | "down";
  assetStatuses: PerAssetSweepStatus[];
  sweptCount: number;
  refusedCount: number;
  totalAssets: number;
  /**
   * The single asset that swept when the others refused — only set when
   * exactly one asset swept and at least one refused. This is the
   * "manipulation" signature the article describes.
   */
  isolatedSweeper: string | null;
  verdict: SmtVerdict;
  /**
   * Reversal direction implied by the divergent sweep. Inverse of the
   * sweep direction. null when verdict is not divergent_sweep.
   */
  reversalDirection: "long" | "short" | null;
  summary: string;
}

const DEFAULT_MIN_SWEEP_FRACTION = 0.05;
const DEFAULT_MAX_SWEEP_FRACTION = 1.5;

function sweepFraction(asset: AssetSnapshot, direction: "up" | "down"): number {
  if (asset.adr <= 0) return 0;
  if (direction === "up") {
    return (asset.windowHigh - asset.referenceLevel) / asset.adr;
  }
  return (asset.referenceLevel - asset.windowLow) / asset.adr;
}

export function analyzeSmtDivergence(
  assets: ReadonlyArray<AssetSnapshot>,
  options: SmtDivergenceOptions,
): SmtDivergenceResult {
  const minF = options.minSweepFraction ?? DEFAULT_MIN_SWEEP_FRACTION;
  const maxF = options.maxSweepFraction ?? DEFAULT_MAX_SWEEP_FRACTION;
  const direction = options.direction;

  if (assets.length < 2) {
    return {
      direction,
      assetStatuses: [],
      sweptCount: 0,
      refusedCount: 0,
      totalAssets: assets.length,
      isolatedSweeper: null,
      verdict: "insufficient_data",
      reversalDirection: null,
      summary: "Need at least 2 assets to detect cross-sectional divergence.",
    };
  }

  const statuses: PerAssetSweepStatus[] = assets.map((a) => {
    const frac = sweepFraction(a, direction);
    const swept = frac >= minF && frac <= maxF;
    // Refused = the high/low did not even approach the level (well below
    // the minimum sweep threshold). Distinct from "swept" by a different
    // band — refused means the asset clearly did NOT participate.
    const refused = frac < minF * 0.5;
    return {
      symbol: a.symbol,
      sweepFractionOfAdr: parseFloat(frac.toFixed(4)),
      swept,
      refused,
    };
  });

  const sweptCount = statuses.filter((s) => s.swept).length;
  const refusedCount = statuses.filter((s) => s.refused).length;

  let verdict: SmtVerdict;
  let isolatedSweeper: string | null = null;
  let reversalDirection: "long" | "short" | null = null;

  if (sweptCount === 0) {
    verdict = "no_sweep";
  } else if (sweptCount === assets.length) {
    verdict = "confirmed_sweep";
  } else if (sweptCount === 1 && refusedCount >= 1) {
    verdict = "divergent_sweep";
    isolatedSweeper = statuses.find((s) => s.swept)?.symbol ?? null;
    reversalDirection = direction === "up" ? "short" : "long";
  } else {
    verdict = "partial_confirmation";
  }

  const sweptSymbols = statuses
    .filter((s) => s.swept)
    .map((s) => s.symbol)
    .join(", ");
  const refusedSymbols = statuses
    .filter((s) => s.refused)
    .map((s) => s.symbol)
    .join(", ");
  const summary =
    `${direction.toUpperCase()} sweep test across ${assets.length} assets: ` +
    `${sweptCount} swept (${sweptSymbols || "—"}), ` +
    `${refusedCount} refused (${refusedSymbols || "—"}). ` +
    `→ ${verdict}` +
    (isolatedSweeper ? ` — isolated sweeper: ${isolatedSweeper}` : "") +
    (reversalDirection ? `; implied reversal: ${reversalDirection}.` : ".");

  return {
    direction,
    assetStatuses: statuses,
    sweptCount,
    refusedCount,
    totalAssets: assets.length,
    isolatedSweeper,
    verdict,
    reversalDirection,
    summary,
  };
}

export function formatSmtDivergence(result: SmtDivergenceResult): string {
  const lines = [
    `Multi-Asset SMT — ${result.verdict.toUpperCase()} (${result.direction})`,
    "",
    `  Assets evaluated: ${result.totalAssets}`,
    `  Swept: ${result.sweptCount}`,
    `  Refused: ${result.refusedCount}`,
  ];
  for (const a of result.assetStatuses) {
    const tag = a.swept ? "✓ swept" : a.refused ? "✗ refused" : "· partial";
    lines.push(
      `    ${a.symbol.padEnd(8)} ${tag.padEnd(12)} ${(a.sweepFractionOfAdr * 100).toFixed(1)}% of ADR`,
    );
  }
  if (result.isolatedSweeper) {
    lines.push("");
    lines.push(`  Isolated sweeper: ${result.isolatedSweeper}`);
    if (result.reversalDirection) {
      lines.push(`  Implied reversal: ${result.reversalDirection}`);
    }
  }
  lines.push("");
  lines.push(`Summary: ${result.summary}`);
  return lines.join("\n");
}
