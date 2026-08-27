/**
 * Dealer Greeks Exposure — the "vanna chart" in aggregate (GEX / vanna / charm).
 *
 * Per-option Greeks (blackScholesGreeks.ts) tell you how ONE option's delta is
 * reshaped by price (gamma), vol (vanna), and time (charm). This module sums
 * those across an options chain weighted by open interest to estimate the
 * AGGREGATE dealer hedging pressure — the thing that moves the underlying when
 * market makers hedge their book:
 *
 *   - Gamma exposure (GEX): how much dealer delta changes per 1% spot move.
 *     The zero-gamma "flip" is where stabilizing (long-gamma: sell rallies / buy
 *     dips) turns into amplifying (short-gamma: buy rallies / sell dips).
 *   - Vanna exposure: how much dealer delta changes per 1% IV move. This is the
 *     flow that fires during vol compression/expansion even when price is flat.
 *   - Charm exposure: how dealer delta drifts per day as time passes (the pin /
 *     drift-to-strike pressure into expiry).
 *
 * ── Modeling assumption (explicit, because it's the load-bearing one) ─────────
 * Real dealer inventory is unobservable. The naive convention used here (and by
 * SqueezeMetrics/SpotGamma-style GEX) assumes dealers are LONG calls and SHORT
 * puts — `callSign = +1`, `putSign = −1`. Both are overridable. The OUTPUT is
 * only as good as that assumption; treat it as a structural map, not truth.
 *
 * DATA-GATED: needs an options chain (strike × expiry open interest + per-contract
 * IV). Gordon sources crypto-perp OI (openInterestDirection.ts), not an options
 * chain, so this stays an internal primitive until a chain feed is wired. Pure
 * compute, no I/O, deterministic.
 */

import { computeBlackScholesGreeks, type OptionType } from "./blackScholesGreeks.ts";

export interface OptionContract {
  strike: number;
  /** Time to expiry in years. */
  timeYears: number;
  /** Open interest (number of contracts). */
  openInterest: number;
  optionType: OptionType;
  /** Per-contract implied volatility (σ), e.g. 0.45 = 45%. Must be > 0. */
  iv: number;
}

export interface DealerExposureParams {
  /** Current underlying spot. */
  spot: number;
  /** Continuously-compounded risk-free rate. */
  rate: number;
  /** Continuous dividend yield (q). Default 0. */
  dividendYield?: number;
  /** Contract multiplier (shares per contract). Default 100 (equity options). */
  contractMultiplier?: number;
  /** Dealer-position assumption — sign applied to call OI. Default +1 (long). */
  callSign?: 1 | -1;
  /** Dealer-position assumption — sign applied to put OI. Default −1 (short). */
  putSign?: 1 | -1;
  /** Profile grid resolution. Default 41 levels. */
  gridLevels?: number;
  /** Profile half-width as a fraction of spot. Default 0.2 (±20%). */
  gridHalfWidthPct?: number;
}

export interface ExposurePoint {
  /** Underlying price this point was evaluated at. */
  spot: number;
  /** Net dealer delta change ($) per 1% move in spot. */
  gammaExposure: number;
  /** Net dealer delta change ($) per 1% (1 vol-point) move in IV. */
  vannaExposure: number;
  /** Net dealer delta drift ($) per calendar day. */
  charmExposure: number;
}

export interface DealerExposureResult {
  /** Exposures at the current spot. */
  atSpot: ExposurePoint;
  /** Exposure curve across the price grid (low → high spot). */
  profile: ExposurePoint[];
  /** Zero-gamma price (gamma flip), linearly interpolated, or null if the net
   *  gamma profile never crosses zero over the grid. */
  gammaFlipPrice: number | null;
  interpretation: string;
}

