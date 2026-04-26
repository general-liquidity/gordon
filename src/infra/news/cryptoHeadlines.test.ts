import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { fetchHeadlines, _resetCacheForTests, _peekCacheForTests } from "./cryptoHeadlines.ts";

const SAMPLE_RSS = `<?xml version="1.0"?>
<rss><channel>
  <item>
    <title><![CDATA[Bitcoin surges past $100k]]></title>
    <link>https://example.com/btc-100k</link>
    <pubDate>${new Date().toUTCString()}</pubDate>
  </item>
  <item>
    <title>Ethereum upgrade ships smoothly</title>
    <link>https://example.com/eth-upgrade</link>
    <pubDate>${new Date().toUTCString()}</pubDate>
  </item>
  <item>
    <title>Random altcoin pumps then dumps &amp; rugs</title>
    <link>https://example.com/alt</link>
    <pubDate>${new Date(Date.now() - 1000 * 60 * 60 * 48).toUTCString()}</pubDate>
  </item>
</channel></rss>`;

const originalFetch = globalThis.fetch;

function mockFetch(body: string, status = 200) {
  globalThis.fetch = (async () =>
    new Response(body, {
      status,
      headers: { "Content-Type": "application/rss+xml" },
    })) as unknown as typeof fetch;
}

describe("fetchHeadlines", () => {
  beforeEach(() => {
    _resetCacheForTests();
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    _resetCacheForTests();
  });

  it("parses RSS items and unwraps CDATA + entities", async () => {
    mockFetch(SAMPLE_RSS);
    const out = await fetchHeadlines({ sources: ["coindesk"], hoursBack: 72 });
    expect(out.length).toBeGreaterThanOrEqual(2);
    const titles = out.map((h) => h.title);
    expect(titles).toContain("Bitcoin surges past $100k");
    expect(titles).toContain("Ethereum upgrade ships smoothly");
    // entity decode: &amp; → &
    expect(titles.some((t) => t.includes("dumps & rugs"))).toBe(true);
  });

  it("filters by hoursBack window", async () => {
    mockFetch(SAMPLE_RSS);
    const out = await fetchHeadlines({ sources: ["coindesk"], hoursBack: 6 });
    // 48h-old item must be excluded
    expect(out.find((h) => h.link === "https://example.com/alt")).toBeUndefined();
  });

  it("expands BTC → bitcoin in the query filter", async () => {
    mockFetch(SAMPLE_RSS);
    const out = await fetchHeadlines({
      sources: ["coindesk"],
      query: "BTC",
      hoursBack: 72,
    });
    // Only the bitcoin headline should match — Ethereum and altcoin filtered out.
    expect(out.length).toBe(1);
    expect(out[0]?.title).toContain("Bitcoin");
  });

  it("caches per source so a second call doesn't re-fetch", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return new Response(SAMPLE_RSS, { status: 200 });
    }) as unknown as typeof fetch;
    await fetchHeadlines({ sources: ["coindesk"], hoursBack: 72 });
    await fetchHeadlines({ sources: ["coindesk"], hoursBack: 72 });
    expect(calls).toBe(1);
    expect(_peekCacheForTests("coindesk")).toBeDefined();
  });

  it("survives a single-source failure when fetching multiple sources", async () => {
    let n = 0;
    globalThis.fetch = (async () => {
      n++;
      if (n === 1) throw new Error("network down");
      return new Response(SAMPLE_RSS, { status: 200 });
    }) as unknown as typeof fetch;
    const out = await fetchHeadlines({
      sources: ["coindesk", "cointelegraph"],
      hoursBack: 72,
    });
    expect(out.length).toBeGreaterThan(0);
  });
});
