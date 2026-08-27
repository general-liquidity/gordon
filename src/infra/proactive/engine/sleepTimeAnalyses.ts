/**
 * Default sleep-time analysis producers.
 *
 * These are the concrete, context-free analyses the idle precompute pass runs
 * when GORDON_SLEEP_TIME=1. Kept separate from the sleepTimeCompute core so the
 * core stays pure + fake-testable and this file owns the data-source coupling.
 *
 * Today: a market-regime snapshot for the monitored symbols — computed from
 * public Binance klines + Gordon's RegimeDetector (the same context-free path
 * the regimeFlipProducer uses, so no credentials/live context are needed).
 *
 * The runtime can register richer analyses (portfolio drawdown, top-holding
 * correlation) via `registerSleepAnalyses` once it holds a live context; those
 * need account data and are not built here.
 */

import { createModuleLogger } from "../../logger/index.ts";
import { fetchRecentCandles, resolveMonitoredSymbols } from "../producers/candleFetch.ts";
import type { SleepAnalysis } from "./sleepTimeCompute.ts";

const logger = createModuleLogger("sleep-time-analyses");

const TIMEFRAME = "1h";
const CANDLE_COUNT = 100;

interface RegimeSignal {
  regime: string;
  confidence: number;
}

async function loadRegimeDetector(): Promise<{
  detectRegime: (candles: unknown[], symbol: string, timeframe?: string) => RegimeSignal;
} | null> {
  try {
    const mod = (await import("../../../core/regime/detector.ts" as string)) as {
      RegimeDetector?: {
        getInstance: () => {
          detectRegime: (candles: unknown[], symbol: string, timeframe?: string) => RegimeSignal;
        };
      };
    };
    if (!mod.RegimeDetector || typeof mod.RegimeDetector.getInstance !== "function") return null;
    return mod.RegimeDetector.getInstance();
  } catch (err) {
    logger.debug("RegimeDetector not accessible", { err: String(err) });
    return null;
  }
}

async function computeRegimeSnapshot(): Promise<string> {
  const detector = await loadRegimeDetector();
  if (!detector) return "Regime detector unavailable.";

  const symbols = await resolveMonitoredSymbols();
  const lines = await Promise.all(
    symbols.map(async (symbol) => {
      try {
        const candles = await fetchRecentCandles(symbol, TIMEFRAME, CANDLE_COUNT);
        if (candles.length < 50) return `${symbol}: insufficient data`;
        const signal = detector.detectRegime(candles, symbol, TIMEFRAME);
        return `${symbol}: ${signal.regime} (confidence ${(signal.confidence * 100).toFixed(0)}%, ${TIMEFRAME})`;
      } catch (err) {
        logger.debug("regime snapshot failed", { symbol, err: String(err) });
        return `${symbol}: unavailable`;
      }
    }),
  );

  return `Market regime snapshot (${new Date().toISOString()}):\n${lines.join("\n")}`;
}

/**
 * Build the default analysis set. Symbol bases are folded into the regime
 * entry's keywords so a query like "what's the regime on ETH?" routes to it.
 */
export async function buildDefaultSleepAnalyses(): Promise<SleepAnalysis[]> {
  const symbols = await resolveMonitoredSymbols();
  const bases = symbols.map((s) => s.replace(/USDT$/, "").toLowerCase());

  return [
    {
      key: "regime",
      label: "Market regime snapshot",
      keywords: ["regime", "trend", "trending", "ranging", "market condition", ...bases],
      compute: computeRegimeSnapshot,
    },
  ];
}
