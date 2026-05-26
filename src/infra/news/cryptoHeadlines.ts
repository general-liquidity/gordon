/**
 * Crypto news headline fetcher.
 *
 * Inspired by binance/ai-trading-prototype-headlines (MIT). Their tool
 * fetches headlines via NewsAPI (paid) for sentiment-trading research.
 * We pull free public RSS feeds instead — no key, works out of the box,
 * good enough for radar / sentiment-routing decisions.
 *
 * Sources (all free, no auth, public RSS):
 *   - CoinDesk    https://www.coindesk.com/arc/outboundfeeds/rss/
 *   - Cointelegraph https://cointelegraph.com/rss
 *   - Decrypt     https://decrypt.co/feed
 *
 * Cache window: 5 minutes per source. RSS feeds update every few
 * minutes; pulling more often than that is just extra HTTP load.
 */

import type { Sentiment } from "./sentiment.ts";

export type NewsSource =
  | "coindesk"
  | "cointelegraph"
  | "decrypt"
  | "theblock"
  | "blockworks"
  | "dlnews"
  | "cryptoslate"
  | "cryptobriefing"
  | "bitcoinmagazine"
  | "beincrypto"
  | "thedefiant"
  | "protos";

export interface NewsHeadline {
  /** Source slug. */
  source: NewsSource;
  /** Headline title — trimmed, no HTML. */
  title: string;
  /** Article URL. */
  link: string;
  /** ISO 8601 publication timestamp (or empty if unparseable). */
  publishedAt: string;
  /** Pre-computed sentiment (filled by sentiment.ts when present). */
  sentiment?: Sentiment;
}

interface SourceConfig {
  url: string;
  /** Some publishers tag their feeds with sections; if set, we filter
   *  on a section regex. (CoinDesk's main feed is already crypto-only
   *  so we pass undefined.) */
  sectionRegex?: RegExp;
}

const SOURCES: Record<NewsSource, SourceConfig> = {
  coindesk: { url: "https://www.coindesk.com/arc/outboundfeeds/rss/" },
  cointelegraph: { url: "https://cointelegraph.com/rss" },
  decrypt: { url: "https://decrypt.co/feed" },
  theblock: { url: "https://www.theblock.co/rss.xml" },
  blockworks: { url: "https://blockworks.com/feed/rss" },
  dlnews: { url: "https://www.dlnews.com/arc/outboundfeeds/rss/" },
  cryptoslate: { url: "https://cryptoslate.com/feed/" },
  cryptobriefing: { url: "https://cryptobriefing.com/feed/" },
  bitcoinmagazine: { url: "https://bitcoinmagazine.com/feed" },
  beincrypto: { url: "https://beincrypto.com/feed/" },
  thedefiant: { url: "https://thedefiant.io/api/feed" },
  protos: { url: "https://protos.com/feed/" },
};

const CACHE_TTL_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 6_000;

interface CacheEntry {
  fetchedAt: number;
  headlines: NewsHeadline[];
}
const cache = new Map<NewsSource, CacheEntry>();

/**
 * Strip RSS XML to a list of headlines. Uses regex over a real XML
 * parser — feeds are simple, regular, and we don't need to retain
 * structure. The extractor walks <item> blocks and pulls
 * title / link / pubDate. CDATA wrappers are unwrapped; basic HTML
 * entities are decoded.
 */
function parseRssItems(xml: string): Array<{ title: string; link: string; pubDate: string }> {
  const items: Array<{ title: string; link: string; pubDate: string }> = [];
  const itemRe = /<item[\s\S]*?<\/item>/gi;
  for (const match of xml.matchAll(itemRe)) {
    const block = match[0];
    items.push({
      title: extractTag(block, "title"),
      link: extractTag(block, "link"),
      pubDate: extractTag(block, "pubDate") || extractTag(block, "dc:date"),
    });
  }
  return items;
}

function extractTag(block: string, tag: string): string {
  // Match <tag>...</tag> with optional CDATA. Use a non-greedy capture
  // and tolerate attributes on the opening tag.
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  const m = block.match(re);
  if (!m) return "";
  let value = m[1] ?? "";
  // Unwrap CDATA.
  const cdata = value.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  if (cdata) value = cdata[1] ?? "";
  // Decode the handful of entities feeds typically use.
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/<[^>]+>/g, "") // strip any leftover inline HTML
    .trim();
}

function toIsoDate(raw: string): string {
  if (!raw) return "";
  const d = new Date(raw);
  return Number.isFinite(d.getTime()) ? d.toISOString() : "";
}

