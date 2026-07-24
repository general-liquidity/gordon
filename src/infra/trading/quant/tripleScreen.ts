/**
 * Elder's Triple Screen Composition (GORDON_TRIPLE_SCREEN).
 *
 * Multi-timeframe framework from TSaM Ch 19. Three lenses on the same
 * instrument with progressively shorter horizons, each enforcing a
 * different gate:
 *
 *   Screen 1 (low frequency)   — major-trend filter. Trade only with
 *                                  the long-frame direction.
 *   Screen 2 (mid frequency)   — oscillator gate. Wait for a counter-
 *                                  trend pullback in the middle frame
 *                                  before entering.
 *   Screen 3 (high frequency)  — entry trigger. Fire when the short
 *                                  frame breaks out in the direction
 *                                  of Screen 1.
 *
 * Elder advocates ~5× frame ratios (e.g. weekly / daily / hourly).
 * This module is a composition primitive — the caller supplies the
 * three per-frame signals; the gate returns a verdict.
 */

export type TrendDirection = "up" | "down" | "flat";
export type OscillatorState = "overbought" | "oversold" | "neutral";
export type EntryTrigger = "buy" | "sell" | "none";
export type TripleScreenVerdict = "long_entry" | "short_entry" | "wait" | "no_trade";

export interface TripleScreenInput {
  /** Screen 1 — long-frame trend direction (e.g. weekly MACD slope). */
  majorTrend: TrendDirection;
  /** Screen 2 — middle-frame oscillator state (e.g. Elder-Ray, Force Index, stochastic). */
  oscillator: OscillatorState;
  /** Screen 3 — short-frame entry trigger (e.g. intraday breakout). */
  entryTrigger: EntryTrigger;
}

export interface TripleScreenResult {
  verdict: TripleScreenVerdict;
  blockedBy: "trend" | "oscillator" | "trigger" | null;
  reasoning: string;
}

export function evaluateTripleScreen(input: TripleScreenInput): TripleScreenResult {
  const { majorTrend, oscillator, entryTrigger } = input;

  if (majorTrend === "flat") {
    return {
      verdict: "no_trade",
      blockedBy: "trend",
      reasoning: "Screen 1 — major trend flat; sit out",
    };
  }

  // Long path: trend up → wait for oversold → fire on buy trigger.
  if (majorTrend === "up") {
    if (oscillator === "overbought") {
      return {
        verdict: "no_trade",
        blockedBy: "oscillator",
        reasoning: "Screen 2 — oscillator overbought against the up-trend; refuse late buys",
      };
    }
    if (oscillator !== "oversold") {
      return {
        verdict: "wait",
        blockedBy: "oscillator",
        reasoning: "Screen 2 — oscillator neutral; wait for the pullback in the up-trend",
      };
    }
    if (entryTrigger !== "buy") {
      return {
        verdict: "wait",
        blockedBy: "trigger",
        reasoning: "Screen 3 — oversold pullback in place but no buy trigger yet",
      };
    }
    return {
      verdict: "long_entry",
      blockedBy: null,
      reasoning: "All three screens align: up-trend × oversold pullback × buy trigger",
    };
  }

  // Short path: trend down → wait for overbought → fire on sell trigger.
  if (oscillator === "oversold") {
    return {
      verdict: "no_trade",
      blockedBy: "oscillator",
      reasoning: "Screen 2 — oscillator oversold against the down-trend; refuse late shorts",
    };
  }
  if (oscillator !== "overbought") {
    return {
      verdict: "wait",
      blockedBy: "oscillator",
      reasoning: "Screen 2 — oscillator neutral; wait for the rally in the down-trend",
    };
  }
  if (entryTrigger !== "sell") {
    return {
      verdict: "wait",
      blockedBy: "trigger",
      reasoning: "Screen 3 — overbought rally in place but no sell trigger yet",
    };
  }
  return {
    verdict: "short_entry",
    blockedBy: null,
    reasoning: "All three screens align: down-trend × overbought rally × sell trigger",
  };
}

export function tripleScreenToPayload(result: TripleScreenResult): Record<string, unknown> {
  return {
    kind: "triple_screen.evaluated",
    verdict: result.verdict,
    blockedBy: result.blockedBy,
  };
}
