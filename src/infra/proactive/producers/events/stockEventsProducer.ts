/**
 * Stock Events Producer
 *
 * Four periodic producers that poll Finnhub for stock-specific events Gordon
 * didn't previously have visibility into:
 *
 *   - earningsApproachingProducer — upcoming earnings within 3 days
 *   - insiderFlowProducer         — clustered insider transactions on watchlist
 *   - analystUpgradeProducer      — consensus rating shifts
 *   - congressionalTradeProducer  — STOCK Act disclosures (lagged data)
 *
 * All four use a shared stock watchlist: defaults to a small set of liquid
 * US equities, can be overridden via STOCK_WATCHLIST env var (comma-separated
 * tickers). Degrades gracefully when Finnhub is not configured or returns
 * 403 on premium endpoints — returns empty candidate list, no errors raised.
 */

import type { CandidateProducer } from "../../engine/proactiveEngine.ts";
import { buildCandidate } from "../../engine/proactiveEngine.ts";
import type { ProactiveSuggestion } from "../../types.ts";
import { createModuleLogger } from "../../../logger/index.ts";
import { finnhub, isFinnhubConfigured } from "../../../data/providers/finnhub.ts";

const logger = createModuleLogger("stock-events-producer");

// ============================================================================
// Shared watchlist
// ============================================================================

const DEFAULT_WATCHLIST = ["AAPL", "MSFT", "NVDA", "TSLA", "META", "GOOGL", "AMZN"];

function getStockWatchlist(): string[] {
  const env = process.env.STOCK_WATCHLIST;
  if (env && env.trim().length > 0) {
    return env
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter((s) => /^[A-Z.]{1,8}$/.test(s))
      .slice(0, 20);
  }
  return DEFAULT_WATCHLIST;
}

function daysAhead(n: number): string {
  return new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
}

function daysBack(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
}

// ============================================================================
// 1. earningsApproachingProducer
// ============================================================================

// Track which earnings ids we've already fired on so we don't repeat
const firedEarnings = new Set<string>();

export const earningsApproachingProducer: CandidateProducer = async (obs): Promise<ProactiveSuggestion[]> => {
  if (obs.source !== "monitor_loop" || obs.eventType !== "tick_earnings") return [];
  if (!isFinnhubConfigured()) return [];

  const candidates: ProactiveSuggestion[] = [];
  const entries = await finnhub.getEarningsCalendar({
    from: daysAhead(0),
    to: daysAhead(3),
  });

  for (const e of entries) {
    const id = `${e.symbol}:${e.date}`;
    if (firedEarnings.has(id)) continue;
    firedEarnings.add(id);

    // Compute days until earnings
    const eventTs = new Date(e.date).getTime();
    const daysUntil = Math.max(0, Math.floor((eventTs - Date.now()) / 86_400_000));
    if (daysUntil > 3) continue;

    // Confidence scales with proximity: tomorrow = 0.85, 2 days = 0.72, 3 days = 0.62
    const confidence = daysUntil === 0 ? 0.9 : daysUntil === 1 ? 0.85 : daysUntil === 2 ? 0.72 : 0.62;
    const hour = e.hour === "bmo" ? "before market open" : e.hour === "amc" ? "after market close" : "during market hours";
    const estimate = e.epsEstimate != null ? `EPS est. ${e.epsEstimate}` : "no EPS estimate";

    candidates.push(
      buildCandidate(
        "earnings_approaching",
        `${e.symbol} earnings ${daysUntil === 0 ? "today" : daysUntil === 1 ? "tomorrow" : `in ${daysUntil} days`}`,
        `${e.symbol} reports earnings on ${e.date} (${hour}). ${estimate}. ` +
          `If you hold ${e.symbol}, consider whether to trim, hedge, or hold through the print. ` +
          `Earnings prints carry binary event risk — position sizing should assume you could see a 5-15% gap either way.`,
        {
          confidence,
          action: `Run /dd ${e.symbol} to review the setup before the print`,
          triggers: {
            source: "monitor_loop",
            eventType: "tick_earnings",
            symbol: e.symbol,
            metadata: {
              earningsDate: e.date,
              hour: e.hour,
              epsEstimate: e.epsEstimate,
              revenueEstimate: e.revenueEstimate,
              daysUntil,
            },
          },
          operation: {
            tool: "get_earnings_estimates",
            args: { symbol: e.symbol },
            readOnly: true,
            description: `Pull analyst estimates for ${e.symbol}`,
          },
        },
      ),
    );
  }

  // Garbage collect — forget earnings older than 7 days
  if (firedEarnings.size > 200) {
    const cutoff = daysBack(7);
    for (const id of firedEarnings) {
      const [, date] = id.split(":");
      if (date && date < cutoff) firedEarnings.delete(id);
    }
  }

  return candidates;
};

