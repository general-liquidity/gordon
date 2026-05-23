/**
 * Dark-Pool Adverse-Selection Scorer (Moallemi-style venue-level)
 *
 * Quantifies the IMPLICIT fee paid on dark-pool fills via the
 * mechanism Moallemi formalizes: dark-pool participants experience
 * adverse selection because their fills correlate with subsequent
 * adverse price moves. The naive "mid-market execution at zero
 * transaction fee" view is wrong — the implicit fee is statistical,
 * not posted.
 *
 * The primitive aggregates over a BATCH of dark-pool fills and
 * compares the implicit adverse-selection cost to the nominal saving
 * vs trading on the lit market (paying the bid-ask spread). Output:
 *   - average implicit fee per share (in price units)
 *   - implicit fee in bps of price
 *   - comparison to bid-ask spread that would have been paid on lit
 *   - net verdict: net_benefit / breakeven / net_loss
 *
 * Distinct from:
 *   - `adverseSelectionDetector.ts` (per-fill Wright-style classifier;
 *                                    this aggregates over many fills
 *                                    and compares to the nominal saving)
 *   - `fake-liquidity.ts`           (pre-trade wash-trading detection)
 *   - `latency-cost.ts`             (execution latency, not venue choice)
 *
 * Composes with: any operator routing flow to dark venues. Can also
 * be used in "shadow" mode by simulating dark-pool fills against a
 * lit-market reference series.
 *
 * Pure function.
 */

export interface DarkPoolFill {
  /** Side of the operator's order. */
  side: "buy" | "sell";
  /** Fill price (typically mid-market for dark pools). */
  fillPrice: number;
  /** Quantity filled (in shares or base units). */
  quantity: number;
  /** Reference mid-market price N seconds after the fill. */
  midPriceAfterWindow: number;
  /**
   * Bid-ask spread on the lit market at the time of fill, in price
   * units (e.g. $0.01). Used to compute nominal saving for the
   * comparison.
   */
  litMarketSpread: number;
}

export interface DarkPoolAdverseSelectionOptions {
  /**
   * Minimum fills required for a verdict. Default 20 — venue-level
   * conclusions need a non-trivial sample.
   */
  minFills?: number;
  /**
   * Tolerance band (in bps) around zero net effect; results within
   * this band classify as breakeven. Default 1 bp.
   */
  breakevenBandBps?: number;
}

export type DarkPoolVerdict =
  | "net_benefit"
  | "breakeven"
  | "net_loss"
  | "insufficient_data";

export interface DarkPoolAdverseSelectionResult {
  fillCount: number;
  totalQuantity: number;
  /** Average adverse move per share across all fills (signed by side). */
  avgAdverseMovePerShare: number;
  /** Same quantity expressed in bps of the average fill price. */
  avgAdverseMoveBps: number;
  /** Average nominal saving per share (half of lit-market spread). */
  avgNominalSavingPerShare: number;
  /** Same quantity expressed in bps. */
  avgNominalSavingBps: number;
  /**
   * Net per-share economics: nominal saving MINUS adverse-selection cost.
   * Positive = real benefit; negative = implicit fee > nominal saving.
   */
  netPerShare: number;
  netBps: number;
  verdict: DarkPoolVerdict;
  summary: string;
}

const DEFAULT_MIN_FILLS = 20;
const DEFAULT_BREAKEVEN_BAND_BPS = 1;

