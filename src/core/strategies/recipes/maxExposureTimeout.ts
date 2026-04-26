/**
 * Max-exposure-timeout recipe.
 *
 * Concept (clean-room re-implementation): mean-reversion entries can
 * fail in two ways — the move continues against you (handled by
 * stop-loss), or the price chops sideways without ever resolving
 * (handled by *time*). The latter is invisible to a P&L-only stop and
 * silently ties up capital. A wall-clock timeout — "exit after N
 * candles regardless of P&L" — caps the opportunity cost.
 *
 * State machine:
 *   - No position open  → tracks the next entry signal
 *   - Position open     → counts candles held; force-exits at maxCandles
 *
 * Force-exits emit `forceExit: true` so callers can attribute the exit
 * to the timeout rather than to a fresh signal.
 *
 * Caller owns state — pure function, state in / state out.
 */

export type ExposureSide = "long" | "short" | "none";

export interface MaxExposureState {
  /** Side of the open position, or "none" if flat. */
  side: ExposureSide;
  entryPrice: number;
  candlesHeld: number;
}

export interface MaxExposureInput {
  state: MaxExposureState;
  /** Fresh signal from upstream (regime-RSI / signal-gate / etc.). */
  externalSignal: ExposureSide;
  currentPrice: number;
  /** Max candles to hold a position regardless of P&L. */
  maxCandles: number;
}

export interface MaxExposureResult {
  /** Action the caller should take this candle. "none" = hold. */
  action: ExposureSide;
  /** True when the action was driven by the timeout, not a fresh signal. */
  forceExit: boolean;
  state: MaxExposureState;
  reason: string;
}

export function newMaxExposureState(): MaxExposureState {
  return { side: "none", entryPrice: 0, candlesHeld: 0 };
}

export function applyMaxExposure(input: MaxExposureInput): MaxExposureResult {
  const { externalSignal, currentPrice, maxCandles } = input;
  const prev = input.state;

  // Currently flat — accept any external signal as an entry.
  if (prev.side === "none") {
    if (externalSignal === "long" || externalSignal === "short") {
      return {
        action: externalSignal,
        forceExit: false,
        state: { side: externalSignal, entryPrice: currentPrice, candlesHeld: 0 },
        reason: `entered ${externalSignal} @ ${currentPrice}`,
      };
    }
    return {
      action: "none",
      forceExit: false,
      state: prev,
      reason: "flat, no signal",
    };
  }

  // Position open. Increment hold counter and check timeout.
  const candlesHeld = prev.candlesHeld + 1;

  if (candlesHeld >= maxCandles) {
    const exitSide: ExposureSide = prev.side === "long" ? "short" : "long";
    return {
      action: exitSide,
      forceExit: true,
      state: { side: "none", entryPrice: 0, candlesHeld: 0 },
      reason: `timeout after ${candlesHeld} candles (max ${maxCandles}) — force ${exitSide}`,
    };
  }

  // Honour an opposing external signal — closes the position naturally.
  if (
    (prev.side === "long" && externalSignal === "short") ||
    (prev.side === "short" && externalSignal === "long")
  ) {
    return {
      action: externalSignal,
      forceExit: false,
      state: { side: "none", entryPrice: 0, candlesHeld: 0 },
      reason: `closed ${prev.side} on opposing signal at candle ${candlesHeld}`,
    };
  }

  // Otherwise hold.
  return {
    action: "none",
    forceExit: false,
    state: { side: prev.side, entryPrice: prev.entryPrice, candlesHeld },
    reason: `holding ${prev.side} at candle ${candlesHeld}/${maxCandles}`,
  };
}
