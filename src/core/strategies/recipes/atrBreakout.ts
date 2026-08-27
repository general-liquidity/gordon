/**
 * ATR-breakout recipe — single-indicator volatility breakout with a
 * vol-expansion filter.
 *
 * Concept (clean-room re-implementation of a canonical pattern):
 * place stop orders above + below the current bar's open at an
 * ATR-multiplier distance. The breakout fires only when short-period
 * ATR exceeds long-period ATR — confirming the market is actively
 * expanding, not sleeping. Exit stop uses a smaller ATR multiplier
 * (tighter than entry) so winners run while losers cut quickly.
 *
 * Inputs are pre-computed numerics (current bar open + ATR(short) +
 * ATR(long)) so callers can wire this onto any data source — live
 * orderbook stream, backtest engine bars, or historical replay.
 *
 * Composes with:
 *   - `riskClassifier` (verdict gates whether the entry stop actually
 *     gets placed)
 *   - `position-sizer` (Kelly + cost-aware fraction)
 *   - `portfolio-optimizer` (recipe instances across markets become
 *     a low-correlation portfolio)
 *
 * Operator-tunable per market. The post's default 2.5×/1.0× pair
 * (entry/exit) is a reasonable starting point for index futures on
 * 30-minute bars but operators should walk-forward-fit per asset.
 */

export interface AtrBreakoutInput {
  /** Current bar open price — the anchor for entry stop levels. */
  barOpen: number;
  /** Short-period ATR (e.g. ATR(5)). Used for the vol-expansion filter. */
  atrShort: number;
  /** Long-period ATR (e.g. ATR(20)). Used for entry + exit distances. */
  atrLong: number;
  /** Whether the operator is permitted to take long signals. Default true. */
  allowLong?: boolean;
  /** Whether the operator is permitted to take short signals. Default true. */
  allowShort?: boolean;
  settings?: Partial<AtrBreakoutSettings>;
}

export interface AtrBreakoutSettings {
  /** Multiplier for entry-stop distance from open. Default 2.5. */
  entryMultiplier: number;
  /** Multiplier for exit-stop distance from entry. Default 1.0 (less than entry). */
  exitMultiplier: number;
  /**
   * Ratio threshold for the vol-expansion filter — atrShort / atrLong
   * must exceed this for the recipe to fire. Default 1.0 (any
   * expansion). Operator can tighten (e.g. 1.2) to require stronger
   * expansion.
   */
  expansionRatio: number;
  /**
   * Minimum allowed ATR(long) — below this value the recipe refuses
   * to fire even with expansion (avoids breakouts on degenerate
   * near-zero vol). Default 0.
   */
  minAtrLong: number;
}

export const DEFAULT_ATR_BREAKOUT_SETTINGS: AtrBreakoutSettings = {
  entryMultiplier: 2.5,
  exitMultiplier: 1.0,
  expansionRatio: 1.0,
  minAtrLong: 0,
};

export type AtrBreakoutVerdict =
  | "armed"
  | "filtered_no_expansion"
  | "filtered_low_vol"
  | "invalid_input";

export interface AtrBreakoutLevels {
  /** Stop-buy entry price (long breakout above this level). */
  longEntryStop: number;
  /** Stop-sell entry price (short breakout below this level). */
  shortEntryStop: number;
  /** Exit-stop distance (in price units) — applied below the long entry / above the short entry. */
  exitStopDistance: number;
  /**
   * Implied stop-loss prices if the entry fills at exactly the entry
   * stop level. Caller may want to recompute these against the actual
   * fill price when the order executes.
   */
  longImpliedStopLoss: number;
  shortImpliedStopLoss: number;
}

export interface AtrBreakoutResult {
  verdict: AtrBreakoutVerdict;
  /** Effective settings after merging defaults + overrides. */
  effectiveSettings: AtrBreakoutSettings;
  /** Entry + exit levels — populated only when verdict === "armed". */
  levels: AtrBreakoutLevels | null;
  /** Computed atrShort / atrLong ratio (for operator transparency). */
  expansionRatio: number;
  /** True when long signal is permitted AND verdict is armed. */
  longActive: boolean;
  /** True when short signal is permitted AND verdict is armed. */
  shortActive: boolean;
  reason: string;
}

/**
 * Evaluate the ATR-breakout recipe at the current bar. Returns
 * structured verdict + levels (when armed) so the caller can decide
 * whether to place actual stop orders.
 */
export function evaluateAtrBreakout(input: AtrBreakoutInput): AtrBreakoutResult {
  const settings: AtrBreakoutSettings = {
    ...DEFAULT_ATR_BREAKOUT_SETTINGS,
    ...(input.settings ?? {}),
  };
  const allowLong = input.allowLong ?? true;
  const allowShort = input.allowShort ?? true;

  const validNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

  if (
    !validNumber(input.barOpen) ||
    !validNumber(input.atrShort) ||
    !validNumber(input.atrLong) ||
    input.atrLong <= 0 ||
    input.atrShort < 0
  ) {
    return {
      verdict: "invalid_input",
      effectiveSettings: settings,
      levels: null,
      expansionRatio: 0,
      longActive: false,
      shortActive: false,
      reason: "barOpen / atrShort / atrLong must all be finite and atrLong > 0",
    };
  }

  if (input.atrLong < settings.minAtrLong) {
    return {
      verdict: "filtered_low_vol",
      effectiveSettings: settings,
      levels: null,
      expansionRatio: input.atrShort / input.atrLong,
      longActive: false,
      shortActive: false,
      reason: `ATR(long) ${input.atrLong.toFixed(4)} below minAtrLong ${settings.minAtrLong}`,
    };
  }

  const ratio = input.atrShort / input.atrLong;
  if (ratio <= settings.expansionRatio) {
    return {
      verdict: "filtered_no_expansion",
      effectiveSettings: settings,
      levels: null,
      expansionRatio: ratio,
      longActive: false,
      shortActive: false,
      reason: `atrShort/atrLong ${ratio.toFixed(3)} not above expansionRatio ${settings.expansionRatio}`,
    };
  }

  const entryDist = input.atrLong * settings.entryMultiplier;
  const exitDist = input.atrLong * settings.exitMultiplier;
  const longEntry = input.barOpen + entryDist;
  const shortEntry = input.barOpen - entryDist;

  return {
    verdict: "armed",
    effectiveSettings: settings,
    levels: {
      longEntryStop: longEntry,
      shortEntryStop: shortEntry,
      exitStopDistance: exitDist,
      longImpliedStopLoss: longEntry - exitDist,
      shortImpliedStopLoss: shortEntry + exitDist,
    },
    expansionRatio: ratio,
    longActive: allowLong,
    shortActive: allowShort,
    reason:
      `armed: entry ±${entryDist.toFixed(4)} (${settings.entryMultiplier}× ATR_long), ` +
      `exit ${exitDist.toFixed(4)} (${settings.exitMultiplier}× ATR_long), ` +
      `ratio ${ratio.toFixed(3)}`,
  };
}
