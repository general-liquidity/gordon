/**
 * Correlated-Oversold "complex-wide deleveraging" veto.
 *
 * A cross-sectional falling-knife filter. Buying an oversold dip is a
 * reasonable mean-reversion bet WHEN the dip is idiosyncratic. But when
 * a large fraction of the whole universe flips oversold in the SAME
 * cycle, that is not N independent dips you can each fade — it is one
 * broad risk-off flush (a "complex-wide deleveraging"). Every oversold
 * name is then a leaf on the same falling knife, and the correlation
 * that averaging assumes has collapsed to ~1.
 *
 * The rule: if >= `vetoFraction` of the valid universe (and at least
 * `minOversold` names) flips oversold this cycle, veto the WHOLE
 * oversold set for new long entries. Momentum / non-oversold names are
 * untouched — the flush is a reason not to catch knives, not a reason
 * to stop trading strength.
 *
 * "Flip" is measured across the cycle: an asset counts as flipped when
 * its prior-cycle reading was ABOVE the oversold threshold and its
 * current reading is at/below it. Already-oversold names (oversold in
 * both cycles) are part of the vetoed set when the veto fires but do
 * not themselves count toward the flip trigger — the trigger measures
 * fresh, synchronized capitulation, not standing weakness.
 *
 * Distinct from:
 *   - `cross-sectional-momentum.ts`   (ranks winners/losers into baskets;
 *                                      no risk-off veto)
 *   - `cross-sectional-contrarian.ts` (sizes a dollar-neutral book off
 *                                      demeaned returns; this is a binary
 *                                      gate over an oversold set)
 *   - `market-breadth-bias.ts`        (classifies which strategy the tape
 *                                      rewards; this vetoes one basket)
 *   - `regime` detector               (single-symbol state; this is a
 *                                      universe-level co-movement gate)
 *
 * Pure function. Caller supplies the universe snapshot (RSI-style
 * oscillator readings) and the thresholds; no hardcoded universe, no
 * fetching, no fitted parameters.
 */

export interface OversoldAsset {
  symbol: string;
  /**
   * Current-cycle oversold-oscillator reading (e.g. RSI, StochRSI, %B
   * remapped). Lower = more oversold. Compared against
   * `oversoldThreshold`.
   */
  oscillator: number;
  /**
   * Prior-cycle reading of the SAME oscillator. Used to detect a fresh
   * flip into oversold this cycle. If omitted, the asset can still be
   * part of the vetoed set (when currently oversold) but never counts
   * toward the flip trigger.
   */
  priorOscillator?: number;
}

export interface DeleveragingVetoOptions {
  /**
   * Reading at/below which an asset is "oversold". Default 30 (RSI
   * convention). Caller sets to match the supplied oscillator scale.
   */
  oversoldThreshold?: number;
  /**
   * Fraction of the valid universe that must FLIP oversold this cycle to
   * trigger the complex-wide veto. Default 0.60.
   */
  vetoFraction?: number;
  /**
   * Absolute minimum number of fresh oversold flips required to trigger,
   * regardless of fraction. Guards against a tiny universe where 2/3
   * clears 60% but is not a "complex". Default 3.
   */
  minOversold?: number;
  /**
   * Minimum valid universe size for a verdict. Below this the primitive
   * returns insufficient_data. Default 5.
   */
  minUniverse?: number;
}

export type OversoldStatus =
  | "vetoed" // currently oversold AND the veto fired
  | "oversold_dip" // currently oversold but veto did NOT fire (idiosyncratic)
  | "not_oversold"; // above threshold — momentum / neutral, untouched

export interface OversoldAssetResult {
  symbol: string;
  oscillator: number;
  currentlyOversold: boolean;
  /** Flipped from above-threshold last cycle to oversold this cycle. */
  flippedThisCycle: boolean;
  status: OversoldStatus;
}

export type DeleveragingVetoVerdict = "veto" | "no_veto" | "insufficient_data";

export interface DeleveragingVetoResult {
  totalSymbols: number;
  validSymbols: number;
  /** Count of assets that flipped oversold this cycle. */
  flippedCount: number;
  /** Count of assets currently oversold (flipped OR already oversold). */
  oversoldCount: number;
  /** flippedCount / validSymbols. */
  flipFraction: number;
  /** True when the complex-wide deleveraging veto is active. */
  vetoTriggered: boolean;
  /** Symbols whose new long entries are vetoed (empty unless triggered). */
  vetoedSymbols: string[];
  /**
   * Symbols currently oversold that are NOT vetoed — treatable as
   * idiosyncratic dips. Empty when the veto is triggered.
   */
  dipSymbols: string[];
  /** Per-asset breakdown. */
  assets: OversoldAssetResult[];
  verdict: DeleveragingVetoVerdict;
  summary: string;
}

const DEFAULT_OVERSOLD_THRESHOLD = 30;
const DEFAULT_VETO_FRACTION = 0.6;
const DEFAULT_MIN_OVERSOLD = 3;
const DEFAULT_MIN_UNIVERSE = 5;