function exposureAt(
  s: number,
  chain: ReadonlyArray<OptionContract>,
  params: DealerExposureParams,
): ExposurePoint {
  const mult = params.contractMultiplier ?? 100;
  const callSign = params.callSign ?? 1;
  const putSign = params.putSign ?? -1;
  const q = params.dividendYield ?? 0;

  let gammaExposure = 0;
  let vannaExposure = 0;
  let charmExposure = 0;

  for (const c of chain) {
    if (c.timeYears <= 0 || c.iv <= 0 || c.openInterest <= 0) continue;
    const g = computeBlackScholesGreeks({
      spot: s,
      strike: c.strike,
      timeYears: c.timeYears,
      rate: params.rate,
      volatility: c.iv,
      dividendYield: q,
      optionType: c.optionType,
    });
    if (!Number.isFinite(g.gamma)) continue;
    const notional = (c.optionType === "call" ? callSign : putSign) * c.openInterest * mult;
    // GEX: $ delta per 1% spot move = Γ · notional · S² · 0.01.
    gammaExposure += notional * g.gamma * s * s * 0.01;
    // Vanna exposure: $ delta per 1% vol = vanna(∂Δ/∂σ per 1.0 vol) · 0.01 · notional · S.
    vannaExposure += notional * g.vanna * 0.01 * s;
    // Charm exposure: $ delta drift per day = charm(∂Δ/∂t per yr) / 365 · notional · S.
    charmExposure += (notional * g.charm * s) / 365;
  }
  return { spot: s, gammaExposure, vannaExposure, charmExposure };
}

/** Linear-interpolate the first zero crossing of gammaExposure across the grid. */
function findGammaFlip(profile: ExposurePoint[]): number | null {
  for (let i = 1; i < profile.length; i++) {
    const a = profile[i - 1]!;
    const b = profile[i]!;
    if (a.gammaExposure === 0) return a.spot;
    if (a.gammaExposure * b.gammaExposure < 0) {
      const t = a.gammaExposure / (a.gammaExposure - b.gammaExposure);
      return a.spot + t * (b.spot - a.spot);
    }
  }
  const last = profile[profile.length - 1];
  return last && last.gammaExposure === 0 ? last.spot : null;
}

export function computeDealerGreeksExposure(
  chain: ReadonlyArray<OptionContract>,
  params: DealerExposureParams,
): DealerExposureResult {
  if (!Number.isFinite(params.spot) || params.spot <= 0) {
    throw new Error("spot must be positive and finite");
  }
  const levels = Math.max(3, params.gridLevels ?? 41);
  const halfWidth = Math.min(0.95, Math.max(0.01, params.gridHalfWidthPct ?? 0.2));
  const lo = params.spot * (1 - halfWidth);
  const hi = params.spot * (1 + halfWidth);

  const profile: ExposurePoint[] = [];
  for (let i = 0; i < levels; i++) {
    const s = lo + ((hi - lo) * i) / (levels - 1);
    profile.push(exposureAt(s, chain, params));
  }

  const atSpot = exposureAt(params.spot, chain, params);
  const gammaFlipPrice = findGammaFlip(profile);

  const gammaSign = atSpot.gammaExposure >= 0 ? "long" : "short";
  const gammaBehavior =
    atSpot.gammaExposure >= 0
      ? "stabilizing (dealers sell rallies / buy dips)"
      : "amplifying (dealers buy rallies / sell dips)";
  const flipNote =
    gammaFlipPrice == null
      ? "no gamma flip within ±grid"
      : `gamma flip ~${gammaFlipPrice.toFixed(2)} (${gammaFlipPrice > params.spot ? "above" : "below"} spot)`;
  const vannaNote =
    atSpot.vannaExposure >= 0
      ? "vanna+: rising IV pushes dealer delta up (buy), falling IV down (sell)"
      : "vanna−: rising IV pushes dealer delta down (sell), falling IV up (buy)";

  const interpretation =
    `Dealer ${gammaSign}-gamma at spot ${params.spot.toFixed(2)} — ${gammaBehavior}. ` +
    `${flipNote}. ${vannaNote}. ` +
    `Net charm ${atSpot.charmExposure >= 0 ? "+" : ""}${atSpot.charmExposure.toFixed(0)} $Δ/day. ` +
    `[assumes dealers ${(params.callSign ?? 1) > 0 ? "long" : "short"} calls / ` +
    `${(params.putSign ?? -1) > 0 ? "long" : "short"} puts]`;

  return { atSpot, profile, gammaFlipPrice, interpretation };
}
