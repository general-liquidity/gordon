/**
 * Chart Pattern Producer
 *
 * Periodic producer that scans monitored symbols for freshly-completed LMW
 * geometric chart patterns (Lo-Mamaysky-Wang kernel-extrema detector) and
 * fires a `chart_pattern` candidate. Mirrors regimeFlipProducer: poll
 * monitored symbols, pull candles, run the detector, fire on a NEW completion.
 *
 * Signal discipline (a radar, not a trade signal):
 *   - Only the HIGH-information patterns the paper found mattered most fire as
 *     cards: head-and-shoulders / inverse, double top / bottom. Triangles,
 *     rectangles and broadening patterns are detected by the tool on demand
 *     but are too frequent/low-signal for an unsolicited card.
 *   - Only FRESHLY completed patterns fire (completion within the last
 *     RECENCY_BARS of the window) — not old patterns sitting mid-window.
 *   - Per (symbol, pattern) refire cooldown prevents spamming the same shape
 *     as the rolling window slides.
 *   - The card is a PROMPT TO VALIDATE (run /pattern-edge), not a buy/sell —
 *     a detected pattern is only tradable if it actually moves the return
 *     distribution (the conditional-distribution test the skill chains).
 */

import type { CandidateProducer } from "../../engine/proactiveEngine.ts";
import { buildCandidate } from "../../engine/proactiveEngine.ts";
import type { ProactiveSuggestion } from "../../types.ts";
import { createModuleLogger } from "../../../logger/index.ts";
import { fetchRecentCandles, resolveMonitoredSymbols } from "../candleFetch.ts";
import { detectLmwPatterns, type LmwPattern } from "../../../../core/indicators/lmw-patterns.ts";

const logger = createModuleLogger("chart-pattern-producer");

const TIMEFRAME = "1h";
const CANDLE_COUNT = 120; // enough history for multi-bar patterns at the default bandwidth
const RECENCY_BARS = 8; // only alert on a pattern completed within the last N bars
const REFIRE_COOLDOWN_MS = 6 * 60 * 60 * 1000; // don't re-fire the same (symbol, pattern) for 6h

// The high-information patterns that earn an unsolicited card.
const RADAR_PATTERNS = new Set<LmwPattern>(["HS", "IHS", "DTOP", "DBOT"]);

// Last-fired timestamp per `${symbol}:${pattern}`. Cleared on producer unregister.
const lastFiredAt = new Map<string, number>();

export const chartPatternProducer: CandidateProducer = async (
  obs,
): Promise<ProactiveSuggestion[]> => {
  if (obs.source !== "monitor_loop" || obs.eventType !== "tick_chart_pattern") return [];

  const symbols = await resolveMonitoredSymbols();
  const now = obs.timestamp;
  const candidates: ProactiveSuggestion[] = [];

  const results = await Promise.allSettled(
    symbols.map(async (symbol) => {
      const candles = await fetchRecentCandles(symbol, TIMEFRAME, CANDLE_COUNT);
      if (candles.length < 40) return null;
      const closes = candles.map((c) => c.close);

      let detection: ReturnType<typeof detectLmwPatterns>;
      try {
        detection = detectLmwPatterns(closes);
      } catch (err) {
        logger.debug("detectLmwPatterns threw", { symbol, err: String(err) });
        return null;
      }

      // Fresh, high-signal completions only. Of those, take the most recently
      // completed one so we fire at most one card per symbol per tick.
      const fresh = detection.matches
        .filter((m) => RADAR_PATTERNS.has(m.pattern) && m.endIndex >= closes.length - RECENCY_BARS)
        .sort((a, b) => b.endIndex - a.endIndex);
      const top = fresh[0];
      if (!top) return null;

      const key = `${symbol}:${top.pattern}`;
      const last = lastFiredAt.get(key) ?? 0;
      if (now - last < REFIRE_COOLDOWN_MS) return null;
      lastFiredAt.set(key, now);

      return { symbol, match: top };
    }),
  );

  for (const result of results) {
    if (result.status !== "fulfilled" || !result.value) continue;
    const { symbol, match } = result.value;
    const baseSymbol = symbol.replace(/USDT$/, "");

    candidates.push(
      buildCandidate(
        "chart_pattern",
        `${baseSymbol} formed a ${match.label}`,
        `The LMW pattern detector just flagged a freshly-completed ${match.label} on ${baseSymbol} ` +
          `(${TIMEFRAME}). Classically: ${patternMeaning(match.pattern)}. ` +
          `A clean-looking pattern is not automatically tradable — run /pattern-edge to test whether this ` +
          `pattern has actually moved ${baseSymbol}'s returns before acting on it.`,
        {
          confidence: 0.6,
          action: `Run /pattern-edge ${baseSymbol} to validate, or detect_chart_patterns for the raw read`,
          triggers: {
            source: "monitor_loop",
            eventType: "tick_chart_pattern",
            symbol,
            metadata: {
              pattern: match.pattern,
              label: match.label,
              completedAtIndex: match.endIndex,
              extremaIndices: match.extremaIndices,
            },
          },
          operation: {
            tool: "compute_indicator",
            args: { indicator: "lmw_patterns", symbol: baseSymbol, timeframe: TIMEFRAME },
            readOnly: true,
            description: `Re-detect chart patterns on ${baseSymbol}`,
          },
        },
      ),
    );
  }

  return candidates;
};

function patternMeaning(pattern: LmwPattern): string {
  switch (pattern) {
    case "HS":
      return "a topping/reversal shape — watch for downside on a neckline break";
    case "IHS":
      return "a bottoming/reversal shape — watch for upside on a neckline break";
    case "DTOP":
      return "a double top — a failed retest of resistance, often resolving lower";
    case "DBOT":
      return "a double bottom — a held retest of support, often resolving higher";
    default:
      return "a geometric pattern worth a closer look";
  }
}

/** Reset the last-fired map. Called on producer unregister. */
export function resetChartPatternProducerState(): void {
  lastFiredAt.clear();
}
