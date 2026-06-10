import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  fetchStockHeadlines,
  _resetStockHeadlinesCacheForTests,
  _peekStockCacheForTests,
  _seedTickerMapForTests,
} from "./stockHeadlines.ts";

const YAHOO_RSS_AAPL = `<?xml version="1.0"?>
<rss><channel>
  <item>
    <title><![CDATA[Apple beats expectations on iPhone sales]]></title>
    <link>https://finance.yahoo.com/news/aapl-beats</link>
    <pubDate>${new Date().toUTCString()}</pubDate>
  </item>
  <item>
    <title>Apple sued over App Store fees</title>
    <link>https://finance.yahoo.com/news/aapl-sued</link>
    <pubDate>${new Date().toUTCString()}</pubDate>
  </item>
</channel></rss>`;

const EDGAR_ATOM_AAPL = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title>8-K - Material agreement</title>
    <link href="https://www.sec.gov/Archives/edgar/data/320193/0000320193-26-000001-index.htm"/>
    <updated>${new Date().toISOString()}</updated>
  </entry>
  <entry>
    <title>8-K - Departure of officer</title>
    <link href="https://www.sec.gov/Archives/edgar/data/320193/0000320193-26-000002-index.htm"/>
    <updated>${new Date().toISOString()}</updated>
  </entry>
</feed>`;

const originalFetch = globalThis.fetch;

function mockFetchByUrl(handlers: Array<{ match: (url: string) => boolean; body: string; status?: number }>) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    for (const h of handlers) {
      if (h.match(url)) {
        return new Response(h.body, { status: h.status ?? 200 });
      }
    }
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;
}

describe("fetchStockHeadlines", () => {
  beforeEach(() => {
    _resetStockHeadlinesCacheForTests();
    _seedTickerMapForTests([{ ticker: "AAPL", cik: "0000320193", name: "Apple Inc." }]);
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    _resetStockHeadlinesCacheForTests();
  });

  it("parses Yahoo per-ticker RSS feeds", async () => {
    mockFetchByUrl([
      { match: (u) => u.includes("finance.yahoo.com/rss/headline?s=AAPL"), body: YAHOO_RSS_AAPL },
    ]);
    const out = await fetchStockHeadlines({
      tickers: ["AAPL"],
      sources: ["yahoo"],
      hoursBack: 6,
    });
    expect(out.length).toBe(2);
    expect(out[0]?.ticker).toBe("AAPL");
    expect(out[0]?.source).toBe("yahoo");
    const titles = out.map((h) => h.title);
    expect(titles).toContain("Apple beats expectations on iPhone sales");
  });

  it("parses EDGAR 8-K Atom feeds and prefixes the ticker", async () => {
    mockFetchByUrl([
      { match: (u) => u.includes("sec.gov/cgi-bin/browse-edgar"), body: EDGAR_ATOM_AAPL },
    ]);
    const out = await fetchStockHeadlines({
      tickers: ["AAPL"],
      sources: ["edgar"],
      hoursBack: 24,
    });
    expect(out.length).toBe(2);
    expect(out[0]?.source).toBe("edgar");
    expect(out[0]?.title.startsWith("AAPL 8-K filing:")).toBe(true);
    expect(out[0]?.link).toContain("sec.gov");
  });

  it("returns empty for tickers missing from the SEC ticker map (EDGAR only)", async () => {
    mockFetchByUrl([{ match: () => true, body: EDGAR_ATOM_AAPL }]);
    const out = await fetchStockHeadlines({
      tickers: ["NOTASEC"],
      sources: ["edgar"],
      hoursBack: 24,
    });
    expect(out).toEqual([]);
  });

  it("caches per (source, ticker) so repeated calls don't re-fetch", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return new Response(YAHOO_RSS_AAPL, { status: 200 });
    }) as unknown as typeof fetch;
    await fetchStockHeadlines({ tickers: ["AAPL"], sources: ["yahoo"], hoursBack: 24 });
    await fetchStockHeadlines({ tickers: ["AAPL"], sources: ["yahoo"], hoursBack: 24 });
    expect(calls).toBe(1);
    expect(_peekStockCacheForTests("yahoo", "AAPL")).toBeDefined();
  });

  it("merges Yahoo + EDGAR for the same ticker and sorts newest first", async () => {
    mockFetchByUrl([
      { match: (u) => u.includes("yahoo"), body: YAHOO_RSS_AAPL },
      { match: (u) => u.includes("sec.gov"), body: EDGAR_ATOM_AAPL },
    ]);
    const out = await fetchStockHeadlines({
      tickers: ["AAPL"],
      sources: ["yahoo", "edgar"],
      hoursBack: 24,
    });
    const sources = new Set(out.map((h) => h.source));
    expect(sources.has("yahoo")).toBe(true);
    expect(sources.has("edgar")).toBe(true);
    expect(out.length).toBe(4);
  });

  it("dedupes by link when the same story is tagged for multiple tickers", async () => {
    mockFetchByUrl([
      { match: (u) => u.includes("finance.yahoo.com/rss/headline"), body: YAHOO_RSS_AAPL },
    ]);
    const out = await fetchStockHeadlines({
      tickers: ["AAPL", "MSFT"],
      sources: ["yahoo"],
      hoursBack: 24,
    });
    expect(out.length).toBe(2);
    const links = out.map((h) => h.link);
    expect(new Set(links).size).toBe(links.length);
  });

  it("normalises ticker case (lowercase input still matches uppercase map)", async () => {
    mockFetchByUrl([
      { match: (u) => u.includes("AAPL"), body: YAHOO_RSS_AAPL },
    ]);
    const out = await fetchStockHeadlines({
      tickers: ["aapl"],
      sources: ["yahoo"],
      hoursBack: 24,
    });
    expect(out.length).toBe(2);
    expect(out[0]?.ticker).toBe("AAPL");
  });
});
