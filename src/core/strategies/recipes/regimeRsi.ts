/**
 * Regime-modulated RSI recipe.
 *
 * Concept (clean-room re-implementation): the same RSI reading carries
 * different information in a trending market vs a ranging market. In a
 * confirmed bull, mean-reverting RSI<low is a buy; in a confirmed bear,
 * RSI<low is a falling-knife trap and RSI>high is a continuation short.
 * ADX strength further widens or compresses the bands — when trend is
 * strong, the indicator's "extreme" zones should sit further from the
 * midline.
 *
 * Maps Gordon's MarketRegime taxonomy to bull / bear / idle bands so
 * this recipe slots directly behind detect_market_regime without the
 * caller needing to translate.
 */
import type { MarketRegime } from "../../regime/types.ts";

export type RegimeRsiSide = "long" | "short" | "none";

export interface RegimeRsiBands {
  /** RSI level above which we go short. */
  rsiHigh: number;
  /** RSI level below which we go long. */
  rsiLow: number;
  /** Amount to add to rsiHigh when ADX > settings.adx.high. */
  modHigh: number;
  /** Amount to subtract from rsiLow when ADX < settings.adx.low. */
  modLow: number;
}

export interface RegimeRsiSettings {
  bull: RegimeRsiBands;
  bear: RegimeRsiBands;
  /** Optional: separate bands for ranging / quiet / breakout. Falls
   *  back to bull settings if unset. */
  idle?: RegimeRsiBands;
  adx: { high: number; low: number };
}

export interface RegimeRsiInput {
  regime: MarketRegime;
  rsi: number;
  adx: number;
  settings: RegimeRsiSettings;
}

export interface RegimeRsiResult {
  signal: RegimeRsiSide;
  /** Which band-set was applied. */
  appliedBucket: "bull" | "bear" | "idle";
  /** Effective bands after ADX modulation. */
  effectiveHigh: number;
  effectiveLow: number;
  reason: string;
}

export const DEFAULT_REGIME_RSI_SETTINGS: RegimeRsiSettings = {
  // Bull market: be slow to short into strength, eager to buy dips.
  bull: { rsiHigh: 75, rsiLow: 35, modHigh: 5, modLow: -5 },
  // Bear market: eager to short rallies, slow to catch knives.
  bear: { rsiHigh: 60, rsiLow: 25, modHigh: 5, modLow: -5 },
  // Ranging / idle: tight symmetric bands.
  idle: { rsiHigh: 70, rsiLow: 30, modHigh: 3, modLow: -3 },
  adx: { high: 30, low: 15 },
};

function regimeToBucket(regime: MarketRegime): "bull" | "bear" | "idle" {
  switch (regime) {
    case "trending_up":
    case "breakout":
      return "bull";
    case "trending_down":
    case "volatile":
      return "bear";
    case "ranging":
    case "quiet":
      return "idle";
  }
}

export function regimeRsiSignal(input: RegimeRsiInput): RegimeRsiResult {
  const { regime, rsi, adx, settings } = input;
  const bucket = regimeToBucket(regime);
  const bands =
    bucket === "bull"
      ? settings.bull
      : bucket === "bear"
        ? settings.bear
        : (settings.idle ?? settings.bull);

  let effectiveHigh = bands.rsiHigh;
  let effectiveLow = bands.rsiLow;

  // ADX modulation: strong trend pushes the OB threshold higher
  // (don't fade strength); weak trend pulls the OS threshold lower
  // (don't catch a slow bleed).
  if (adx > settings.adx.high) effectiveHigh += bands.modHigh;
  else if (adx < settings.adx.low) effectiveLow += bands.modLow;

  let signal: RegimeRsiSide = "none";
  let reason = `regime=${regime} bucket=${bucket} rsi=${rsi.toFixed(1)} adx=${adx.toFixed(1)} band=[${effectiveLow.toFixed(1)},${effectiveHigh.toFixed(1)}]`;
  if (rsi > effectiveHigh) {
    signal = "short";
    reason += ` → short (rsi above effectiveHigh)`;
  } else if (rsi < effectiveLow) {
    signal = "long";
    reason += ` → long (rsi below effectiveLow)`;
  } else {
    reason += " → none";
  }

  return { signal, appliedBucket: bucket, effectiveHigh, effectiveLow, reason };
}
