/**
 * Vol-Scaled Position Sizing (GORDON_VOL_SCALED_SIZING).
 *
 * Maps a current-volatility estimate to a discrete position multiplier
 * based on configurable quantile thresholds. Pattern from the
 * autoresearch-trading options income study: when VIX < 20 trade 1
 * contract, when VIX is 20-30 trade 2, when VIX > 30 trade 3
 * (vol-scale-up) or skip (vol-scale-down). The "scale up in storms"
 * variant tends to win on options strategies (more premium); "scale
 * down" wins on directional strategies (lower drawdown).
 *
 * Distinct from empirical-Kelly (SC4), which produces a continuous
 * fractional sizing recommendation. This module returns a discrete
 * contract/position multiplier and is meant to be the LAST step
 * before order submission, applied on top of a base position size.
 *
 * Composes with:
 *   - KF2 kalmanVolatility / AQ1 rangeVolatility — provide currentVol
 *   - SC4 empiricalKelly — base fractional size; this module scales it
 *   - shadow chain sizer — discrete contract multiplier applied at the
 *     end of the sizing chain
 */

export const VOL_SCALED_SIZING_FLAG_ENV = "GORDON_VOL_SCALED_SIZING";

export function isVolScaledSizingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    env[VOL_SCALED_SIZING_FLAG_ENV] === "1" ||
    env[VOL_SCALED_SIZING_FLAG_ENV] === "true"
  );
}

export type SizingMode = "scale_up" | "scale_down";

export interface VolBand {
  /** Inclusive lower bound on the volatility level (e.g. 0.20 = 20%). */
  volAtLeast: number;
  /** Position multiplier to apply when current vol ≥ volAtLeast. */
  multiplier: number;
  /** Optional human label. */
  label?: string;
}

export interface VolScaledSizingInput {
  /** Current volatility level (annualized, decimal). */
  currentVol: number;
  /** Either provide custom bands OR rely on mode + (lowVol, highVol). */
  bands?: ReadonlyArray<VolBand>;
  /** Default behavior when bands are omitted. Default "scale_down". */
  mode?: SizingMode;
  /** Vol level below which we're "calm". Default 0.20. */
  lowVol?: number;
  /** Vol level above which we're "stormy". Default 0.30. */
  highVol?: number;
  /** Hard refuse threshold — when current vol ≥ this, multiplier = 0. Default 0.60. */
  refuseAbove?: number;
}

export type SizingVerdict = "size_up" | "size_normal" | "size_down" | "refuse";

export interface VolScaledSizingResult {
  multiplier: number;
  verdict: SizingVerdict;
  appliedBand: VolBand;
  reasoning: string;
}

const DEFAULT_LOW = 0.2;
const DEFAULT_HIGH = 0.3;
const DEFAULT_REFUSE = 0.6;

function defaultBands(mode: SizingMode, lo: number, hi: number, refuse: number): VolBand[] {
  if (mode === "scale_up") {
    return [
      { volAtLeast: refuse, multiplier: 0, label: "extreme — refuse" },
      { volAtLeast: hi, multiplier: 3, label: "high vol — scale up 3×" },
      { volAtLeast: lo, multiplier: 2, label: "elevated vol — 2×" },
      { volAtLeast: 0, multiplier: 1, label: "calm — 1×" },
    ];
  }
  // scale_down: lower size in storms, full size in calm.
  return [
    { volAtLeast: refuse, multiplier: 0, label: "extreme — refuse" },
    { volAtLeast: hi, multiplier: 0.33, label: "high vol — 0.33×" },
    { volAtLeast: lo, multiplier: 0.66, label: "elevated vol — 0.66×" },
    { volAtLeast: 0, multiplier: 1, label: "calm — 1×" },
  ];
}

function pickBand(currentVol: number, bands: ReadonlyArray<VolBand>): VolBand {
  // Bands are searched from highest threshold to lowest.
  const sorted = [...bands].sort((a, b) => b.volAtLeast - a.volAtLeast);
  for (const band of sorted) {
    if (currentVol >= band.volAtLeast) return band;
  }
  return { volAtLeast: 0, multiplier: 1, label: "fallback — 1×" };
}

function classifyVerdict(mode: SizingMode, multiplier: number): SizingVerdict {
  if (multiplier <= 0) return "refuse";
  if (mode === "scale_up") {
    if (multiplier > 2) return "size_up";
    if (multiplier > 1) return "size_up";
    return "size_normal";
  }
  if (multiplier < 0.5) return "size_down";
  if (multiplier < 1) return "size_down";
  return "size_normal";
}

export function computeVolScaledSizing(input: VolScaledSizingInput): VolScaledSizingResult {
  const mode = input.mode ?? "scale_down";
  const lo = input.lowVol ?? DEFAULT_LOW;
  const hi = input.highVol ?? DEFAULT_HIGH;
  const refuse = input.refuseAbove ?? DEFAULT_REFUSE;
  const bands = input.bands ?? defaultBands(mode, lo, hi, refuse);

  const cv = input.currentVol;
  if (!Number.isFinite(cv) || cv < 0) {
    return {
      multiplier: 1,
      verdict: "size_normal",
      appliedBand: { volAtLeast: 0, multiplier: 1, label: "invalid vol — fallback to 1×" },
      reasoning: `invalid vol input ${cv}; falling back to 1× multiplier`,
    };
  }

  const band = pickBand(cv, bands);
  const verdict = classifyVerdict(mode, band.multiplier);
  const reasoning =
    `Vol ${(cv * 100).toFixed(1)}% (${mode}): applies band "${band.label ?? `>= ${band.volAtLeast}`}" → ${band.multiplier}× (${verdict})`;

  return {
    multiplier: band.multiplier,
    verdict,
    appliedBand: band,
    reasoning,
  };
}

export function volScaledSizingToPayload(result: VolScaledSizingResult): Record<string, unknown> {
  return {
    kind: "vol_scaled_sizing.computed",
    multiplier: Number(result.multiplier.toFixed(4)),
    verdict: result.verdict,
    appliedBandLabel: result.appliedBand.label ?? null,
  };
}
