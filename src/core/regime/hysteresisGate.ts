/**
 * Regime dwell-time hysteresis gate (A5, GORDON_REGIME_HYSTERESIS).
 *
 * The 6-class classifier re-classifies independently on every call, so a single
 * boundary bar that flickers `ranging -> volatile -> ranging` flips the active
 * strategy twice for no real regime change. This gate adds dwell-time
 * hysteresis: a newly-detected regime must PERSIST (>= N consecutive detections
 * or >= T ms) before consumers accept the shift. Until confirmed, the prior
 * accepted regime holds and the flicker is absorbed.
 *
 * Pure state machine ({@link applyHysteresis}) plus a thin per-key holder
 * ({@link RegimeHysteresisGate}). It NEVER changes the classifier — it is an
 * opt-in filter over the detector's output.
 */

import type { MarketRegime } from "./types.ts";

export interface HysteresisConfig {
  /** Consecutive detections of a NEW regime required before accepting it. Default 3. */
  confirmBars?: number;
  /**
   * Alternative dwell time (ms) the new regime must persist before acceptance.
   * When > 0, EITHER the bar count OR the elapsed time confirms the shift.
   * Default 0 (time gate disabled; bar count only).
   */
  confirmMs?: number;
}

export interface HysteresisState {
  /** The currently accepted (stable) regime. null until the first detection. */
  acceptedRegime: MarketRegime | null;
  /** The candidate regime accumulating toward confirmation (differs from accepted). */
  pendingRegime: MarketRegime | null;
  /** Consecutive detections of pendingRegime so far. */
  pendingCount: number;
  /** Timestamp (ms) of the first pending detection, for the time gate. */
  pendingSinceMs: number | null;
}

export interface HysteresisResult {
  /** The regime consumers should act on. Holds the prior on an unconfirmed flicker. */
  regime: MarketRegime;
  /** True when this detection flipped the accepted regime. */
  shifted: boolean;
  /** True when a new regime is pending confirmation (accepted still held). */
  pending: boolean;
  /** Consecutive detections of the pending regime so far. */
  pendingCount: number;
  /** The next state (input is not mutated). */
  state: HysteresisState;
}

const DEFAULT_CONFIRM_BARS = 3;

export function createHysteresisState(): HysteresisState {
  return { acceptedRegime: null, pendingRegime: null, pendingCount: 0, pendingSinceMs: null };
}

/**
 * Apply one detection through the hysteresis gate. Pure: returns a new state and
 * the regime consumers should act on. The very first detection is accepted
 * immediately (there is no prior to hold).
 */
export function applyHysteresis(
  state: HysteresisState,
  detected: MarketRegime,
  config: HysteresisConfig = {},
  nowMs: number = Date.now(),
): HysteresisResult {
  const confirmBars = Math.max(1, Math.trunc(config.confirmBars ?? DEFAULT_CONFIRM_BARS));
  const confirmMs = config.confirmMs ?? 0;

  // First-ever detection: nothing to hold, accept immediately.
  if (state.acceptedRegime === null) {
    return {
      regime: detected,
      shifted: true,
      pending: false,
      pendingCount: 0,
      state: { acceptedRegime: detected, pendingRegime: null, pendingCount: 0, pendingSinceMs: null },
    };
  }

  // Detection matches the accepted regime: any pending candidate is a flicker
  // that failed to sustain — clear it and hold.
  if (detected === state.acceptedRegime) {
    return {
      regime: state.acceptedRegime,
      shifted: false,
      pending: false,
      pendingCount: 0,
      state: { ...state, pendingRegime: null, pendingCount: 0, pendingSinceMs: null },
    };
  }

  // A regime different from accepted: accumulate it toward confirmation.
  const continuing = state.pendingRegime === detected;
  const pendingCount = continuing ? state.pendingCount + 1 : 1;
  const pendingSinceMs = continuing ? (state.pendingSinceMs ?? nowMs) : nowMs;

  const barsMet = pendingCount >= confirmBars;
  const timeMet = confirmMs > 0 && nowMs - pendingSinceMs >= confirmMs;

  if (barsMet || timeMet) {
    return {
      regime: detected,
      shifted: true,
      pending: false,
      pendingCount,
      state: { acceptedRegime: detected, pendingRegime: null, pendingCount: 0, pendingSinceMs: null },
    };
  }

  // Not yet confirmed: hold the prior accepted regime.
  return {
    regime: state.acceptedRegime,
    shifted: false,
    pending: true,
    pendingCount,
    state: { ...state, pendingRegime: detected, pendingCount, pendingSinceMs },
  };
}

/**
 * Thin per-key holder over {@link applyHysteresis}. Key is typically
 * `${symbol}:${timeframe}`.
 */
export class RegimeHysteresisGate {
  private states = new Map<string, HysteresisState>();

  constructor(private readonly config: HysteresisConfig = {}) {}

  accept(key: string, detected: MarketRegime, nowMs?: number): HysteresisResult {
    const state = this.states.get(key) ?? createHysteresisState();
    const result = applyHysteresis(state, detected, this.config, nowMs);
    this.states.set(key, result.state);
    return result;
  }

  /** The currently accepted regime for a key, or null if none yet. */
  current(key: string): MarketRegime | null {
    return this.states.get(key)?.acceptedRegime ?? null;
  }

  reset(key?: string): void {
    if (key) this.states.delete(key);
    else this.states.clear();
  }
}

export const REGIME_HYSTERESIS_FLAG_ENV = "GORDON_REGIME_HYSTERESIS";
export const REGIME_HYSTERESIS_BARS_ENV = "GORDON_REGIME_HYSTERESIS_BARS";
export const REGIME_HYSTERESIS_MINUTES_ENV = "GORDON_REGIME_HYSTERESIS_MINUTES";

export function isRegimeHysteresisEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[REGIME_HYSTERESIS_FLAG_ENV] === "1" || env[REGIME_HYSTERESIS_FLAG_ENV] === "true";
}

/** Read hysteresis config from env: bar count and optional dwell minutes. */
export function regimeHysteresisConfigFromEnv(env: NodeJS.ProcessEnv = process.env): HysteresisConfig {
  const config: HysteresisConfig = {};
  const bars = Number(env[REGIME_HYSTERESIS_BARS_ENV]);
  if (Number.isFinite(bars) && bars >= 1) config.confirmBars = Math.trunc(bars);
  const minutes = Number(env[REGIME_HYSTERESIS_MINUTES_ENV]);
  if (Number.isFinite(minutes) && minutes > 0) config.confirmMs = minutes * 60 * 1000;
  return config;
}
