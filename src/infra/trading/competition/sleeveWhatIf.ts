/**
 * Sleeve What-If — pure decision aid for the lottery "sleeve" bet.
 *
 * The sleeve is one leveraged directional bet of `sleeveMargin` USD at
 * `sleeveLeverage`, on a high-vol instrument, held for `barsHeld` 15-min bars.
 * Given our current standing in the ~500-entrant field, this simulates the
 * sleeve's win/lose outcomes and the resulting rank, so the operator can read
 * "if it wins → rank X, if it loses → still survives at rank Y".
 *
 * MODEL. The position's return over the horizon is a driftless Normal move:
 *   positionReturn ~ Normal(0, perBarVol · sqrt(barsHeld)).
 * PnL in account terms is that move scaled by the levered notional:
 *   sleevePnL_usd   = positionReturn · sleeveMargin · sleeveLeverage
 *   resultingEquity = currentEquity + sleevePnL_usd
 *   resultingReturn = (resultingEquity − startingEquity) / startingEquity
 *   resultingPercentile = Φ((resultingReturn − field.mean) / field.std)
 *   resultingRank   ≈ round((1 − percentile) · (fieldN − 1)) + 1
 *
 * Driftless ⇒ win-vs-hold is a coin flip (0.5). The value of the aid is the
 * MAGNITUDE and RANK SPREAD between win and lose, not a directional edge.
 *
 * Pure compute. Inline standard-normal CDF; no competition-module imports.
 * Validate at boundaries only; never throws. No deps, no Math.random.
 */

/** The field's realized-return distribution (override from a live board if available). */
export interface ReturnField {
  /** Field mean return (fraction, e.g. 0.0 = flat). */
  mean: number;
  /** Field return std (fraction, e.g. 0.40 = 40%). */
  std: number;
}

export interface SleeveScenario {
  label: "P10" | "P50" | "P90" | "win1sd" | "lose1sd";
  sleevePnLUsd: number;
  resultingReturn: number;
  resultingPercentile: number;
  resultingRank: number;
}

export interface SleeveWhatIf {
  scenarios: SleeveScenario[];
  /** P(resultingReturn > currentReturn). Driftless ⇒ 0.5 (coin flip). */
  pWinVsHold: number;
  summary: string;
}

export interface SleeveWhatIfInput {
  startingEquity: number;
  currentEquity: number;
  sleeveMargin: number;
  sleeveLeverage: number;
  perBarVol: number;
  barsHeld: number;
  returnField: ReturnField;
  fieldN?: number;
}

const DEFAULT_FIELD_N = 500;

/** ±1.2816 ≈ the 10th / 90th percentile of the standard normal. */
const Z_P10 = -1.2815515594465625;
const Z_P90 = 1.2815515594465625;

/**
 * Standard-normal CDF Φ(x) via the Abramowitz & Stegun 7.1.26 erf approximation.
 * Max abs error ~1.5e-7 — ample for a rank read-out.
 */
function normCdf(x: number): number {
  const z = x / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * Math.abs(z));
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t *
      Math.exp(-z * z);
  const erf = z >= 0 ? y : -y;
  return 0.5 * (1 + erf);
}

interface DerivedRank {
  resultingReturn: number;
  resultingPercentile: number;
  resultingRank: number;
}

function deriveRank(
  resultingEquity: number,
  startingEquity: number,
  field: ReturnField,
  fieldN: number,
): DerivedRank {
  const resultingReturn = (resultingEquity - startingEquity) / startingEquity;
  const resultingPercentile =
    field.std > 0 ? normCdf((resultingReturn - field.mean) / field.std) : 0.5;
  const resultingRank = Math.round((1 - resultingPercentile) * (fieldN - 1)) + 1;
  return { resultingReturn, resultingPercentile, resultingRank };
}

export function simulateSleeve(input: SleeveWhatIfInput): SleeveWhatIf {
  const {
    startingEquity,
    currentEquity,
    sleeveMargin,
    sleeveLeverage,
    perBarVol,
    barsHeld,
    returnField,
    fieldN = DEFAULT_FIELD_N,
  } = input;

  const leveredNotional = sleeveMargin * sleeveLeverage;
  const degenerate = perBarVol <= 0 || barsHeld <= 0;

  // Horizon std of the driftless position move: σ · sqrt(bars).
  const horizonStd = degenerate ? 0 : perBarVol * Math.sqrt(barsHeld);

  const labels: SleeveScenario["label"][] = ["P10", "P50", "P90", "win1sd", "lose1sd"];
  const zByLabel: Record<SleeveScenario["label"], number> = {
    P10: Z_P10,
    P50: 0,
    P90: Z_P90,
    win1sd: 1,
    lose1sd: -1,
  };

  const scenarios: SleeveScenario[] = labels.map((label) => {
    // Degenerate inputs → no-op: every scenario is "hold" (zero sleeve move).
    const positionReturn = degenerate ? 0 : zByLabel[label] * horizonStd;
    const sleevePnLUsd = positionReturn * leveredNotional;
    const resultingEquity = currentEquity + sleevePnLUsd;
    const { resultingReturn, resultingPercentile, resultingRank } = deriveRank(
      resultingEquity,
      startingEquity,
      returnField,
      fieldN,
    );
    return {
      label,
      sleevePnLUsd,
      resultingReturn,
      resultingPercentile,
      resultingRank,
    };
  });

  const byLabel = (l: SleeveScenario["label"]): SleeveScenario =>
    scenarios.find((s) => s.label === l)!;

  const win = byLabel("win1sd");
  const lose = byLabel("lose1sd");
  const hold = byLabel("P50");

  const pct = (r: number): string => `${(r * 100).toFixed(1)}%`;
  const summary = [
    `Sleeve: $${sleeveMargin.toFixed(0)} @ ${sleeveLeverage}x over ${barsHeld} bars` +
      (degenerate ? " (degenerate inputs → no-op, all scenarios = hold)." : "."),
    `Hold (no sleeve): return ${pct(hold.resultingReturn)}, rank ~${hold.resultingRank}.`,
    `If it WINS (+1σ): return ${pct(win.resultingReturn)}, rank ~${win.resultingRank} ` +
      `(PnL ${win.sleevePnLUsd >= 0 ? "+" : ""}$${win.sleevePnLUsd.toFixed(0)}).`,
    `If it LOSES (−1σ): return ${pct(lose.resultingReturn)}, rank ~${lose.resultingRank} ` +
      `(PnL ${lose.sleevePnLUsd >= 0 ? "+" : ""}$${lose.sleevePnLUsd.toFixed(0)}). ` +
      `Win-vs-hold is a coin flip (0.5); the edge is the rank spread.`,
  ].join("\n");

  return { scenarios, pWinVsHold: 0.5, summary };
}