async function fetchSource(src: NewsSource, signal?: AbortSignal): Promise<NewsHeadline[]> {
  const cached = cache.get(src);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.headlines;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  const onAbort = () => ctrl.abort();
  signal?.addEventListener("abort", onAbort);
  try {
    const res = await fetch(SOURCES[src].url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "gordon-cli/0.9 (crypto-news-radar)" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${src}`);
    const xml = await res.text();
    const items = parseRssItems(xml);
    const headlines: NewsHeadline[] = items
      .filter((it) => it.title && it.link)
      .map((it) => ({
        source: src,
        title: it.title,
        link: it.link,
        publishedAt: toIsoDate(it.pubDate),
      }));
    cache.set(src, { fetchedAt: Date.now(), headlines });
    return headlines;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

export interface FetchOptions {
  /** Defaults to all three sources. */
  sources?: NewsSource[];
  /** Filter to headlines newer than this many hours. */
  hoursBack?: number;
  /** Filter title against this case-insensitive substring (or asset
   *  symbol). E.g. "BTC" matches "Bitcoin", "ETH" matches "Ethereum",
   *  or pass "BTC|ETH|SOL" for a broader match (regex compiled below). */
  query?: string;
  /** Cap output length. Default 30. */
  limit?: number;
  signal?: AbortSignal;
}

/** Light-touch crypto-symbol → keyword expansion. We expand the most
 *  common tickers so a `query: 'BTC'` matches "Bitcoin" too without
 *  the caller having to know the names. */
const QUERY_EXPANSIONS: Record<string, string[]> = {
  BTC: ["bitcoin", "btc"],
  ETH: ["ethereum", "ether", "eth"],
  SOL: ["solana", "sol"],
  XRP: ["ripple", "xrp"],
  DOGE: ["dogecoin", "doge"],
  ADA: ["cardano", "ada"],
  MATIC: ["polygon", "matic"],
  AVAX: ["avalanche", "avax"],
  LINK: ["chainlink", "link"],
  DOT: ["polkadot", "dot"],
  BNB: ["binance coin", "bnb"],
  TRX: ["tron", "trx"],
  LTC: ["litecoin", "ltc"],
};

function expandQuery(query?: string): RegExp | null {
  if (!query) return null;
  const tokens = query
    .split(/[|,\s]+/)
    .map((t) => t.trim())
    .filter(Boolean);
  if (tokens.length === 0) return null;
  const all = new Set<string>();
  for (const t of tokens) {
    const upper = t.toUpperCase();
    const expanded = QUERY_EXPANSIONS[upper];
    if (expanded) {
      for (const e of expanded) all.add(e);
    } else {
      all.add(t);
    }
  }
  // Word-boundary match, case-insensitive.
  const escaped = [...all].map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`\\b(${escaped.join("|")})\\b`, "i");
}

export async function fetchHeadlines(options: FetchOptions = {}): Promise<NewsHeadline[]> {
  const { sources = (Object.keys(SOURCES) as NewsSource[]), hoursBack = 24, limit = 30, signal } = options;
  const since = Date.now() - hoursBack * 60 * 60 * 1000;
  const queryRe = expandQuery(options.query);

  const settled = await Promise.allSettled(sources.map((s) => fetchSource(s, signal)));
  const all: NewsHeadline[] = [];
  for (const r of settled) {
    if (r.status === "fulfilled") all.push(...r.value);
  }

  const filtered = all
    .filter((h) => {
      if (!h.publishedAt) return true; // keep undated entries — most feeds publish them
      return new Date(h.publishedAt).getTime() >= since;
    })
    .filter((h) => (queryRe ? queryRe.test(h.title) : true));

  // Sort newest first (undated to the bottom).
  filtered.sort((a, b) => {
    const ta = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
    const tb = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
    return tb - ta;
  });

  return filtered.slice(0, limit);
}

/** Test-only — clear the cache so unit tests don't carry state. */
export function _resetCacheForTests(): void {
  cache.clear();
}

/** Test-only — read the cache contents without exposing the Map type. */
export function _peekCacheForTests(src: NewsSource): NewsHeadline[] | undefined {
  return cache.get(src)?.headlines;
}

/** Read whatever headlines are currently cached across all sources without
 *  triggering any network fetch. Returns an empty array when the cache is
 *  cold. Callers that need fresh headlines should still use fetchHeadlines —
 *  this is the read-only escape hatch for synthesis snapshots that must NOT
 *  do I/O on hot paths (plan creation, manifest builders). */
export function peekCachedHeadlines(): NewsHeadline[] {
  const all: NewsHeadline[] = [];
  for (const entry of cache.values()) {
    all.push(...entry.headlines);
  }
  return all;
}