// ============================================================================
// 2. insiderFlowProducer
// ============================================================================

const firedInsiderFlow = new Set<string>();

export const insiderFlowProducer: CandidateProducer = async (obs): Promise<ProactiveSuggestion[]> => {
  if (obs.source !== "monitor_loop" || obs.eventType !== "tick_insider_flow") return [];
  if (!isFinnhubConfigured()) return [];

  const candidates: ProactiveSuggestion[] = [];
  const watchlist = getStockWatchlist();
  const from = daysBack(14);
  const to = daysBack(0);

  const results = await Promise.allSettled(
    watchlist.map(async (symbol) => {
      const txs = await finnhub.getInsiderTransactions(symbol, { from, to });
      return { symbol, txs };
    }),
  );

  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    const { symbol, txs } = result.value;
    if (txs.length === 0) continue;

    // Cluster detection: count distinct insiders buying vs selling
    const buyers = new Set<string>();
    const sellers = new Set<string>();
    for (const t of txs) {
      if (t.change > 0) buyers.add(t.name);
      else if (t.change < 0) sellers.add(t.name);
    }

    const minCluster = 3;
    let category: "bull" | "bear" | null = null;
    let insiderCount = 0;

    if (buyers.size >= minCluster && buyers.size > sellers.size * 1.5) {
      category = "bull";
      insiderCount = buyers.size;
    } else if (sellers.size >= minCluster && sellers.size > buyers.size * 1.5) {
      category = "bear";
      insiderCount = sellers.size;
    }

    if (!category) continue;

    // Dedupe by symbol+direction+14-day bucket
    const dedupeKey = `${symbol}:${category}:${Math.floor(Date.now() / (14 * 86_400_000))}`;
    if (firedInsiderFlow.has(dedupeKey)) continue;
    firedInsiderFlow.add(dedupeKey);

    const directionLabel = category === "bull" ? "buying" : "selling";
    candidates.push(
      buildCandidate(
        "insider_flow_alert",
        `${symbol}: ${insiderCount} insiders ${directionLabel} in last 2 weeks`,
        `${insiderCount} distinct insiders have been ${directionLabel} ${symbol} over the past 14 days. ` +
          `${category === "bull" ? "Cluster buying by insiders is one of the more durable signals historically — insiders have information and are risking personal capital." : "Note: insider selling is often noise from compensation vesting, but a cluster of 3+ discretionary sellers is worth reviewing."} ` +
          `Review the specific transactions to distinguish cluster intent from routine 10b5-1 plans.`,
        {
          confidence: category === "bull" ? 0.78 : 0.68,
          action: `Inspect insider transactions for ${symbol}`,
          triggers: {
            source: "monitor_loop",
            eventType: "tick_insider_flow",
            symbol,
            metadata: { direction: category, insiderCount, totalTransactions: txs.length },
          },
          operation: {
            tool: "get_insider_transactions",
            args: { symbol, daysBack: 30 },
            readOnly: true,
            description: `Show full insider transaction list for ${symbol}`,
          },
        },
      ),
    );
  }

  return candidates;
};

// ============================================================================
// 3. analystUpgradeProducer
// ============================================================================

interface AnalystState {
  lastNetBullish: number;
  lastCheckedAt: number;
}
const analystState = new Map<string, AnalystState>();

