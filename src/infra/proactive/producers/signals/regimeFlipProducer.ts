/**
 * Regime Flip Producer
 *
 * Periodic producer that polls Gordon's RegimeDetector for a configurable set
 * of symbols and fires a `regime_flip` candidate when a symbol transitions
 * between regimes (e.g. ranging → trending_up, quiet → volatile).
 *
 * Symbol set: monitored symbols from resolveMonitoredSymbols() — defaults to
 * BTCUSDT/ETHUSDT/SOLUSDT if no positions. Candles pulled from Binance public
 * klines (no auth). Regime detector is called synchronously with the candles.
 *
 * State: tracks last-seen regime per symbol across ticks so we only fire on
 * actual transitions, not on every tick that happens to classify the same
 * regime again.
 */

import type { CandidateProducer } from "../../engine/proactiveEngine.ts";
import { buildCandidate } from "../../engine/proactiveEngine.ts";
import type { ProactiveSuggestion } from "../../types.ts";
import { createModuleLogger } from "../../../logger/index.ts";
import { fetchRecentCandles, resolveMonitoredSymbols } from "../candleFetch.ts";

const logger = createModuleLogger("regime-flip-producer");

const TIMEFRAME = "1h";
const CANDLE_COUNT = 100; // Enough history for regime detector's ADX/ATR/MACD

// Last-seen regime per symbol. Cleared on engine stop via reset helper.
const lastRegimeBySymbol = new Map<string, string>();

type RegimeSignal = {
  regime: string;
  confidence: number;
  symbol: string;
  timeframe: string;
  metrics?: Record<string, number>;
};

interface RegimeDetectorClass {
  new (...args: unknown[]): unknown;
  getInstance: () => {
    detectRegime: (candles: unknown[], symbol: string, timeframe?: string) => RegimeSignal;
  };
}

async function loadRegimeDetector(): Promise<{
  detectRegime: (candles: unknown[], symbol: string, timeframe?: string) => RegimeSignal;
} | null> {
  try {
    const mod = (await import("../../../../core/regime/detector.ts" as string)) as {
      RegimeDetector?: RegimeDetectorClass;
    };
    if (!mod.RegimeDetector || typeof mod.RegimeDetector.getInstance !== "function") return null;
    return mod.RegimeDetector.getInstance();
  } catch (err) {
    logger.debug("RegimeDetector not accessible", { err: String(err) });
    return null;
  }
}

export const regimeFlipProducer: CandidateProducer = async (
  obs,
): Promise<ProactiveSuggestion[]> => {
  if (obs.source !== "monitor_loop" || obs.eventType !== "tick_regime_flip") return [];

  const detector = await loadRegimeDetector();
  if (!detector) return [];

  const symbols = await resolveMonitoredSymbols();
  const candidates: ProactiveSuggestion[] = [];

  // Process symbols in parallel — each is a candle fetch + regime compute
  const results = await Promise.allSettled(
    symbols.map(async (symbol) => {
      const candles = await fetchRecentCandles(symbol, TIMEFRAME, CANDLE_COUNT);
      if (candles.length < 50) return null;

      let signal: RegimeSignal;
      try {
        signal = detector.detectRegime(candles, symbol, TIMEFRAME);
      } catch (err) {
        logger.debug("detectRegime threw", { symbol, err: String(err) });
        return null;
      }

      const prev = lastRegimeBySymbol.get(symbol);
      lastRegimeBySymbol.set(symbol, signal.regime);

      // Only fire on an actual transition AND when confidence is meaningful
      if (!prev || prev === signal.regime || signal.confidence < 0.6) {
        return null;
      }

      return { symbol, prev, signal };
    }),
  );

  for (const result of results) {
    if (result.status !== "fulfilled" || !result.value) continue;
    const { symbol, prev, signal } = result.value;
    const baseSymbol = symbol.replace(/USDT$/, "");

    candidates.push(
      buildCandidate(
        "regime_flip",
        `${baseSymbol} regime flipped: ${prev} → ${signal.regime}`,
        `Gordon's regime detector just flagged ${baseSymbol} transitioning from ${prev} to ${signal.regime} ` +
          `on the ${TIMEFRAME} timeframe (confidence ${(signal.confidence * 100).toFixed(0)}%). ` +
          `Different regimes favor different playbooks — ${regimeAdvice(signal.regime)}. ` +
          `If you're running a playbook on ${baseSymbol}, consider whether it still fits the new regime.`,
        {
          confidence: Math.min(0.9, 0.65 + signal.confidence * 0.25),
          action: `Run detect_market_regime for latest read or switch playbook`,
          triggers: {
            source: "monitor_loop",
            eventType: "tick_regime_flip",
            symbol,
            metadata: {
              previousRegime: prev,
              currentRegime: signal.regime,
              regimeConfidence: signal.confidence,
              metrics: signal.metrics,
            },
          },
          operation: {
            tool: "detect_market_regime",
            args: { symbol: baseSymbol, timeframe: TIMEFRAME },
            readOnly: true,
            description: `Confirm regime classification for ${baseSymbol}`,
          },
        },
      ),
    );
  }

  return candidates;
};

function regimeAdvice(regime: string): string {
  switch (regime) {
    case "trending_up":
      return "momentum / breakout playbooks tend to work in uptrends";
    case "trending_down":
      return "short-side momentum or cash is usually safest";
    case "ranging":
      return "mean-reversion and fade-the-edges setups work best";
    case "volatile":
      return "reduce size, widen stops, or step aside";
    case "quiet":
      return "compression can precede a breakout — watch for volume";
    case "breakout":
      return "expect continuation or failure within 1-3 candles";
    default:
      return "reassess your positioning";
  }
}

/** Reset the last-seen regime map. Called on producer unregister. */
export function resetRegimeFlipProducerState(): void {
  lastRegimeBySymbol.clear();
}
