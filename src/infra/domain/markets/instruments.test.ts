import { describe, expect, it } from "bun:test";

import {
  inferMarketFamily,
  normalizeCryptoSymbol,
  normalizeStockSymbol,
  resolveInstrument,
} from "./instruments.ts";

describe("market instrument resolution", () => {
  it("normalizes crypto and stock symbols without hardcoding one venue", () => {
    expect(normalizeCryptoSymbol("btc")).toBe("BTCUSDT");
    expect(normalizeCryptoSymbol("eth/usdc")).toBe("ETHUSDC");
    expect(normalizeStockSymbol("brk.b")).toBe("BRK.B");
  });

  it("uses exchange catalogs to resolve arbitrary crypto quote pairs", async () => {
    const instrument = await resolveInstrument(
      {
        exchange: {
          exchangeId: "coinbase",
          getExchangeInfo: async () => ({
            timezone: "UTC",
            serverTime: Date.now(),
            symbols: [
              {
                symbol: "SOLUSD",
                status: "online",
                baseAsset: "SOL",
                quoteAsset: "USD",
                baseAssetPrecision: 8,
                quoteAssetPrecision: 2,
                orderTypes: ["MARKET"],
                isSpotTradingAllowed: true,
                filters: [],
              },
            ],
          }),
        } as never,
        broker: null,
      },
      "SOL",
    );

    expect(instrument.marketFamily).toBe("crypto");
    expect(instrument.normalizedSymbol).toBe("SOLUSD");
    expect(instrument.resolutionSource).toBe("exchange_catalog");
  });

  it("prefers broker routing for stock tickers when a broker can quote them", async () => {
    const instrument = await resolveInstrument(
      {
        exchange: {
          exchangeId: "binance",
          getExchangeInfo: async () => ({
            timezone: "UTC",
            serverTime: Date.now(),
            symbols: [],
          }),
        } as never,
        broker: {
          brokerId: "alpaca",
          capabilities: {
            supportsExtendedHours: true,
            supportsHistoricalBars: false,
          },
          getLatestQuote: async () => ({
            symbol: "AAPL",
            bidPrice: 210,
            bidSize: 10,
            askPrice: 211,
            askSize: 12,
            timestamp: new Date().toISOString(),
          }),
        } as never,
      },
      "AAPL",
    );

    expect(instrument.marketFamily).toBe("stocks");
    expect(instrument.route).toBe("broker");
    expect(instrument.normalizedSymbol).toBe("AAPL");
    expect(instrument.resolutionSource).toBe("broker_quote");
  });

  it("falls back gracefully when venue-native discovery is unavailable", async () => {
    const instrument = await resolveInstrument(
      {
        exchange: {
          exchangeId: "binance",
          getExchangeInfo: async () => {
            throw new Error("offline");
          },
        } as never,
        broker: null,
      },
      "BTC",
    );

    expect(instrument.marketFamily).toBe("crypto");
    expect(instrument.normalizedSymbol).toBe("BTCUSDT");
    expect(instrument.resolutionSource).toBe("heuristic");
  });

  it("still infers stock vs crypto synchronously for lightweight routing decisions", () => {
    expect(inferMarketFamily({ exchange: {} as never, broker: {} as never }, "AAPL")).toBe(
      "stocks",
    );
    expect(inferMarketFamily({ exchange: {} as never, broker: {} as never }, "BTC/USDT")).toBe(
      "crypto",
    );
  });
});
