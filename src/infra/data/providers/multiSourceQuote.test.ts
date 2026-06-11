import { describe, it, expect, beforeEach } from "bun:test";
import {
  MultiSourceQuoteService,
  QuoteUnavailableError,
} from "./multiSourceQuote.ts";
import type { Exchange, Ticker24hr } from "../../exchange/types.ts";
import type { LLMClient } from "../../ai/llm/client.ts";

// ----------------------------------------------------------------------------
// Fakes
// ----------------------------------------------------------------------------

/** Exchange whose 24h ticker lookup misses, so the getPrice fallback drives
 *  the quoted price. price <= 0 makes the source unusable. */
function fakeExchange(name: string, price: number): Exchange {
  return {
    displayName: name,
    get24hrTickers: async (): Promise<Ticker24hr[]> => [],
    getPrice: async () => price,
    getCandles: async () => [],
  } as unknown as Exchange;
}

/** Exchange that fails outright (venue down). */
function downExchange(name: string): Exchange {
  return {
    displayName: name,
    get24hrTickers: async (): Promise<Ticker24hr[]> => {
      throw new Error("venue unreachable");
    },
    getPrice: async (): Promise<number> => {
      throw new Error("venue unreachable");
    },
    getCandles: async () => [],
  } as unknown as Exchange;
}

/** Exchange whose ticker reports a zero last price (bad data, not outage). */
function zeroPriceExchange(name: string, symbol: string): Exchange {
  return {
    displayName: name,
    get24hrTickers: async () =>
      [
        {
          symbol,
          priceChange: 0,
          priceChangePercent: 0,
          lastPrice: 0,
          highPrice: 0,
          lowPrice: 0,
          volume: 0,
          quoteVolume: 0,
          openTime: 0,
          closeTime: 0,
        },
      ] as Ticker24hr[],
    getPrice: async () => 0,
    getCandles: async () => [],
  } as unknown as Exchange;
}

const deadCoinGecko = { getPrice: async () => null };

function makeService(
  exchanges: Exchange[],
  llmClient: LLMClient | null = null,
): MultiSourceQuoteService {
  const svc = new MultiSourceQuoteService(exchanges, llmClient, {
    enableLLMEnrichment: llmClient != null,
  });
  // Keep tests offline: replace the real CoinGecko client.
  (svc as unknown as { coinGecko: typeof deadCoinGecko }).coinGecko =
    deadCoinGecko;
  svc.clearCache();
  return svc;
}

// Module-level quote cache is shared — use unique symbols per test and
// clear between tests.
beforeEach(() => {
  new MultiSourceQuoteService([]).clearCache();
});

// ----------------------------------------------------------------------------
// Failure contract — no zero-price sentinel
// ----------------------------------------------------------------------------

describe("MultiSourceQuoteService failure contract", () => {
  it("throws QuoteUnavailableError when all sources fail (never price=0)", async () => {
    const svc = makeService([downExchange("VenueA"), downExchange("VenueB")]);
    expect(svc.getQuote("AAA1USDT")).rejects.toBeInstanceOf(
      QuoteUnavailableError,
    );
    try {
      await svc.getQuote("AAA1USDT");
      throw new Error("expected QuoteUnavailableError");
    } catch (e) {
      const err = e as QuoteUnavailableError;
      expect(err.name).toBe("QuoteUnavailableError");
      expect(err.symbol).toBe("AAA1");
      expect(err.sourcesFailed).toContain("VenueA");
      expect(err.sourcesFailed).toContain("VenueB");
      expect(err.sourcesFailed).toContain("CoinGecko");
    }
  });

  it("treats a zero-price source as failed, not as a usable quote", async () => {
    const svc = makeService([zeroPriceExchange("ZeroVenue", "AAA2USDT")]);
    expect(svc.getQuote("AAA2USDT")).rejects.toBeInstanceOf(
      QuoteUnavailableError,
    );
  });

  it("omits unavailable symbols from getQuotes instead of returning sentinels", async () => {
    const svc = makeService([
      {
        displayName: "VenueA",
        get24hrTickers: async (): Promise<Ticker24hr[]> => [],
        getPrice: async (pair: string) => (pair === "GOODUSDT" ? 100 : 0),
        getCandles: async () => [],
      } as unknown as Exchange,
    ]);
    const quotes = await svc.getQuotes(["GOOD", "DEAD1"]);
    expect(quotes.has("GOOD")).toBe(true);
    expect(quotes.has("DEAD1")).toBe(false);
    expect(quotes.get("GOOD")!.price).toBe(100);
  });
});

// ----------------------------------------------------------------------------
// Staleness + degradation metadata
// ----------------------------------------------------------------------------

describe("MultiSourceQuoteService degradation metadata", () => {
  it("stamps fetchedAt and a clean degraded state on agreeing sources", async () => {
    const before = Date.now();
    const svc = makeService([
      fakeExchange("VenueA", 100),
      fakeExchange("VenueB", 101),
    ]);
    const quote = await svc.getQuote("AAA3USDT");
    expect(quote.price).toBe(100.5);
    expect(quote.fetchedAt).toBeGreaterThanOrEqual(before);
    expect(quote.degraded).toBe(false);
    expect(quote.degradedReasons).toEqual([]);
    // CoinGecko fake returned null → recorded as failed, honestly.
    expect(quote.sourcesFailed).toEqual(["CoinGecko"]);
  });

  it("flags source disagreement beyond the threshold as degraded", async () => {
    const svc = makeService([
      fakeExchange("VenueA", 100),
      fakeExchange("VenueB", 110),
    ]);
    const quote = await svc.getQuote("AAA4USDT");
    expect(quote.degraded).toBe(true);
    expect(quote.degradedReasons).toContain("source disagreement");
  });

  it("does not flag disagreement for a single surviving source", async () => {
    const svc = makeService([
      fakeExchange("VenueA", 100),
      downExchange("VenueB"),
    ]);
    const quote = await svc.getQuote("AAA5USDT");
    expect(quote.degraded).toBe(false);
    expect(quote.sourcesFailed).toContain("VenueB");
  });

  it("flags enrichment outage as degraded instead of only logging", async () => {
    const failingLLM = {
      chat: async () => {
        throw new Error("LLM unavailable");
      },
    } as unknown as LLMClient;
    const svc = makeService([fakeExchange("VenueA", 100)], failingLLM);
    const quote = await svc.getQuote("AAA6USDT");
    expect(quote.price).toBe(100);
    expect(quote.degraded).toBe(true);
    expect(quote.degradedReasons).toContain("enrichment unavailable");
  });
});
