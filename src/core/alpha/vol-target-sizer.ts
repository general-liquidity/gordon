/**
 * Continuous Vol-Target Sizer — Robert-Carver-style.
 *
 * Premise: target a fixed portfolio-level volatility and adjust the
 * notional fraction continuously based on a realized-vol estimate.
 *
 *   raw_multiplier   = target_vol / current_vol
 *   clipped          = clip(raw_multiplier, floor, cap)
 *   target_notional  = current_notional × clipped
 *   drift            = |target_notional − current_notional| / max(current_notional, ε)
 *   rebalance?       = drift > noTradeBandPct
 *
 * Three institutional refinements distinguish this from a naive
 * notional × target / current formula:
 *
 *   1. LEVERAGE CAP — never lever above `leverageCap` even if current
 *      vol collapses. Defends against regime-shift blow-ups when a
 *      prolonged low-vol period suddenly flips.
 *   2. LEVERAGE FLOOR — never go fully to zero (operator-tunable).
 *      Keeps the strategy "in the market" through high-vol stretches
 *      so you don't miss the recovery.
 *   3. NO-TRADE BAND — only rebalance when target notional has drifted
 *      more than X% from current. Cuts transaction cost meaningfully
 *      over hundreds of trades.
 *
 * Distinct from:
 *   - `infra/trading/quant/volScaledSizing.ts`   (DISCRETE band multiplier:
 *                                                  1×/2×/3× by vol regime —
 *                                                  this primitive is the
 *                                                  CONTINUOUS quotient variant)
 *   - `wipeout-cap-sizer.ts`                     (single-trade wipeout floor)
 *   - `cube-root-kelly.ts`                       (Kelly fractional sizing — based
 *                                                  on edge, not realized vol)
 *   - `pre-trade-risk-gate.ts` (LV34)            (4-layer pre-trade gate; this
 *                                                  primitive feeds the per-trade
 *                                                  exposure that gate then checks)
 *
 * Composes with:
 *   - `kalmanVolatility` / `rangeVolatility`     (supplies the current-vol input)
 *   - `pre-trade-risk-gate` (LV34)               (per-trade exposure cap layer)
 *   - `hidden-beta-verifier` (LV35)              (verify the vol-targeted portfolio
 *                                                  is actually factor-neutral)
 *
 * Pure compute. Pedigree: Robert Carver "Systematic Trading," institutional
 * vol-targeting practice; algo trader 2026 volatility-targeting video.
 */

export interface VolTargetSizerInput {
  /** Target annualized portfolio volatility (positive fraction, e.g., 0.10 = 10%). */
  targetAnnualVol: number;
  /** Current annualized vol estimate (e.g., from kalmanVolatility output). */
  currentAnnualVol: number;
  /**
   * Current notional fraction of capital allocated to the strategy
   * (1.0 = fully allocated, 2.0 = 2× levered, 0.5 = half allocated).
   * Default 1.0.
   */
  currentNotionalFraction?: number;
}

export interface VolTargetSizerOptions {
  /** Maximum allowed multiplier on current notional. Default 2.0 (cap at 2× lever). */
  leverageCap?: number;
  /**
   * Minimum allowed multiplier — defends against "fully out" exits during
   * vol spikes. Default 0.20 (never fewer than 20% of current notional).
   * Set to 0 to allow full de-risking.
   */
  leverageFloor?: number;
  /**
   * Drift threshold (fraction) below which no rebalance is recommended.
   * Default 0.10 (10% drift). Cuts transaction cost on small adjustments.
   */
  noTradeBandPct?: number;
  /**
   * Minimum current-vol value to avoid division-by-tiny-number explosions.
   * Below this, primitive emits insufficient_data. Default 1e-6.
   */
  minCurrentVol?: number;
}

export type VolTargetVerdict =
  | "within_band_no_rebalance"
  | "rebalance_recommended"
  | "at_leverage_cap"
  | "at_leverage_floor"
  | "insufficient_data";

export interface VolTargetSizerResult {
  targetAnnualVol: number;
  currentAnnualVol: number;
  currentNotionalFraction: number;
  /** Unclipped target/current ratio. */
  rawMultiplier: number;
  /** Multiplier after applying [floor, cap] clip. */
  clippedMultiplier: number;
  /** Resulting target notional fraction = current × clippedMultiplier. */
  targetNotionalFraction: number;
  /** |target − current| / max(current, eps). */
  driftFraction: number;
  /**
   * Expected annualized vol the portfolio will run at after this rebalance:
   * clippedMultiplier × currentAnnualVol. Equal to targetAnnualVol unless
   * cap/floor clipped.
   */
  expectedAnnualVol: number;
  /** Whether floor or cap was bound. */
  cappedAtLimit: "cap" | "floor" | null;
  /** Whether rebalance is recommended given the no-trade band. */
  shouldRebalance: boolean;
  verdict: VolTargetVerdict;
  summary: string;
}

const DEFAULT_CAP = 2.0;
const DEFAULT_FLOOR = 0.20;
const DEFAULT_NO_TRADE_BAND = 0.10;
const DEFAULT_MIN_VOL = 1e-6;

function fmtPct(x: number): string {
  return `${(x * 100).toFixed(2)}%`;
}

