/**
 * Whale Alert Producer
 *
 * Periodic producer that polls public crypto-news RSS feeds for headlines
 * mentioning whale-scale flows (large transfers, accumulation, dormant-wallet
 * moves) on monitored symbols. No on-chain webhook feed — headline keywords
 * are the v1 signal until operator-installed MCP wallet-intel is wired.
 */

import type { CandidateProducer } from "../../engine/proactiveEngine.ts";
import { buildCandidate } from "../../engine/proactiveEngine.ts";
import type { ProactiveSuggestion } from "../../types.ts";
import { createModuleLogger } from "../../../logger/index.ts";
import { resolveMonitoredSymbols } from "../candleFetch.ts";
import { fetchHeadlines, type NewsHeadline } from "../../../news/cryptoHeadlines.ts";

const logger = createModuleLogger("whale-alert-producer");

const HOURS_BACK = 12;
const MIN_CONFIDENCE = 0.68;
const MAX_CANDIDATES_PER_TICK = 2;

const WHALE_PATTERNS: Array<{ regex: RegExp; weight: number; label: string }> = [
  { regex: /\bwhale\s+alert\b/i, weight: 0.95, label: "whale alert" },
  { regex: /\bwhale\b/i, weight: 0.85, label: "whale" },
  { regex: /\blarge\s+transfer/i, weight: 0.9, label: "large transfer" },
  { regex: /\baccumulation\b/i, weight: 0.8, label: "accumulation" },
  { regex: /\bdormant\s+wallet/i, weight: 0.88, label: "dormant wallet" },
  { regex: /\b(inflow|outflow)\b/i, weight: 0.75, label: "exchange flow" },
  { regex: /\bmoved\s+[\d,.]+\s*(btc|eth|sol|usdt|usdc)\b/i, weight: 0.92, label: "large move" },
];

const firedLinksBySymbol = new Map<string, Set<string>>();

function scoreWhaleHeadline(title: string): { confidence: number; labels: string[] } {
  let confidence = 0;
  const labels: string[] = [];
  for (const { regex, weight, label } of WHALE_PATTERNS) {
    if (regex.test(title)) {
      confidence = Math.max(confidence, weight);
      labels.push(label);
    }
  }
  return { confidence, labels };
}

export const whaleAlertProducer: CandidateProducer = async (obs): Promise<ProactiveSuggestion[]> => {
  if (obs.source !== "monitor_loop" || obs.eventType !== "tick_whale_alert") return [];

  const symbols = await resolveMonitoredSymbols();
  if (symbols.length === 0) return [];

  const queryTokens = new Set<string>();
  for (const s of symbols) {
    const base = s.replace(/(USDT|USDC|FDUSD|TUSD|BUSD|USD|EUR|GBP|JPY)$/i, "");
    if (base) queryTokens.add(base);
  }
  const query = [...queryTokens].join("|");

  let headlines: NewsHeadline[];
  try {
    headlines = await fetchHeadlines({ query, hoursBack: HOURS_BACK, limit: 60 });
  } catch (err) {
    logger.debug("Whale headline fetch failed", { err: String(err) });
    return [];
  }

  if (headlines.length === 0) return [];

  const candidates: ProactiveSuggestion[] = [];
  for (const baseSymbol of queryTokens) {
    let already = firedLinksBySymbol.get(baseSymbol);
    if (!already) {
      already = new Set<string>();
      firedLinksBySymbol.set(baseSymbol, already);
    }

    const symbolRe = new RegExp(`\\b${baseSymbol}\\b`, "i");
    const symbolHeadlines = headlines.filter((h) => symbolRe.test(h.title));

    let best: { headline: NewsHeadline; confidence: number; labels: string[] } | null = null;
    for (const h of symbolHeadlines) {
      if (already.has(h.link)) continue;
      const score = scoreWhaleHeadline(h.title);
      if (score.confidence < MIN_CONFIDENCE) continue;
      if (!best || score.confidence > best.confidence) {
        best = { headline: h, confidence: score.confidence, labels: score.labels };
      }
    }
    if (!best) continue;

    already.add(best.headline.link);

    candidates.push(
      buildCandidate(
        "whale_alert",
        `Whale activity on ${baseSymbol}: ${best.headline.title}`,
        `${best.headline.source} flagged "${best.headline.title}" — matched ${best.labels.join(", ")}. ` +
          `Large-wallet flows can front-run positioning; review exposure on ${baseSymbol} and cross-check with wallet-intel MCP if installed.`,
        {
          confidence: best.confidence,
          action: `Review ${baseSymbol} position sizing and check on-chain wallet intel before adding risk.`,
          triggers: {
            source: "monitor_loop",
            eventType: "tick_whale_alert",
            symbol: baseSymbol,
            metadata: {
              link: best.headline.link,
              headlineSource: best.headline.source,
              matchedLabels: best.labels,
            },
          },
        },
      ),
    );

    if (candidates.length >= MAX_CANDIDATES_PER_TICK) break;
  }

  return candidates;
};

export function resetWhaleAlertProducerState(): void {
  firedLinksBySymbol.clear();
}