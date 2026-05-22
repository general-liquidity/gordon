/**
 * Strategy Recipes
 *
 * A small library of clean-room signal-processing primitives extracted
 * from community trading strategies. Each recipe is a pure (state-in
 * / state-out) function so the LLM, a backtester, or a live producer
 * can compose them without owning a ton of mutable bookkeeping.
 *
 * Inspirations (concept only — implementations are original):
 *   - regimeRsi          : Tommie Hansen's regime-modulated RSI bands
 *   - bounceCounter      : A1RSI's flat-then-re-enter confirmation
 *   - signalGate         : Combination-3's signal-vs-execution split
 *   - maxExposureTimeout : Dave's wall-clock exit for mean-reversion
 *
 * The `evaluateRecipes` composer chains them in the canonical order
 * (regime-RSI → bounce-counter → signal-gate → max-exposure) so
 * callers can run a full pipeline in one call.
 */

export {
  regimeRsiSignal,
  DEFAULT_REGIME_RSI_SETTINGS,
  type RegimeRsiBands,
  type RegimeRsiInput,
  type RegimeRsiResult,
  type RegimeRsiSettings,
  type RegimeRsiSide,
} from "./regimeRsi.ts";

export {
  applyBounceCounter,
  newBounceCounterState,
  type BounceCounterInput,
  type BounceCounterResult,
  type BounceCounterState,
  type BounceSide,
  type Zone,
} from "./bounceCounter.ts";

export {
  applySignalGate,
  newSignalGateState,
  type GateSide,
  type SignalGateInput,
  type SignalGateResult,
  type SignalGateState,
} from "./signalGate.ts";

export {
  applyMaxExposure,
  newMaxExposureState,
  type ExposureSide,
  type MaxExposureInput,
  type MaxExposureResult,
  type MaxExposureState,
} from "./maxExposureTimeout.ts";

export {
  evaluateAtrBreakout,
  DEFAULT_ATR_BREAKOUT_SETTINGS,
  type AtrBreakoutInput,
  type AtrBreakoutSettings,
  type AtrBreakoutResult,
  type AtrBreakoutLevels,
  type AtrBreakoutVerdict,
} from "./atrBreakout.ts";

import type { MarketRegime } from "../../regime/types.ts";
import { regimeRsiSignal, type RegimeRsiSettings } from "./regimeRsi.ts";
import { applyBounceCounter, type BounceCounterState } from "./bounceCounter.ts";
import { applySignalGate, type SignalGateState } from "./signalGate.ts";
import { applyMaxExposure, type MaxExposureState } from "./maxExposureTimeout.ts";

export interface RecipePipelineState {
  bounceCounter: BounceCounterState;
  signalGate: SignalGateState;
  maxExposure: MaxExposureState;
}

export interface RecipePipelineInput {
  state: RecipePipelineState;
  regime: MarketRegime;
  rsi: number;
  adx: number;
  fastMa: number;
  slowMa: number;
  price: number;
  /** Settings for the regime-RSI recipe. */
  regimeRsiSettings: RegimeRsiSettings;
  /** Bounce counter persistence + required bounces. */
  bounceCounter: { persistence: number; requiredBounces: number; resetAfterFlats?: number };
  /** Max candles to hold a mean-reversion position. */
  maxExposureCandles: number;
}

export interface RecipePipelineResult {
  /** Final action — what the caller should actually trade. "none" = hold. */
  action: "long" | "short" | "none";
  /** True when the action was a forced timeout exit. */
  forceExit: boolean;
  /** Per-stage diagnostic — useful for the LLM to narrate decisions. */
  trace: {
    regimeRsi: ReturnType<typeof regimeRsiSignal>;
    bounceCounter: { input: "long" | "short" | "none"; gated: "long" | "short" | "none" };
    signalGate: { execute: "long" | "short" | "none"; status: string };
    maxExposure: { action: "long" | "short" | "none"; reason: string };
  };
  state: RecipePipelineState;
}

/**
 * Run the four recipes end-to-end.
 *
 * Order:
 *   1. regimeRsiSignal      → raw direction from regime-modulated bands
 *   2. applyBounceCounter   → require N zone re-entries (filters chop)
 *   3. applySignalGate      → wait for fastMA confirmation
 *   4. applyMaxExposure     → enforce wall-clock exit
 */
export function evaluateRecipes(input: RecipePipelineInput): RecipePipelineResult {
  // 1. Regime-modulated raw signal.
  const regimeRsi = regimeRsiSignal({
    regime: input.regime,
    rsi: input.rsi,
    adx: input.adx,
    settings: input.regimeRsiSettings,
  });

  // 2. Bounce counter — confirms the signal by requiring N re-entries.
  const bounce = applyBounceCounter({
    state: input.state.bounceCounter,
    rsi: input.rsi,
    high: regimeRsi.effectiveHigh,
    low: regimeRsi.effectiveLow,
    persistence: input.bounceCounter.persistence,
    requiredBounces: input.bounceCounter.requiredBounces,
    resetAfterFlats: input.bounceCounter.resetAfterFlats,
  });
  const bounceSignal = bounce.signal; // "long" | "short" | "none"

  // 3. Signal gate — wait for MA confirmation.
  const gate = applySignalGate({
    state: input.state.signalGate,
    rawSignal: bounceSignal,
    fastMa: input.fastMa,
    slowMa: input.slowMa,
    price: input.price,
  });

  // 4. Max-exposure timeout — wall-clock exit if a position is open.
  const exposure = applyMaxExposure({
    state: input.state.maxExposure,
    externalSignal: gate.execute,
    currentPrice: input.price,
    maxCandles: input.maxExposureCandles,
  });

  return {
    action: exposure.action,
    forceExit: exposure.forceExit,
    trace: {
      regimeRsi,
      bounceCounter: { input: regimeRsi.signal, gated: bounceSignal },
      signalGate: { execute: gate.execute, status: gate.status },
      maxExposure: { action: exposure.action, reason: exposure.reason },
    },
    state: {
      bounceCounter: bounce.state,
      signalGate: gate.state,
      maxExposure: exposure.state,
    },
  };
}

import { newBounceCounterState } from "./bounceCounter.ts";
import { newSignalGateState } from "./signalGate.ts";
import { newMaxExposureState } from "./maxExposureTimeout.ts";

export function newRecipePipelineState(): RecipePipelineState {
  return {
    bounceCounter: newBounceCounterState(),
    signalGate: newSignalGateState(),
    maxExposure: newMaxExposureState(),
  };
}