/**
 * Evaluate the correlated-oversold deleveraging veto across a universe
 * snapshot. Returns which oversold names (if any) to veto for new long
 * entries this cycle.
 */
export function evaluateDeleveragingVeto(
  assets: ReadonlyArray<OversoldAsset>,
  options: DeleveragingVetoOptions = {},
): DeleveragingVetoResult {
  const threshold = options.oversoldThreshold ?? DEFAULT_OVERSOLD_THRESHOLD;
  const vetoFraction = options.vetoFraction ?? DEFAULT_VETO_FRACTION;
  const minOversold = options.minOversold ?? DEFAULT_MIN_OVERSOLD;
  const minUniverse = options.minUniverse ?? DEFAULT_MIN_UNIVERSE;

  const valid = assets.filter((a) => Number.isFinite(a.oscillator));

  if (valid.length < minUniverse) {
    return {
      totalSymbols: assets.length,
      validSymbols: valid.length,
      flippedCount: 0,
      oversoldCount: 0,
      flipFraction: 0,
      vetoTriggered: false,
      vetoedSymbols: [],
      dipSymbols: [],
      assets: [],
      verdict: "insufficient_data",
      summary: `Insufficient valid universe (${valid.length} < ${minUniverse}).`,
    };
  }

  let flippedCount = 0;
  let oversoldCount = 0;
  const evaluated = valid.map((a) => {
    const currentlyOversold = a.oscillator <= threshold;
    const priorKnown =
      typeof a.priorOscillator === "number" && Number.isFinite(a.priorOscillator);
    const flippedThisCycle =
      currentlyOversold && priorKnown && a.priorOscillator! > threshold;
    if (currentlyOversold) oversoldCount += 1;
    if (flippedThisCycle) flippedCount += 1;
    return { asset: a, currentlyOversold, flippedThisCycle };
  });

  const flipFraction = flippedCount / valid.length;
  const vetoTriggered =
    flippedCount >= minOversold && flipFraction >= vetoFraction;

  const assetResults: OversoldAssetResult[] = evaluated.map((e) => {
    let status: OversoldStatus;
    if (!e.currentlyOversold) status = "not_oversold";
    else if (vetoTriggered) status = "vetoed";
    else status = "oversold_dip";
    return {
      symbol: e.asset.symbol,
      oscillator: parseFloat(e.asset.oscillator.toFixed(4)),
      currentlyOversold: e.currentlyOversold,
      flippedThisCycle: e.flippedThisCycle,
      status,
    };
  });

  const vetoedSymbols = assetResults
    .filter((r) => r.status === "vetoed")
    .map((r) => r.symbol);
  const dipSymbols = assetResults
    .filter((r) => r.status === "oversold_dip")
    .map((r) => r.symbol);

  const verdict: DeleveragingVetoVerdict = vetoTriggered ? "veto" : "no_veto";
  const summary = vetoTriggered
    ? `Complex-wide deleveraging: ${flippedCount}/${valid.length} names flipped oversold ` +
      `(${(flipFraction * 100).toFixed(0)}% >= ${(vetoFraction * 100).toFixed(0)}%). ` +
      `Vetoing all ${vetoedSymbols.length} oversold names for new longs; momentum names untouched.`
    : `No deleveraging veto: ${flippedCount}/${valid.length} flipped oversold ` +
      `(${(flipFraction * 100).toFixed(0)}% < ${(vetoFraction * 100).toFixed(0)}% or below min ${minOversold}). ` +
      `${dipSymbols.length} oversold name(s) treatable as idiosyncratic dips.`;

  return {
    totalSymbols: assets.length,
    validSymbols: valid.length,
    flippedCount,
    oversoldCount,
    flipFraction: parseFloat(flipFraction.toFixed(4)),
    vetoTriggered,
    vetoedSymbols,
    dipSymbols,
    assets: assetResults,
    verdict,
    summary,
  };
}

export function formatDeleveragingVeto(result: DeleveragingVetoResult): string {
  const lines = [
    `Deleveraging Veto — ${result.verdict.toUpperCase()}`,
    "",
    `  Universe supplied:  ${result.totalSymbols}`,
    `  Valid for check:    ${result.validSymbols}`,
    `  Flipped oversold:   ${result.flippedCount} (${(result.flipFraction * 100).toFixed(0)}%)`,
    `  Currently oversold: ${result.oversoldCount}`,
    `  Veto triggered:     ${result.vetoTriggered ? "YES" : "no"}`,
  ];
  if (result.vetoedSymbols.length > 0) {
    lines.push("");
    lines.push(`  Vetoed longs (${result.vetoedSymbols.length}): ${result.vetoedSymbols.join(", ")}`);
  }
  if (result.dipSymbols.length > 0) {
    lines.push("");
    lines.push(`  Idiosyncratic dips (${result.dipSymbols.length}): ${result.dipSymbols.join(", ")}`);
  }
  lines.push("");
  lines.push(`Summary: ${result.summary}`);
  return lines.join("\n");
}