export function scoreDarkPoolAdverseSelection(
  fills: ReadonlyArray<DarkPoolFill>,
  options: DarkPoolAdverseSelectionOptions = {},
): DarkPoolAdverseSelectionResult {
  const minFills = options.minFills ?? DEFAULT_MIN_FILLS;
  const breakevenBand = options.breakevenBandBps ?? DEFAULT_BREAKEVEN_BAND_BPS;

  if (fills.length < minFills) {
    return {
      fillCount: fills.length,
      totalQuantity: fills.reduce((s, f) => s + f.quantity, 0),
      avgAdverseMovePerShare: 0,
      avgAdverseMoveBps: 0,
      avgNominalSavingPerShare: 0,
      avgNominalSavingBps: 0,
      netPerShare: 0,
      netBps: 0,
      verdict: "insufficient_data",
      summary: `Need ≥ ${minFills} fills for a venue-level verdict (have ${fills.length}).`,
    };
  }

  let totalAdverseMove = 0;
  let totalNominalSaving = 0;
  let totalQuantity = 0;
  let totalQuantityWeightedPrice = 0;

  for (const fill of fills) {
    if (fill.fillPrice <= 0 || fill.quantity <= 0) continue;
    // Adverse move per share, signed by side:
    //   buy:  if price went DOWN after fill, that's adverse (we paid too much)
    //   sell: if price went UP after fill, that's adverse (we sold too cheap)
    const rawMove = fill.midPriceAfterWindow - fill.fillPrice;
    const adverseMove = fill.side === "buy" ? -rawMove : rawMove;
    // Nominal saving = half the lit spread (mid-market fill saves half
    // the bid-ask round trip compared to crossing the spread on a lit
    // venue with a market order)
    const nominalSaving = fill.litMarketSpread / 2;

    totalAdverseMove += adverseMove * fill.quantity;
    totalNominalSaving += nominalSaving * fill.quantity;
    totalQuantity += fill.quantity;
    totalQuantityWeightedPrice += fill.fillPrice * fill.quantity;
  }

  if (totalQuantity === 0) {
    return {
      fillCount: fills.length,
      totalQuantity: 0,
      avgAdverseMovePerShare: 0,
      avgAdverseMoveBps: 0,
      avgNominalSavingPerShare: 0,
      avgNominalSavingBps: 0,
      netPerShare: 0,
      netBps: 0,
      verdict: "insufficient_data",
      summary: "Zero total fill quantity.",
    };
  }

  const avgAdverseMovePerShare = totalAdverseMove / totalQuantity;
  const avgNominalSavingPerShare = totalNominalSaving / totalQuantity;
  const avgPrice = totalQuantityWeightedPrice / totalQuantity;
  const netPerShare = avgNominalSavingPerShare - avgAdverseMovePerShare;

  const toBps = (priceUnits: number) =>
    avgPrice > 0 ? (priceUnits / avgPrice) * 10000 : 0;

  const avgAdverseMoveBps = toBps(avgAdverseMovePerShare);
  const avgNominalSavingBps = toBps(avgNominalSavingPerShare);
  const netBps = toBps(netPerShare);

  let verdict: DarkPoolVerdict;
  if (Math.abs(netBps) <= breakevenBand) verdict = "breakeven";
  else if (netBps > 0) verdict = "net_benefit";
  else verdict = "net_loss";

  const summary =
    `${fills.length} fills, total qty ${totalQuantity}. ` +
    `Avg adverse move: ${avgAdverseMoveBps.toFixed(2)} bps. ` +
    `Avg nominal saving: ${avgNominalSavingBps.toFixed(2)} bps. ` +
    `Net: ${netBps >= 0 ? "+" : ""}${netBps.toFixed(2)} bps → ${verdict}.` +
    (verdict === "net_loss"
      ? " The 'free mid-market execution' is statistically eaten by adverse selection."
      : verdict === "net_benefit"
        ? " Dark venue genuinely improves execution net of the implicit fee."
        : " Adverse selection roughly offsets nominal saving.");

  return {
    fillCount: fills.length,
    totalQuantity,
    avgAdverseMovePerShare: parseFloat(avgAdverseMovePerShare.toFixed(8)),
    avgAdverseMoveBps: parseFloat(avgAdverseMoveBps.toFixed(4)),
    avgNominalSavingPerShare: parseFloat(avgNominalSavingPerShare.toFixed(8)),
    avgNominalSavingBps: parseFloat(avgNominalSavingBps.toFixed(4)),
    netPerShare: parseFloat(netPerShare.toFixed(8)),
    netBps: parseFloat(netBps.toFixed(4)),
    verdict,
    summary,
  };
}

export function formatDarkPoolAdverseSelection(
  result: DarkPoolAdverseSelectionResult,
): string {
  const lines = [
    `Dark-Pool Adverse Selection — ${result.verdict.toUpperCase()}`,
    "",
    `  Fills: ${result.fillCount}`,
    `  Total quantity: ${result.totalQuantity}`,
    `  Avg adverse move:   ${result.avgAdverseMoveBps.toFixed(2)} bps`,
    `  Avg nominal saving: ${result.avgNominalSavingBps.toFixed(2)} bps`,
    `  Net:                ${result.netBps >= 0 ? "+" : ""}${result.netBps.toFixed(2)} bps`,
    "",
    `Summary: ${result.summary}`,
  ];
  if (result.verdict === "net_loss") {
    lines.push("");
    lines.push("⚠ Dark-venue routing is losing money relative to lit-market execution.");
    lines.push("  Reconsider venue choice or measure per-counterparty toxicity.");
  } else if (result.verdict === "net_benefit") {
    lines.push("");
    lines.push("✓ Dark-venue routing genuinely improves execution net of the implicit fee.");
  }
  return lines.join("\n");
}
