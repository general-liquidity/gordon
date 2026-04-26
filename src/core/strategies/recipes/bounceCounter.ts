/**
 * Bounce-counter recipe.
 *
 * Concept (clean-room re-implementation): a single touch of an RSI
 * extreme is a noisy signal — the same level is often visited
 * repeatedly during a slow grind before the actual reversal. By
 * counting how many times RSI has *re-entered* the OB / OS zone after
 * leaving it, we can require a confirmed pattern before firing.
 *
 * State machine:
 *   - "high"     : rsi above OB threshold
 *   - "low"      : rsi below OS threshold
 *   - "neutral"  : rsi between thresholds — increments flat counter
 *   - on transition neutral → high or neutral → low, increment bounce
 *
 * Fires when both:
 *   - duration in the current zone ≥ persistence
 *   - bounces ≥ requiredBounces
 *
 * Caller owns state — this function is pure (state in, state out).
 */

export type Zone = "high" | "low" | "neutral";
export type BounceSide = "long" | "short" | "none";

export interface BounceCounterState {
  zone: Zone;
  /** Candles spent in the current zone (after a transition). */
  duration: number;
  /** Number of times rsi has re-entered an extreme zone after a flat
   *  break. Reset by `resetAfterFlats` consecutive neutral candles. */
  bounces: number;
  /** Set true when zone leaves an extreme — armed to count next entry. */
  willBounce: boolean;
  /** Consecutive candles in neutral. */
  flats: number;
  /** Set true when persisted+bounces conditions are met and we've fired
   *  this zone — clears on next zone change to avoid re-firing. */
  fired: boolean;
}

export interface BounceCounterInput {
  state: BounceCounterState;
  rsi: number;
  high: number;
  low: number;
  /** Candles required in zone before we consider it persisted. */
  persistence: number;
  /** Bounces required before we'll fire on a persisted zone. */
  requiredBounces: number;
  /** Reset bounces after this many consecutive neutral candles. Default 50. */
  resetAfterFlats?: number;
}

export interface BounceCounterResult {
  signal: BounceSide;
  state: BounceCounterState;
}

export function newBounceCounterState(): BounceCounterState {
  return { zone: "neutral", duration: 0, bounces: 0, willBounce: false, flats: 0, fired: false };
}

export function applyBounceCounter(input: BounceCounterInput): BounceCounterResult {
  const { rsi, high, low, persistence, requiredBounces } = input;
  const resetAfterFlats = input.resetAfterFlats ?? 50;
  const prev = input.state;

  const newZone: Zone = rsi > high ? "high" : rsi < low ? "low" : "neutral";

  // Mutable working copy
  const next: BounceCounterState = { ...prev };

  if (newZone !== prev.zone) {
    // Transitioned. Determine if this is an *entry* into an extreme
    // (which counts a bounce when we were armed) or *exit* (which arms
    // the counter for the next entry).
    if (newZone === "neutral") {
      // Leaving an extreme — arm the counter for the next entry.
      next.willBounce = true;
    } else {
      // Entering an extreme.
      if (prev.willBounce) {
        next.bounces = prev.bounces + 1;
        next.willBounce = false;
      }
    }
    next.zone = newZone;
    next.duration = 1;
    next.fired = false; // new zone, allow firing again
    next.flats = newZone === "neutral" ? prev.flats + 1 : 0;
  } else {
    next.duration = prev.duration + 1;
    if (newZone === "neutral") {
      next.flats = prev.flats + 1;
      if (next.flats >= resetAfterFlats) {
        next.bounces = 0;
        next.flats = 0;
        next.willBounce = false;
      }
    } else {
      next.flats = 0;
    }
  }

  let signal: BounceSide = "none";
  if (
    !next.fired &&
    next.zone !== "neutral" &&
    next.duration >= persistence &&
    next.bounces >= requiredBounces
  ) {
    signal = next.zone === "high" ? "short" : "long";
    next.fired = true;
  }

  return { signal, state: next };
}
