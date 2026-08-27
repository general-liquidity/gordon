/**
 * Playbook Suggest Producer
 *
 * Periodic producer that polls the regime detector per monitored symbol and
 * surfaces a `playbook_suggest` candidate when the current regime maps to a
 * built-in trading playbook the operator hasn't been nudged toward recently.
 */

import type { CandidateProducer } from "../../engine/proactiveEngine.ts";
import { buildCandidate } from "../../engine/proactiveEngine.ts";
import type { ProactiveSuggestion } from "../../types.ts";
import { createModuleLogger } from "../../../logger/index.ts";
import { fetchRecentCandles, resolveMonitoredSymbols } from "../candleFetch.ts";
import { playbookRegistry } from "../../../../core/playbooks/registry.ts";
import { PlaybookLoader } from "../../../../core/playbooks/loader.ts";
import { PlaybookParser } from "../../../../core/playbooks/parser.ts";
import type { Playbook } from "../../../../core/playbooks/types.ts";

const logger = createModuleLogger("playbook-suggest-producer");

const TIMEFRAME = "1h";
const CANDLE_COUNT = 100;
const MIN_REGIME_CONFIDENCE = 0.65;

type RegimeSignal = {
  regime: string;
  confidence: number;
  symbol: string;
  timeframe: string;
};

interface RegimeDetectorClass {
  new (...args: unknown[]): unknown;
  getInstance: () => {
    detectRegime: (candles: unknown[], symbol: string, timeframe?: string) => RegimeSignal;
  };
}

const lastSuggestedKey = new Map<string, string>();
let playbooksLoaded = false;

async function ensurePlaybooksLoaded(): Promise<void> {
  if (playbooksLoaded && playbookRegistry.getAll().length > 0) return;
  try {
    const loader = new PlaybookLoader(new PlaybookParser(), playbookRegistry);
    await loader.loadBuiltins();
    playbooksLoaded = true;
  } catch (err) {
    logger.debug("Failed to load built-in playbooks", { err: String(err) });
  }
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

function regimeToSearchQuery(regime: string): string {
  switch (regime) {
    case "trending_up":
      return "momentum trend";
    case "trending_down":
      return "bear short";
    case "ranging":
      return "mean reversion range";
    case "volatile":
      return "volatile risk";
    case "quiet":
      return "breakout compression";
    case "breakout":
      return "breakout momentum volume";
    default:
      return regime.replace(/_/g, " ");
  }
}

function pickPlaybook(symbol: string, regime: string): Playbook | null {
  const base = symbol.replace(/(USDT|USDC|USD)$/i, "");
  const query = regimeToSearchQuery(regime);
  const matches = playbookRegistry.search(query);
  if (matches.length === 0) return null;

  const cryptoMatches = matches.filter((pb) =>
    pb.markets.some((m) => m.toLowerCase() === "crypto"),
  );
  const pool = cryptoMatches.length > 0 ? cryptoMatches : matches;

  const symbolScoped = pool.filter((pb) => {
    if (!pb.symbols || pb.symbols.length === 0) return true;
    return pb.symbols.some((s) => s.toUpperCase().includes(base.toUpperCase()));
  });

  return symbolScoped[0] ?? pool[0] ?? null;
}

export const playbookSuggestProducer: CandidateProducer = async (
  obs,
): Promise<ProactiveSuggestion[]> => {
  if (obs.source !== "monitor_loop" || obs.eventType !== "tick_playbook_suggest") return [];

  await ensurePlaybooksLoaded();
  const detector = await loadRegimeDetector();
  if (!detector || playbookRegistry.getAll().length === 0) return [];

  const symbols = await resolveMonitoredSymbols();
  const candidates: ProactiveSuggestion[] = [];

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

      if (signal.confidence < MIN_REGIME_CONFIDENCE) return null;

      const playbook = pickPlaybook(symbol, signal.regime);
      if (!playbook) return null;

      const dedupeKey = `${symbol}:${playbook.id}`;
      const prev = lastSuggestedKey.get(symbol);
      if (prev === dedupeKey) return null;
      lastSuggestedKey.set(symbol, dedupeKey);

      return { symbol, signal, playbook };
    }),
  );

  for (const result of results) {
    if (result.status !== "fulfilled" || !result.value) continue;
    const { symbol, signal, playbook } = result.value;
    const baseSymbol = symbol.replace(/USDT$/, "");

    candidates.push(
      buildCandidate(
        "playbook_suggest",
        `${baseSymbol} in ${signal.regime} — try ${playbook.name}`,
        `Regime on ${baseSymbol} (${TIMEFRAME}) is ${signal.regime} at ${(signal.confidence * 100).toFixed(0)}% confidence. ` +
          `Built-in playbook "${playbook.name}" (${playbook.id}) targets this archetype: ${playbook.description}`,
        {
          confidence: Math.min(0.88, 0.6 + signal.confidence * 0.28),
          action: `Run get_playbook for "${playbook.id}" or load the ${playbook.id} workflow`,
          triggers: {
            source: "monitor_loop",
            eventType: "tick_playbook_suggest",
            symbol,
            metadata: {
              regime: signal.regime,
              regimeConfidence: signal.confidence,
              playbookId: playbook.id,
              playbookName: playbook.name,
            },
          },
          operation: {
            tool: "get_playbook",
            args: { id: playbook.id },
            readOnly: true,
            description: `Load playbook details for ${playbook.name}`,
          },
        },
      ),
    );
  }

  return candidates;
};

export function resetPlaybookSuggestProducerState(): void {
  lastSuggestedKey.clear();
  playbooksLoaded = false;
}
