/**
 * Stock News Event Producer
 *
 * Parallel to newsEventProducer.ts but for the equities watchlist.
 * Pulls headlines per ticker from three sources and routes the highest-
 * confidence one into a `news_event` candidate:
 *
 *   1. Finnhub `company-news` — already configured, multi-source
 *      aggregator (MarketWatch, Reuters, Yahoo, CNBC, etc.) covered by
 *      a paid backend.
 *   2. Yahoo Finance per-ticker RSS — free, supplemental coverage.
 *   3. SEC EDGAR 8-K Atom feed — real-time material-event filings,
 *      highest signal per item (M&A, exec changes, guidance, etc.).
 *
 * Watchlist resolves via the same env-gated default set as the rest of
 * the stockEventsProducer family. Per-ticker fingerprint dedup so the
 * same article doesn't re-fire across ticks.
 */

import type { CandidateProducer } from "../engine/proactiveEngine.ts";
import { buildCandidate } from "../engine/proactiveEngine.ts";
import type { ProactiveSuggestion } from "../types.ts";
import { createModuleLogger } from "../../logger/index.ts";
import { finnhub, isFinnhubConfigured } from "../../data/providers/finnhub.ts";
import { fetchStockHeadlines, type StockHeadline } from "../../news/stockHeadlines.ts";
import { scoreSentiment, type SentimentScore } from "../../news/sentiment.ts";

const logger = createModuleLogger("stock-news-event-producer");

const HOURS_BACK = 6;
const STRONG_SIGNAL_CONFIDENCE = 0.7;
const MAX_CANDIDATES_PER_TICK = 3;

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

const firedLinksByTicker = new Map<string, Set<string>>();

interface CandidateEntry {
  ticker: string;
  title: string;
  link: string;
  source: string;
  publishedAt: string;
  score: SentimentScore;
}

function alreadyFiredFor(ticker: string): Set<string> {
  let s = firedLinksByTicker.get(ticker);
  if (!s) {
    s = new Set<string>();
    firedLinksByTicker.set(ticker, s);
  }
  return s;
}

async function pullFinnhubHeadlines(ticker: string): Promise<CandidateEntry[]> {
  if (!isFinnhubConfigured()) return [];
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - HOURS_BACK * 60 * 60 * 1000).toISOString().slice(0, 10);
  try {
    const articles = await finnhub.getCompanyNews(ticker, { from, to });
    return articles.map((a) => ({
      ticker,
      title: a.headline,
      link: a.url,
      source: a.source ?? "finnhub",
      publishedAt: new Date(a.datetime * 1000).toISOString(),
      score: scoreSentiment(a.headline),
    }));
  } catch (err) {
    logger.debug("Finnhub company-news failed", { ticker, err: String(err) });
    return [];
  }
}

async function pullRssHeadlines(tickers: string[]): Promise<Map<string, CandidateEntry[]>> {
  const out = new Map<string, CandidateEntry[]>();
  let raw: StockHeadline[] = [];
  try {
    raw = await fetchStockHeadlines({ tickers, hoursBack: HOURS_BACK, limit: 100 });
  } catch (err) {
    logger.debug("Stock headline fetch failed", { err: String(err) });
    return out;
  }
  for (const h of raw) {
    const entry: CandidateEntry = {
      ticker: h.ticker,
      title: h.title,
      link: h.link,
      source: h.source,
      publishedAt: h.publishedAt,
      score: scoreSentiment(h.title),
    };
    const list = out.get(h.ticker) ?? [];
    list.push(entry);
    out.set(h.ticker, list);
  }
  return out;
}

export const stockNewsEventProducer: CandidateProducer = async (obs): Promise<ProactiveSuggestion[]> => {
  if (obs.source !== "monitor_loop" || obs.eventType !== "tick_stock_news_event") return [];

  const watchlist = getStockWatchlist();
  if (watchlist.length === 0) return [];

  const finnhubResults = await Promise.allSettled(watchlist.map(pullFinnhubHeadlines));
  const rssByTicker = await pullRssHeadlines(watchlist);

  const candidates: ProactiveSuggestion[] = [];
  for (let i = 0; i < watchlist.length; i++) {
    const ticker = watchlist[i]!;
    const fired = alreadyFiredFor(ticker);

    const pool: CandidateEntry[] = [];
    const fr = finnhubResults[i];
    if (fr && fr.status === "fulfilled") pool.push(...fr.value);
    pool.push(...(rssByTicker.get(ticker) ?? []));

    let best: CandidateEntry | null = null;
    for (const e of pool) {
      if (!e.link || fired.has(e.link)) continue;
      // 8-K filings always pass the sentiment gate even at neutral —
      // material events warrant a card regardless of headline tone.
      const isFiling = e.source === "edgar";
      if (!isFiling) {
        if (e.score.sentiment === "neutral") continue;
        if (e.score.confidence < STRONG_SIGNAL_CONFIDENCE) continue;
      }
      const conf = isFiling ? Math.max(0.7, e.score.confidence) : e.score.confidence;
      if (!best || conf > (best.source === "edgar" ? Math.max(0.7, best.score.confidence) : best.score.confidence)) {
        best = e;
      }
    }
    if (!best) continue;

    fired.add(best.link);

    const isFiling = best.source === "edgar";
    const tone = isFiling
      ? "Filing"
      : best.score.sentiment === "bullish"
        ? "Bullish"
        : "Bearish";
    const action = isFiling
      ? `Read the 8-K — material events on ${ticker} (M&A, guidance, exec changes) move the stock fast.`
      : best.score.sentiment === "bullish"
        ? `Consider whether the news strengthens an existing long thesis or unwinds a short on ${ticker}.`
        : `Consider tightening stops on long ${ticker} positions or pausing new entries until the dust settles.`;

    const confidence = isFiling ? Math.max(0.7, best.score.confidence) : best.score.confidence;

    candidates.push(
      buildCandidate(
        "news_event",
        `${tone} news on ${ticker}: ${best.title}`,
        `${best.source} flagged "${best.title}". ${
          isFiling
            ? "8-K filings disclose unscheduled material events — read promptly."
            : `Sentiment: ${best.score.sentiment} (${(best.score.confidence * 100).toFixed(0)}% confidence). Matched: ${best.score.matchedKeywords.slice(0, 4).join(", ")}.`
        }`,
        {
          confidence,
          action,
          triggers: {
            source: "monitor_loop",
            eventType: "tick_stock_news_event",
            symbol: ticker,
            metadata: {
              ticker,
              link: best.link,
              headlineSource: best.source,
              sentiment: best.score.sentiment,
              isFiling,
            },
          },
        },
      ),
    );

    if (candidates.length >= MAX_CANDIDATES_PER_TICK) break;
  }

  return candidates;
};

export function resetStockNewsEventProducerState(): void {
  firedLinksByTicker.clear();
}
