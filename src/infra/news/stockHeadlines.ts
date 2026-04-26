/**
 * Stock news headline fetcher.
 *
 * Parallel to cryptoHeadlines.ts but per-ticker rather than broad-feed:
 * Yahoo Finance publishes a per-ticker RSS feed and SEC EDGAR exposes
 * a per-CIK Atom feed of recent filings. Both are free, no auth.
 *
 * Sources (per ticker):
 *   - Yahoo Finance — finance.yahoo.com/rss/headline?s=AAPL — broad
 *     news/analysis coverage, RSS format.
 *   - SEC EDGAR    — sec.gov/cgi-bin/browse-edgar?...&output=atom —
 *     filings only (we narrow to 8-K — the unscheduled material-event
 *     form companies file for M&A, exec changes, guidance, etc.).
 *     Atom format, requires a CIK lookup per ticker.
 *
 * EDGAR is rate-limited: SEC asks for ≤10 requests/second total and a
 * descriptive User-Agent. We respect both and cache the
 * ticker→CIK mapping for 24h after first load.
 *
 * Cache window: 5 minutes per (source, ticker). Yahoo and EDGAR both
 * update every few minutes; pulling more often is wasted load.
 */

import type { Sentiment } from "./sentiment.ts";

export type StockNewsSource = "yahoo" | "edgar";