export const analystUpgradeProducer: CandidateProducer = async (obs): Promise<ProactiveSuggestion[]> => {
  if (obs.source !== "monitor_loop" || obs.eventType !== "tick_analyst") return [];
  if (!isFinnhubConfigured()) return [];

  const candidates: ProactiveSuggestion[] = [];
  const watchlist = getStockWatchlist();

  const results = await Promise.allSettled(
    watchlist.map(async (symbol) => {
      const trends = await finnhub.getRecommendationTrends(symbol);
      if (trends.length === 0) return null;
      const latest = trends[0];
      if (!latest) return null;
      const netBullish = latest.strongBuy + latest.buy - (latest.sell + latest.strongSell);
      return { symbol, period: latest.period, netBullish };
    }),
  );

  for (const r of results) {
    if (r.status !== "fulfilled" || !r.value) continue;
    const { symbol, netBullish } = r.value;
    const prev = analystState.get(symbol);
    analystState.set(symbol, { lastNetBullish: netBullish, lastCheckedAt: Date.now() });

    if (!prev) continue;
    const delta = netBullish - prev.lastNetBullish;

    // Fire on a meaningful upgrade or downgrade (net shift >= 3 analysts)
    if (Math.abs(delta) < 3) continue;

    const direction = delta > 0 ? "upgrade" : "downgrade";
    const bullish = delta > 0;

    candidates.push(
      buildCandidate(
        "analyst_upgrade",
        `${symbol} analyst consensus ${direction} (net shift ${delta > 0 ? "+" : ""}${delta})`,
        `Analyst consensus on ${symbol} shifted by ${delta} net rating points since last check. ` +
          `Net bullish ratings: ${prev.lastNetBullish} → ${netBullish}. ` +
          `${bullish ? "Upgrades tend to be followed by price strength in the short term, though they often price in quickly." : "Downgrades can drive extended weakness, especially if they come from bulge-bracket analysts."}`,
        {
          confidence: Math.min(0.85, 0.65 + Math.abs(delta) * 0.03),
          action: `Review the rating detail and price target changes`,
          triggers: {
            source: "monitor_loop",
            eventType: "tick_analyst",
            symbol,
            metadata: { delta, newNet: netBullish, prevNet: prev.lastNetBullish, bullish },
          },
          operation: {
            tool: "get_analyst_ratings",
            args: { symbol },
            readOnly: true,
            description: `Show full analyst rating trend for ${symbol}`,
          },
        },
      ),
    );
  }

  return candidates;
};

// ============================================================================
// 4. congressionalTradeProducer
// ============================================================================

const firedCongressional = new Set<string>();

export const congressionalTradeProducer: CandidateProducer = async (obs): Promise<ProactiveSuggestion[]> => {
  if (obs.source !== "monitor_loop" || obs.eventType !== "tick_congressional") return [];
  if (!isFinnhubConfigured()) return [];

  const candidates: ProactiveSuggestion[] = [];
  const watchlist = getStockWatchlist();
  const from = daysBack(30);
  const to = daysBack(0);

  const results = await Promise.allSettled(
    watchlist.map(async (symbol) => {
      const trades = await finnhub.getCongressionalTrading(symbol, { from, to });
      return { symbol, trades };
    }),
  );

  for (const r of results) {
    if (r.status !== "fulfilled") continue;
    const { symbol, trades } = r.value;
    if (trades.length === 0) continue;

    // Only flag trades with amount > $50k — small trades are noise
    const meaningful = trades.filter((t) => t.amountTo >= 50_000);
    if (meaningful.length === 0) continue;

    for (const t of meaningful.slice(0, 3)) {
      const dedupeKey = `${symbol}:${t.name}:${t.transactionDate}:${t.position}`;
      if (firedCongressional.has(dedupeKey)) continue;
      firedCongressional.add(dedupeKey);

      candidates.push(
        buildCandidate(
          "congressional_trade",
          `${symbol}: ${t.name} ${t.position} ($${(t.amountFrom / 1000).toFixed(0)}k-$${(t.amountTo / 1000).toFixed(0)}k)`,
          `${t.name} (${t.ownerType}) disclosed a ${t.position} in ${symbol} on ${t.transactionDate}, ` +
            `filed ${t.filingDate}. Amount range: $${t.amountFrom.toLocaleString()}-$${t.amountTo.toLocaleString()}. ` +
            `Congressional trades are lagged disclosures (up to 45 days), so the price has often already moved. ` +
            `Use as context for whether insiders with policy visibility are positioned before news.`,
          {
            confidence: 0.7,
            triggers: {
              source: "monitor_loop",
              eventType: "tick_congressional",
              symbol,
              metadata: {
                name: t.name,
                position: t.position,
                amountFrom: t.amountFrom,
                amountTo: t.amountTo,
                transactionDate: t.transactionDate,
              },
            },
          },
        ),
      );
    }
  }

  // GC: cap set size
  if (firedCongressional.size > 500) {
    const arr = [...firedCongressional];
    firedCongressional.clear();
    arr.slice(-250).forEach((k) => firedCongressional.add(k));
  }

  return candidates;
};

// ============================================================================
// State reset — called on producer unregister
// ============================================================================

export function resetStockEventsProducerState(): void {
  firedEarnings.clear();
  firedInsiderFlow.clear();
  analystState.clear();
  firedCongressional.clear();
}
