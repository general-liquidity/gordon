/**
 * Volatility Spike Producer
 *
 * Periodic producer that computes ATR(14) for monitored symbols and fires
 * a `volatility_spike` candidate when current ATR exceeds 1.5x its recent
 * rolling average. A volatility expansion often means stops are at risk
 * and position sizing should be reconsidered — worth surfacing proactively.
 *
 * Uses Gordon's core ATR calculation (`src/core/indicators/atr.ts`) via
 * dynamic import so the producer degrades gracefully if the path moves.
 * Candles come from the shared Binance public fetcher.
 *
 * State: rolling baseline ATR per symbol (last 10 measurements). Fires at
 * most once per spike transition — the symbol must come back below 1.2x
 * before a new spike can fire.
 */

import type { CandidateProducer } from "../engine/proactiveEngine.ts";
import { buildCandidate } from "../engine/proactiveEngine.ts";
import type { ProactiveSuggestion } from "../types.ts";
import { createModuleLogger } from "../../logger/index.ts";
import { fetchRecentCandles, resolveMonitoredSymbols } from "./candleFetch.ts";

const logger = createModuleLogger("volatility-spike-producer");

const TIMEFRAME = "1h";
const CANDLE_COUNT = 50;
const BASELINE_LENGTH = 10;
const SPIKE_RATIO = 1.5; // current > 1.5x baseline → spike
const RESET_RATIO = 1.2; // must fall below 1.2x before next spike can fire

interface VolatilityState {
  baseline: number[]; // rolling ATR readings
  inSpike: boolean;
}

const stateBySymbol = new Map<string, VolatilityState>();

type ATRResult = {
  values: (number | null)[];
  current: number | null;
  period: number;
};

async function loadAtrCalculator(): Promise<
  | ((candles: unknown[], period?: number) => ATRResult)
  | null
> {
  try {
    const mod = (await import("../../../core/indicators/atr.ts" as string)) as {
      calculateATR?: (candles: unknown[], period?: number) => ATRResult;
    };
    if (typeof mod.calculateATR !== "function") return null;
    return mod.calculateATR;
  } catch (err) {
    logger.debug("calculateATR not accessible", { err: String(err) });
    return null;
  }
}

export const volatilitySpikeProducer: CandidateProducer = async (obs): Promise<ProactiveSuggestion[]> => {
  if (obs.source !== "monitor_loop" || obs.eventType !== "tick_volatility") return [];

  const calculateATR = await loadAtrCalculator();
  if (!calculateATR) return [];

  const symbols = await resolveMonitoredSymbols();
  const candidates: ProactiveSuggestion[] = [];

  const results = await Promise.allSettled(
    symbols.map(async (symbol) => {
      const candles = await fetchRecentCandles(symbol, TIMEFRAME, CANDLE_COUNT);
      if (candles.length < 20) return null;

      let atr: number | null = null;
      try {
        const result = calculateATR(candles, 14);
        atr = result.current;
      } catch (err) {
        logger.debug("calculateATR threw", { symbol, err: String(err) });
        return null;
      }
      if (atr === null || !Number.isFinite(atr) || atr <= 0) return null;

      const state: VolatilityState = stateBySymbol.get(symbol) ?? { baseline: [], inSpike: false };

      // Not enough baseline yet — accumulate
      if (state.baseline.length < BASELINE_LENGTH) {
        state.baseline.push(atr);
        stateBySymbol.set(symbol, state);
        return null;
      }

      const avgBaseline = state.baseline.reduce((a, b) => a + b, 0) / state.baseline.length;
      const ratio = atr / avgBaseline;

      // Update baseline with a rolling window
      state.baseline.push(atr);
      if (state.baseline.length > BASELINE_LENGTH) state.baseline.shift();

      // Spike detection with hysteresis
      if (state.inSpike && ratio < RESET_RATIO) {
        state.inSpike = false;
        stateBySymbol.set(symbol, state);
        return null;
      }
      if (!state.inSpike && ratio >= SPIKE_RATIO) {
        state.inSpike = true;
        stateBySymbol.set(symbol, state);
        return { symbol, atr, avgBaseline, ratio };
      }

      stateBySymbol.set(symbol, state);
      return null;
    }),
  );

  for (const result of results) {
    if (result.status !== "fulfilled" || !result.value) continue;
    const { symbol, atr, avgBaseline, ratio } = result.value;
    const baseSymbol = symbol.replace(/USDT$/, "");

    candidates.push(
      buildCandidate(
        "volatility_spike",
        `${baseSymbol} volatility spike: ATR ${ratio.toFixed(1)}x baseline`,
        `${baseSymbol} ATR on the ${TIMEFRAME} chart just expanded to ${ratio.toFixed(2)}x its recent ` +
          `rolling average (${atr.toFixed(2)} vs ${avgBaseline.toFixed(2)}). ` +
          `Spikes like this often precede stop runs and nuke tight risk. If you're holding ${baseSymbol}, ` +
          `consider widening stops, reducing size, or stepping aside until it calms down.`,
        {
          confidence: Math.min(0.9, 0.65 + Math.min(ratio - SPIKE_RATIO, 0.5) * 0.4),
          action: `Review position sizing or tighten exit plan`,
          triggers: {
            source: "monitor_loop",
            eventType: "tick_volatility",
            symbol,
            metadata: {
              currentAtr: atr,
              baselineAtr: avgBaseline,
              ratio,
              timeframe: TIMEFRAME,
            },
          },
          operation: {
            tool: "get_technical_analysis",
            args: { symbol: baseSymbol, timeframe: TIMEFRAME },
            readOnly: true,
            description: `Pull full technical read on ${baseSymbol}`,
          },
        },
      ),
    );
  }

  return candidates;
};

/** Reset state. Called on producer unregister. */
export function resetVolatilitySpikeProducerState(): void {
  stateBySymbol.clear();
}