export interface StockHeadline {
  source: StockNewsSource;
  ticker: string;
  title: string;
  link: string;
  publishedAt: string;
  sentiment?: Sentiment;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 6_000;
const TICKER_MAP_TTL_MS = 24 * 60 * 60 * 1000;

const SEC_USER_AGENT = "gordon-cli/0.9 (crypto-news-radar; contact: oss@general-liquidity.com)";

interface CacheEntry {
  fetchedAt: number;
  headlines: StockHeadline[];
}
const cache = new Map<string, CacheEntry>();
function cacheKey(src: StockNewsSource, ticker: string): string {
  return `${src}:${ticker}`;
}

// ============================================================================
// Ticker → CIK (only needed for EDGAR)
// ============================================================================

interface TickerMapEntry {
  cik: string; // 10-digit, zero-padded
  name: string;
}

let tickerMap: { fetchedAt: number; data: Map<string, TickerMapEntry> } | null = null;

async function loadTickerMap(signal?: AbortSignal): Promise<Map<string, TickerMapEntry>> {
  if (tickerMap && Date.now() - tickerMap.fetchedAt < TICKER_MAP_TTL_MS) {
    return tickerMap.data;
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  signal?.addEventListener("abort", () => ctrl.abort());
  try {
    const res = await fetch("https://www.sec.gov/files/company_tickers.json", {
      signal: ctrl.signal,
      headers: { "User-Agent": SEC_USER_AGENT, Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching SEC ticker map`);
    const json = (await res.json()) as Record<string, { cik_str: number; ticker: string; title: string }>;
    const map = new Map<string, TickerMapEntry>();
    for (const row of Object.values(json)) {
      const cik = String(row.cik_str).padStart(10, "0");
      map.set(row.ticker.toUpperCase(), { cik, name: row.title });
    }
    tickerMap = { fetchedAt: Date.now(), data: map };
    return map;
  } finally {
    clearTimeout(timer);
  }
}

// ============================================================================
// RSS / Atom parsing
// ============================================================================

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/<[^>]+>/g, "")
    .trim();
}

function extractTag(block: string, tag: string): string {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  const m = block.match(re);
  if (!m) return "";
  let v = m[1] ?? "";
  const cdata = v.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  if (cdata) v = cdata[1] ?? "";
  return decodeEntities(v);
}

interface RawEntry {
  title: string;
  link: string;
  pubDate: string;
}

function parseRss(xml: string): RawEntry[] {
  const out: RawEntry[] = [];
  for (const m of xml.matchAll(/<item[\s\S]*?<\/item>/gi)) {
    out.push({
      title: extractTag(m[0], "title"),
      link: extractTag(m[0], "link"),
      pubDate: extractTag(m[0], "pubDate") || extractTag(m[0], "dc:date"),
    });
  }
  return out;
}

function parseAtom(xml: string): RawEntry[] {
  const out: RawEntry[] = [];
  for (const m of xml.matchAll(/<entry[\s\S]*?<\/entry>/gi)) {
    const block = m[0];
    // Atom <link href="..."/> is self-closing; pull href attribute.
    const linkMatch = block.match(/<link[^>]*href="([^"]+)"/i);
    out.push({
      title: extractTag(block, "title"),
      link: linkMatch?.[1] ?? "",
      pubDate: extractTag(block, "updated") || extractTag(block, "published"),
    });
  }
  return out;
}

function toIso(raw: string): string {
  if (!raw) return "";
  const d = new Date(raw);
  return Number.isFinite(d.getTime()) ? d.toISOString() : "";
}

// ============================================================================
// Per-source fetchers
// ============================================================================

async function fetchYahoo(ticker: string, signal?: AbortSignal): Promise<StockHeadline[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  signal?.addEventListener("abort", () => ctrl.abort());
  try {
    const url = `https://finance.yahoo.com/rss/headline?s=${encodeURIComponent(ticker)}`;
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "gordon-cli/0.9 (stock-news-radar)" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching yahoo:${ticker}`);
    const xml = await res.text();
    return parseRss(xml)
      .filter((it) => it.title && it.link)
      .map((it) => ({
        source: "yahoo" as const,
        ticker,
        title: it.title,
        link: it.link,
        publishedAt: toIso(it.pubDate),
      }));
  } finally {
    clearTimeout(timer);
  }
}

async function fetchEdgar8k(ticker: string, signal?: AbortSignal): Promise<StockHeadline[]> {
  const map = await loadTickerMap(signal);
  const entry = map.get(ticker.toUpperCase());
  if (!entry) return []; // ticker not in SEC registry (e.g. ETF, foreign listing)

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  signal?.addEventListener("abort", () => ctrl.abort());
  try {
    const url =
      `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${entry.cik}` +
      `&type=8-K&dateb=&owner=include&count=10&output=atom`;
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": SEC_USER_AGENT, Accept: "application/atom+xml" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching edgar:${ticker}`);
    const xml = await res.text();
    return parseAtom(xml)
      .filter((it) => it.title && it.link)
      .map((it) => ({
        source: "edgar" as const,
        ticker,
        title: `${ticker} 8-K filing: ${it.title}`,
        link: it.link,
        publishedAt: toIso(it.pubDate),
      }));
  } finally {
    clearTimeout(timer);
  }
}

async function fetchSourceForTicker(
  src: StockNewsSource,
  ticker: string,
  signal?: AbortSignal,
): Promise<StockHeadline[]> {
  const key = cacheKey(src, ticker);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.fetchedAt < CACHE_TTL_MS) return hit.headlines;

  const headlines = src === "yahoo" ? await fetchYahoo(ticker, signal) : await fetchEdgar8k(ticker, signal);
  cache.set(key, { fetchedAt: Date.now(), headlines });
  return headlines;
}

// ============================================================================
// Public API
// ============================================================================

export interface FetchStockHeadlinesOptions {
  tickers: string[];
  /** Defaults to both Yahoo and EDGAR. */
  sources?: StockNewsSource[];
  hoursBack?: number;
  /** Cap output. Default 30. */
  limit?: number;
  signal?: AbortSignal;
}

export async function fetchStockHeadlines(
  options: FetchStockHeadlinesOptions,
): Promise<StockHeadline[]> {
  const { tickers, sources = ["yahoo", "edgar"], hoursBack = 24, limit = 30, signal } = options;
  if (tickers.length === 0) return [];
  const since = Date.now() - hoursBack * 60 * 60 * 1000;

  const tasks: Promise<StockHeadline[]>[] = [];
  for (const t of tickers) {
    for (const s of sources) tasks.push(fetchSourceForTicker(s, t.toUpperCase(), signal));
  }

  const settled = await Promise.allSettled(tasks);
  const all: StockHeadline[] = [];
  for (const r of settled) if (r.status === "fulfilled") all.push(...r.value);

  const filtered = all.filter((h) => {
    if (!h.publishedAt) return true;
    return new Date(h.publishedAt).getTime() >= since;
  });

  filtered.sort((a, b) => {
    const ta = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
    const tb = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
    return tb - ta;
  });

  return filtered.slice(0, limit);
}

// ============================================================================
// Test hooks
// ============================================================================

export function _resetStockHeadlinesCacheForTests(): void {
  cache.clear();
  tickerMap = null;
}

export function _peekStockCacheForTests(src: StockNewsSource, ticker: string): StockHeadline[] | undefined {
  return cache.get(cacheKey(src, ticker.toUpperCase()))?.headlines;
}

export function _seedTickerMapForTests(rows: Array<{ ticker: string; cik: string; name: string }>): void {
  const map = new Map<string, TickerMapEntry>();
  for (const r of rows) {
    map.set(r.ticker.toUpperCase(), { cik: r.cik.padStart(10, "0"), name: r.name });
  }
  tickerMap = { fetchedAt: Date.now(), data: map };
}