export function sizeWithVolTarget(
  input: VolTargetSizerInput,
  options: VolTargetSizerOptions = {},
): VolTargetSizerResult {
  const cap = options.leverageCap ?? DEFAULT_CAP;
  const floor = options.leverageFloor ?? DEFAULT_FLOOR;
  const band = options.noTradeBandPct ?? DEFAULT_NO_TRADE_BAND;
  const minVol = options.minCurrentVol ?? DEFAULT_MIN_VOL;
  const currentNotional = input.currentNotionalFraction ?? 1.0;

  if (
    input.targetAnnualVol <= 0 ||
    !Number.isFinite(input.targetAnnualVol) ||
    input.currentAnnualVol < minVol ||
    !Number.isFinite(input.currentAnnualVol) ||
    floor < 0 ||
    cap < floor
  ) {
    return {
      targetAnnualVol: input.targetAnnualVol,
      currentAnnualVol: input.currentAnnualVol,
      currentNotionalFraction: currentNotional,
      rawMultiplier: 0,
      clippedMultiplier: 0,
      targetNotionalFraction: currentNotional,
      driftFraction: 0,
      expectedAnnualVol: input.currentAnnualVol,
      cappedAtLimit: null,
      shouldRebalance: false,
      verdict: "insufficient_data",
      summary:
        input.currentAnnualVol < minVol
          ? `Current vol ${fmtPct(input.currentAnnualVol)} below floor ${fmtPct(minVol)} — refusing to size.`
          : `Invalid inputs (target ${fmtPct(input.targetAnnualVol)}, floor ${floor}, cap ${cap}).`,
    };
  }

  const rawMultiplier = input.targetAnnualVol / input.currentAnnualVol;

  let clippedMultiplier = rawMultiplier;
  let cappedAtLimit: VolTargetSizerResult["cappedAtLimit"] = null;
  if (clippedMultiplier > cap) {
    clippedMultiplier = cap;
    cappedAtLimit = "cap";
  } else if (clippedMultiplier < floor) {
    clippedMultiplier = floor;
    cappedAtLimit = "floor";
  }

  const targetNotional = currentNotional * clippedMultiplier;
  const expectedVol = clippedMultiplier * input.currentAnnualVol;

  // Drift: |target − current| / max(current, eps). Avoid div-by-zero when
  // current is exactly zero.
  const denom = Math.max(Math.abs(currentNotional), minVol);
  const drift = Math.abs(targetNotional - currentNotional) / denom;
  const shouldRebalance = drift > band;

  let verdict: VolTargetVerdict;
  if (!shouldRebalance) {
    verdict = "within_band_no_rebalance";
  } else if (cappedAtLimit === "cap") {
    verdict = "at_leverage_cap";
  } else if (cappedAtLimit === "floor") {
    verdict = "at_leverage_floor";
  } else {
    verdict = "rebalance_recommended";
  }

  const summary = (() => {
    switch (verdict) {
      case "within_band_no_rebalance":
        return `HOLD — drift ${fmtPct(drift)} within ±${fmtPct(band)} band. Current ${fmtPct(currentNotional)} notional remains.`;
      case "rebalance_recommended":
        return `REBALANCE → ${fmtPct(targetNotional)} (from ${fmtPct(currentNotional)}). Raw multiplier ${clippedMultiplier.toFixed(3)}, expected vol ${fmtPct(expectedVol)}.`;
      case "at_leverage_cap":
        return `REBALANCE to LEVERAGE CAP (${cap}×) — raw multiplier ${rawMultiplier.toFixed(2)} clipped. Expected vol ${fmtPct(expectedVol)} < target ${fmtPct(input.targetAnnualVol)} (current vol too low for full target).`;
      case "at_leverage_floor":
        return `REBALANCE to LEVERAGE FLOOR (${floor}×) — raw multiplier ${rawMultiplier.toFixed(2)} clipped. Expected vol ${fmtPct(expectedVol)} > target ${fmtPct(input.targetAnnualVol)} (current vol too high; floor prevents full exit).`;
      default:
        return "Insufficient data.";
    }
  })();

  return {
    targetAnnualVol: parseFloat(input.targetAnnualVol.toFixed(6)),
    currentAnnualVol: parseFloat(input.currentAnnualVol.toFixed(6)),
    currentNotionalFraction: parseFloat(currentNotional.toFixed(6)),
    rawMultiplier: parseFloat(rawMultiplier.toFixed(6)),
    clippedMultiplier: parseFloat(clippedMultiplier.toFixed(6)),
    targetNotionalFraction: parseFloat(targetNotional.toFixed(6)),
    driftFraction: parseFloat(drift.toFixed(6)),
    expectedAnnualVol: parseFloat(expectedVol.toFixed(6)),
    cappedAtLimit,
    shouldRebalance,
    verdict,
    summary,
  };
}

export function formatVolTargetSizer(result: VolTargetSizerResult): string {
  const lines = [
    `Vol-Target Sizer — ${result.verdict.toUpperCase()}`,
    "",
    `  Target ann. vol:        ${(result.targetAnnualVol * 100).toFixed(2)}%`,
    `  Current ann. vol:       ${(result.currentAnnualVol * 100).toFixed(2)}%`,
    `  Current notional:       ${(result.currentNotionalFraction * 100).toFixed(2)}%`,
    `  Raw multiplier:         ${result.rawMultiplier.toFixed(3)}`,
    `  Clipped multiplier:     ${result.clippedMultiplier.toFixed(3)}${result.cappedAtLimit ? ` (at ${result.cappedAtLimit})` : ""}`,
    `  Target notional:        ${(result.targetNotionalFraction * 100).toFixed(2)}%`,
    `  Drift:                  ${(result.driftFraction * 100).toFixed(2)}%`,
    `  Expected ann. vol:      ${(result.expectedAnnualVol * 100).toFixed(2)}%`,
    `  Should rebalance:       ${result.shouldRebalance ? "yes" : "no"}`,
    "",
    `Summary: ${result.summary}`,
  ];
  return lines.join("\n");
}
