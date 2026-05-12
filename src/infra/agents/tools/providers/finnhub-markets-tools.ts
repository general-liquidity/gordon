/**
 * Finnhub Market Data, Scanner, Funds, Indices, Bonds, Crypto & Economic Tools
 *
 * Third batch of Finnhub tools covering everything that isn't company-level
 * fundamentals or alt-data: real-time quotes, candles, symbol lookup, market
 * status, scanner signals (patterns, support/resistance, aggregate indicator),
 * ETF profile + exposure, mutual fund profile + holdings, index constituents,
 * bond yield curve + profile, crypto exchanges/symbols/candles/profile, and
 * economic data series.
 *
 * Gordon already has native crypto coverage via Binance / Hyperliquid /
 * Jupiter / Uniswap / dexscreener, so these crypto tools are additive rather
 * than replacing anything — they give a unified normalized surface for crypto
 * candles and profiles via Finnhub alongside stock data.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { finnhub, isFinnhubConfigured, FINNHUB_NOT_CONFIGURED_MSG } from "../../../data/providers/finnhub.ts";
import { registerSymbols } from "../../../../tui/components/messages/markdownPalette.ts";

function unconfigured<T extends Record<string, unknown>>(extra: T): T & { configured: false; error: string } {
  return { ...extra, configured: false as const, error: FINNHUB_NOT_CONFIGURED_MSG };
}

const resolutionEnum = z.enum(["1", "5", "15", "30", "60", "D", "W", "M"]);

// ============================================================================
// Stock Quote
// ============================================================================

export const getStockQuoteTool = createTool({
  id: "get_stock_quote",
  description:
    "Real-time stock quote: current price, day high/low, open, previous " +
    "close, absolute and percent change, timestamp. Works for any US-listed " +
    "ticker without a broker connection.",
  inputSchema: z.object({ symbol: z.string() }),
  outputSchema: z.object({
    configured: z.boolean(),
    symbol: z.string(),
    quote: z.record(z.string(), z.any()).optional(),
    error: z.string().optional(),
  }),
  execute: async ({ symbol }) => {
    if (!isFinnhubConfigured()) return unconfigured({ symbol });
    const quote = await finnhub.getStockQuote(symbol);
    if (!quote) return { configured: true, symbol, error: "No quote data" };
    // Whatever stock the user looks up enters the markdown ticker
    // registry so subsequent mentions in chat color emerald.
    registerSymbols([symbol]);
    return { configured: true, symbol, quote: quote as unknown as Record<string, unknown> };
  },
});

// ============================================================================
// Stock Candles
// ============================================================================

export const getStockCandlesTool = createTool({
  id: "get_stock_candles",
  description:
    "Historical stock OHLCV candles for a symbol. Resolutions: 1/5/15/30/60 " +
    "(minute), D/W/M (daily/weekly/monthly). Returns open/high/low/close/" +
    "volume arrays plus timestamps. Use for analysis and backtesting on " +
    "stocks outside the broker path.",
  inputSchema: z.object({
    symbol: z.string(),
    resolution: resolutionEnum.optional().default("D"),
    daysBack: z.number().int().min(1).max(3650).optional().default(90),
  }),
  outputSchema: z.object({
    configured: z.boolean(),
    symbol: z.string(),
    resolution: z.string(),
    count: z.number(),
    candles: z.any().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ symbol, resolution, daysBack }) => {
    if (!isFinnhubConfigured())
      return unconfigured({ symbol, resolution: resolution ?? "D", count: 0 });
    const to = Math.floor(Date.now() / 1000);
    const from = to - (daysBack ?? 90) * 86_400;
    const candles = await finnhub.getStockCandles(symbol, resolution ?? "D", from, to);
    if (!candles || candles.s !== "ok")
      return {
        configured: true,
        symbol,
        resolution: resolution ?? "D",
        count: 0,
        error: "No candle data",
      };
    return {
      configured: true,
      symbol,
      resolution: resolution ?? "D",
      count: candles.c.length,
      candles,
    };
  },
});

// ============================================================================
// Stock Symbols (exchange)
// ============================================================================

export const getStockSymbolsTool = createTool({
  id: "get_stock_symbols",
  description:
    "List all stock symbols for a given exchange (e.g., 'US', 'L' for London, " +
    "'T' for Tokyo, 'HK' for Hong Kong). Returns symbol, description, type, " +
    "currency. Use for building universes and screening pipelines.",
  inputSchema: z.object({
    exchange: z.string().optional().default("US"),
  }),
  outputSchema: z.object({
    configured: z.boolean(),
    exchange: z.string(),
    total: z.number(),
    symbols: z.array(z.any()).optional(),
    error: z.string().optional(),
  }),
  execute: async ({ exchange }) => {
    if (!isFinnhubConfigured()) return unconfigured({ exchange: exchange ?? "US", total: 0 });
    const symbols = await finnhub.getStockSymbols(exchange ?? "US");
    return {
      configured: true,
      exchange: exchange ?? "US",
      total: symbols.length,
      symbols: symbols.slice(0, 500),
    };
  },
});

// ============================================================================
// Symbol Lookup
// ============================================================================

export const symbolLookupTool = createTool({
  id: "symbol_lookup",
  description:
    "Search for symbols by name or partial ticker. Returns matches across " +
    "stocks, ETFs, and other instruments. Use when the user refers to a " +
    "company by name rather than ticker.",
  inputSchema: z.object({
    query: z.string().describe("Search query (e.g. 'apple', 'tesla motors')"),
  }),
  outputSchema: z.object({
    configured: z.boolean(),
    query: z.string(),
    total: z.number(),
    results: z.array(z.any()).optional(),
    error: z.string().optional(),
  }),
  execute: async ({ query }) => {
    if (!isFinnhubConfigured()) return unconfigured({ query, total: 0 });
    const results = await finnhub.symbolLookup(query);
    return { configured: true, query, total: results.length, results };
  },
});

// ============================================================================
// Market Status
// ============================================================================

export const getMarketStatusTool = createTool({
  id: "get_market_status",
  description:
    "Check whether a stock exchange is currently open, closed, or in a " +
    "holiday/after-hours session. Returns timezone, session state, and next " +
    "holiday if any.",
  inputSchema: z.object({
    exchange: z.string().optional().default("US"),
  }),
  outputSchema: z.object({
    configured: z.boolean(),
    exchange: z.string(),
    status: z.record(z.string(), z.any()).optional(),
    error: z.string().optional(),
  }),
  execute: async ({ exchange }) => {
    if (!isFinnhubConfigured()) return unconfigured({ exchange: exchange ?? "US" });
    const status = await finnhub.getMarketStatus(exchange ?? "US");
    if (!status) return { configured: true, exchange: exchange ?? "US", error: "No status data" };
    return {
      configured: true,
      exchange: exchange ?? "US",
      status: status as unknown as Record<string, unknown>,
    };
  },
});

// ============================================================================
// Company News
// ============================================================================

export const getCompanyNewsTool = createTool({
  id: "get_company_news",
  description:
    "Company-specific news headlines for a symbol within a date range. " +
    "Returns headline, summary, source, timestamp, URL, and optional image. " +
    "Complements news sentiment with actual article content.",
  inputSchema: z.object({
    symbol: z.string(),
    daysBack: z.number().int().min(1).max(30).optional().default(7),
  }),
  outputSchema: z.object({
    configured: z.boolean(),
    symbol: z.string(),
    total: z.number(),
    articles: z.array(z.any()).optional(),
    error: z.string().optional(),
  }),
  execute: async ({ symbol, daysBack }) => {
    if (!isFinnhubConfigured()) return unconfigured({ symbol, total: 0 });
    const to = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - (daysBack ?? 7) * 86_400_000).toISOString().slice(0, 10);
    const articles = await finnhub.getCompanyNews(symbol, { from, to });
    return {
      configured: true,
      symbol,
      total: articles.length,
      articles: articles.slice(0, 50),
    };
  },
});

// ============================================================================
// Market News
// ============================================================================

export const getMarketNewsTool = createTool({
  id: "get_market_news",
  description:
    "Latest general market news, filtered by category: general, forex, " +
    "crypto, merger. Returns headlines, summaries, sources, and URLs. Use " +
    "for morning brief and intraday macro context.",
  inputSchema: z.object({
    category: z.enum(["general", "forex", "crypto", "merger"]).optional().default("general"),
  }),
  outputSchema: z.object({
    configured: z.boolean(),
    category: z.string(),
    total: z.number(),
    articles: z.array(z.any()).optional(),
    error: z.string().optional(),
  }),
  execute: async ({ category }) => {
    if (!isFinnhubConfigured()) return unconfigured({ category: category ?? "general", total: 0 });
    const articles = await finnhub.getMarketNews(category ?? "general");
    return {
      configured: true,
      category: category ?? "general",
      total: articles.length,
      articles: articles.slice(0, 50),
    };
  },
});

// ============================================================================
// Pattern Recognition
// ============================================================================

export const getPatternRecognitionTool = createTool({
  id: "get_pattern_recognition",
  description:
    "Finnhub's chart-pattern recognition for a symbol at a given resolution. " +
    "Returns detected patterns (triangles, flags, wedges, head-and-shoulders, " +
    "double tops/bottoms, etc.) with entry/stop/profit suggestions and status. " +
    "Use as an additional signal alongside Gordon's native SMC/ICT detectors.",
  inputSchema: z.object({
    symbol: z.string(),
    resolution: resolutionEnum.optional().default("D"),
  }),
  outputSchema: z.object({
    configured: z.boolean(),
    symbol: z.string(),
    resolution: z.string(),
    total: z.number(),
    patterns: z.array(z.any()).optional(),
    error: z.string().optional(),
  }),
  execute: async ({ symbol, resolution }) => {
    if (!isFinnhubConfigured())
      return unconfigured({ symbol, resolution: resolution ?? "D", total: 0 });
    const patterns = await finnhub.getPatternRecognition(symbol, resolution ?? "D");
    return {
      configured: true,
      symbol,
      resolution: resolution ?? "D",
      total: patterns.length,
      patterns,
    };
  },
});

// ============================================================================
// Support / Resistance
// ============================================================================

export const getSupportResistanceTool = createTool({
  id: "get_support_resistance",
  description:
    "Finnhub's automated support and resistance levels for a symbol at a " +
    "given resolution. Returns a sorted list of key price levels. Use for " +
    "validating entry/stop/target placement alongside Gordon's SMC zones.",
  inputSchema: z.object({
    symbol: z.string(),
    resolution: resolutionEnum.optional().default("D"),
  }),
  outputSchema: z.object({
    configured: z.boolean(),
    symbol: z.string(),
    resolution: z.string(),
    levels: z.array(z.number()).optional(),
    error: z.string().optional(),
  }),
  execute: async ({ symbol, resolution }) => {
    if (!isFinnhubConfigured()) return unconfigured({ symbol, resolution: resolution ?? "D" });
    const sr = await finnhub.getSupportResistance(symbol, resolution ?? "D");
    if (!sr) return { configured: true, symbol, resolution: resolution ?? "D", levels: [] };
    return { configured: true, symbol, resolution: resolution ?? "D", levels: sr.levels };
  },
});

// ============================================================================
// Aggregate Technical Signal
// ============================================================================

export const getAggregateSignalTool = createTool({
  id: "get_aggregate_signal",
  description:
    "Finnhub's aggregate technical-analysis signal for a symbol at a given " +
    "resolution: buy/neutral/sell count, overall signal (strong_buy, buy, " +
    "neutral, sell, strong_sell), ADX trend strength, trending flag. Useful " +
    "as a quick single-symbol sanity check.",
  inputSchema: z.object({
    symbol: z.string(),
    resolution: resolutionEnum.optional().default("D"),
  }),
  outputSchema: z.object({
    configured: z.boolean(),
    symbol: z.string(),
    resolution: z.string(),
    signal: z.record(z.string(), z.any()).optional(),
    error: z.string().optional(),
  }),
  execute: async ({ symbol, resolution }) => {
    if (!isFinnhubConfigured()) return unconfigured({ symbol, resolution: resolution ?? "D" });
    const signal = await finnhub.getAggregateSignal(symbol, resolution ?? "D");
    if (!signal)
      return {
        configured: true,
        symbol,
        resolution: resolution ?? "D",
        error: "No signal data",
      };
    return {
      configured: true,
      symbol,
      resolution: resolution ?? "D",
      signal: signal as unknown as Record<string, unknown>,
    };
  },
});

// ============================================================================
// ETF Profile
// ============================================================================

export const getEtfProfileTool = createTool({
  id: "get_etf_profile",
  description:
    "ETF profile: name, description, asset class, investment segment, total " +
    "assets, expense ratio, inception date, issuer, holdings count, NAV, and " +
    "leverage flag. Use for ETF due-diligence before adding to a portfolio.",
  inputSchema: z.object({ symbol: z.string() }),
  outputSchema: z.object({
    configured: z.boolean(),
    symbol: z.string(),
    profile: z.record(z.string(), z.any()).optional(),
    error: z.string().optional(),
  }),
  execute: async ({ symbol }) => {
    if (!isFinnhubConfigured()) return unconfigured({ symbol });
    const profile = await finnhub.getEtfProfile(symbol);
    if (!profile) return { configured: true, symbol, error: "No ETF profile" };
    return { configured: true, symbol, profile: profile as unknown as Record<string, unknown> };
  },
});

// ============================================================================
// ETF Country Exposure
// ============================================================================

export const getEtfCountryExposureTool = createTool({
  id: "get_etf_country_exposure",
  description:
    "Country exposure breakdown for an ETF. Returns per-country exposure " +
    "percentages. Use for detecting geographic concentration and hedging " +
    "country-specific risk.",
  inputSchema: z.object({ symbol: z.string() }),
  outputSchema: z.object({
    configured: z.boolean(),
    symbol: z.string(),
    exposure: z.array(z.any()).optional(),
    error: z.string().optional(),
  }),
  execute: async ({ symbol }) => {
    if (!isFinnhubConfigured()) return unconfigured({ symbol });
    const exposure = await finnhub.getEtfCountryExposure(symbol);
    return { configured: true, symbol, exposure };
  },
});

// ============================================================================
// ETF Sector Exposure
// ============================================================================

export const getEtfSectorExposureTool = createTool({
  id: "get_etf_sector_exposure",
  description:
    "Sector exposure breakdown for an ETF. Returns per-sector exposure " +
    "percentages (Technology, Financials, Health Care, etc.). Use for sector " +
    "rotation analysis and spotting over/under-weights.",
  inputSchema: z.object({ symbol: z.string() }),
  outputSchema: z.object({
    configured: z.boolean(),
    symbol: z.string(),
    exposure: z.array(z.any()).optional(),
    error: z.string().optional(),
  }),
  execute: async ({ symbol }) => {
    if (!isFinnhubConfigured()) return unconfigured({ symbol });
    const exposure = await finnhub.getEtfSectorExposure(symbol);
    return { configured: true, symbol, exposure };
  },
});

// ============================================================================
// Mutual Fund Profile
// ============================================================================

export const getMutualFundProfileTool = createTool({
  id: "get_mutual_fund_profile",
  description:
    "Mutual fund profile: name, category, investment strategy, inception " +
    "date, total NAV, expense ratio, beta, 3/5-year returns, minimum " +
    "investment, fund family, currency. Use for fund due-diligence.",
  inputSchema: z.object({ symbol: z.string() }),
  outputSchema: z.object({
    configured: z.boolean(),
    symbol: z.string(),
    profile: z.record(z.string(), z.any()).optional(),
    error: z.string().optional(),
  }),
  execute: async ({ symbol }) => {
    if (!isFinnhubConfigured()) return unconfigured({ symbol });
    const profile = await finnhub.getMutualFundProfile(symbol);
    if (!profile) return { configured: true, symbol, error: "No fund profile" };
    return { configured: true, symbol, profile: profile as unknown as Record<string, unknown> };
  },
});

// ============================================================================
// Mutual Fund Holdings
// ============================================================================

export const getMutualFundHoldingsTool = createTool({
  id: "get_mutual_fund_holdings",
  description:
    "Mutual fund holdings list: constituent symbols, names, share counts, " +
    "percent weight, and dollar value. Use for fund overlap checks and " +
    "concentration analysis.",
  inputSchema: z.object({ symbol: z.string() }),
  outputSchema: z.object({
    configured: z.boolean(),
    symbol: z.string(),
    total: z.number(),
    holdings: z.array(z.any()).optional(),
    error: z.string().optional(),
  }),
  execute: async ({ symbol }) => {
    if (!isFinnhubConfigured()) return unconfigured({ symbol, total: 0 });
    const holdings = await finnhub.getMutualFundHoldings(symbol);
    return {
      configured: true,
      symbol,
      total: holdings.length,
      holdings: holdings.slice(0, 50),
    };
  },
});

// ============================================================================
// Mutual Fund Country Exposure
// ============================================================================

export const getMutualFundCountryExposureTool = createTool({
  id: "get_mutual_fund_country_exposure",
  description: "Country exposure breakdown for a mutual fund — same structure as the ETF equivalent.",
  inputSchema: z.object({ symbol: z.string() }),
  outputSchema: z.object({
    configured: z.boolean(),
    symbol: z.string(),
    exposure: z.array(z.any()).optional(),
    error: z.string().optional(),
  }),
  execute: async ({ symbol }) => {
    if (!isFinnhubConfigured()) return unconfigured({ symbol });
    const exposure = await finnhub.getMutualFundCountryExposure(symbol);
    return { configured: true, symbol, exposure };
  },
});

// ============================================================================
// Mutual Fund Sector Exposure
// ============================================================================

export const getMutualFundSectorExposureTool = createTool({
  id: "get_mutual_fund_sector_exposure",
  description: "Sector exposure breakdown for a mutual fund — same structure as the ETF equivalent.",
  inputSchema: z.object({ symbol: z.string() }),
  outputSchema: z.object({
    configured: z.boolean(),
    symbol: z.string(),
    exposure: z.array(z.any()).optional(),
    error: z.string().optional(),
  }),
  execute: async ({ symbol }) => {
    if (!isFinnhubConfigured()) return unconfigured({ symbol });
    const exposure = await finnhub.getMutualFundSectorExposure(symbol);
    return { configured: true, symbol, exposure };
  },
});

// ============================================================================
// Index Constituents
// ============================================================================

export const getIndexConstituentsTool = createTool({
  id: "get_index_constituents",
  description:
    "Current constituents of a major index (^GSPC for S&P 500, ^NDX for " +
    "Nasdaq-100, ^DJI for Dow, ^RUT for Russell 2000). Returns a flat array " +
    "of ticker symbols. Use for building index universes and tracking " +
    "rebalancing flow.",
  inputSchema: z.object({
    symbol: z.string().describe("Index symbol, e.g. '^GSPC', '^NDX', '^DJI', '^RUT'"),
  }),
  outputSchema: z.object({
    configured: z.boolean(),
    symbol: z.string(),
    total: z.number(),
    constituents: z.array(z.string()).optional(),
    error: z.string().optional(),
  }),
  execute: async ({ symbol }) => {
    if (!isFinnhubConfigured()) return unconfigured({ symbol, total: 0 });
    const constituents = await finnhub.getIndexConstituents(symbol);
    return { configured: true, symbol, total: constituents.length, constituents };
  },
});

// ============================================================================
// Bond Yield Curve
// ============================================================================

export const getBondYieldCurveTool = createTool({
  id: "get_bond_yield_curve",
  description:
    "Historical bond yield curve for a given tenor code (e.g. '10y', '2y', " +
    "'3m', '30y'). Returns a time series of dates and yields. Use for macro " +
    "regime classification, curve-shape analysis, and rates-driven risk " +
    "management.",
  inputSchema: z.object({
    code: z.string().optional().default("10y").describe("Tenor code, e.g. '3m', '2y', '10y', '30y'"),
  }),
  outputSchema: z.object({
    configured: z.boolean(),
    code: z.string(),
    total: z.number(),
    points: z.array(z.any()).optional(),
    error: z.string().optional(),
  }),
  execute: async ({ code }) => {
    if (!isFinnhubConfigured()) return unconfigured({ code: code ?? "10y", total: 0 });
    const points = await finnhub.getBondYieldCurve(code ?? "10y");
    return { configured: true, code: code ?? "10y", total: points.length, points };
  },
});

// ============================================================================
// Bond Profile
// ============================================================================

export const getBondProfileTool = createTool({
  id: "get_bond_profile",
  description:
    "Bond profile by ISIN: coupon, maturity, issue date, callable flag, bond " +
    "type, debt type, issuer, original amount outstanding, coupon frequency. " +
    "Use for fixed-income due-diligence.",
  inputSchema: z.object({ isin: z.string() }),
  outputSchema: z.object({
    configured: z.boolean(),
    isin: z.string(),
    profile: z.record(z.string(), z.any()).optional(),
    error: z.string().optional(),
  }),
  execute: async ({ isin }) => {
    if (!isFinnhubConfigured()) return unconfigured({ isin });
    const profile = await finnhub.getBondProfile(isin);
    if (!profile) return { configured: true, isin, error: "No bond profile" };
    return { configured: true, isin, profile: profile as unknown as Record<string, unknown> };
  },
});

// ============================================================================
// Crypto Exchanges
// ============================================================================

export const getCryptoExchangesTool = createTool({
  id: "get_finnhub_crypto_exchanges",
  description:
    "List crypto exchanges supported by Finnhub. Returns a flat array of " +
    "exchange codes usable with get_finnhub_crypto_symbols. Additive to " +
    "Gordon's native Binance/Hyperliquid/Jupiter/Uniswap coverage.",
  inputSchema: z.object({}),
  outputSchema: z.object({
    configured: z.boolean(),
    total: z.number(),
    exchanges: z.array(z.string()).optional(),
    error: z.string().optional(),
  }),
  execute: async () => {
    if (!isFinnhubConfigured()) return unconfigured({ total: 0 });
    const exchanges = await finnhub.getCryptoExchanges();
    return { configured: true, total: exchanges.length, exchanges };
  },
});

// ============================================================================
// Crypto Symbols
// ============================================================================

export const getCryptoSymbolsTool = createTool({
  id: "get_finnhub_crypto_symbols",
  description:
    "List crypto symbols for a given Finnhub exchange code. Returns " +
    "description, display symbol, and exchange-native symbol string.",
  inputSchema: z.object({
    exchange: z.string().describe("Finnhub exchange code, e.g. 'BINANCE', 'COINBASE', 'KRAKEN'"),
  }),
  outputSchema: z.object({
    configured: z.boolean(),
    exchange: z.string(),
    total: z.number(),
    symbols: z.array(z.any()).optional(),
    error: z.string().optional(),
  }),
  execute: async ({ exchange }) => {
    if (!isFinnhubConfigured()) return unconfigured({ exchange, total: 0 });
    const symbols = await finnhub.getCryptoSymbols(exchange);
    return { configured: true, exchange, total: symbols.length, symbols: symbols.slice(0, 500) };
  },
});

// ============================================================================
// Crypto Candles
// ============================================================================

export const getFinnhubCryptoCandlesTool = createTool({
  id: "get_finnhub_crypto_candles",
  description:
    "Historical crypto OHLCV candles from Finnhub. Resolutions 1/5/15/30/60/" +
    "D/W/M. Additive to native Binance/Hyperliquid — useful for " +
    "cross-exchange sanity checks and for exchanges Gordon doesn't " +
    "natively wrap.",
  inputSchema: z.object({
    symbol: z.string().describe("Finnhub-formatted symbol, e.g. 'BINANCE:BTCUSDT', 'COINBASE:BTC-USD'"),
    resolution: resolutionEnum.optional().default("D"),
    daysBack: z.number().int().min(1).max(3650).optional().default(30),
  }),
  outputSchema: z.object({
    configured: z.boolean(),
    symbol: z.string(),
    resolution: z.string(),
    count: z.number(),
    candles: z.any().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ symbol, resolution, daysBack }) => {
    if (!isFinnhubConfigured())
      return unconfigured({ symbol, resolution: resolution ?? "D", count: 0 });
    const to = Math.floor(Date.now() / 1000);
    const from = to - (daysBack ?? 30) * 86_400;
    const candles = await finnhub.getCryptoCandles(symbol, resolution ?? "D", from, to);
    if (!candles || candles.s !== "ok")
      return {
        configured: true,
        symbol,
        resolution: resolution ?? "D",
        count: 0,
        error: "No candle data",
      };
    return {
      configured: true,
      symbol,
      resolution: resolution ?? "D",
      count: candles.c.length,
      candles,
    };
  },
});

// ============================================================================
// Crypto Profile
// ============================================================================

export const getCryptoProfileTool = createTool({
  id: "get_finnhub_crypto_profile",
  description:
    "Crypto asset profile: name, description, market cap, total/circulating/" +
    "max supply, website, whitepaper, launch date, proof type. Useful " +
    "baseline for due-diligence on tokens outside Gordon's native DEX path.",
  inputSchema: z.object({ symbol: z.string() }),
  outputSchema: z.object({
    configured: z.boolean(),
    symbol: z.string(),
    profile: z.record(z.string(), z.any()).optional(),
    error: z.string().optional(),
  }),
  execute: async ({ symbol }) => {
    if (!isFinnhubConfigured()) return unconfigured({ symbol });
    const profile = await finnhub.getCryptoProfile(symbol);
    if (!profile) return { configured: true, symbol, error: "No crypto profile" };
    return { configured: true, symbol, profile: profile as unknown as Record<string, unknown> };
  },
});

// ============================================================================
// Forex Rates
// ============================================================================

export const getForexRatesTool = createTool({
  id: "get_forex_rates",
  description:
    "Current forex rates with a configurable base currency (default USD). " +
    "Returns a map of quote currency codes to rates. Useful for " +
    "currency-aware risk conversions and multi-currency portfolio valuation.",
  inputSchema: z.object({
    base: z.string().optional().default("USD"),
  }),
  outputSchema: z.object({
    configured: z.boolean(),
    base: z.string(),
    rates: z.record(z.string(), z.number()).optional(),
    error: z.string().optional(),
  }),
  execute: async ({ base }) => {
    if (!isFinnhubConfigured()) return unconfigured({ base: base ?? "USD" });
    const rates = await finnhub.getForexRates(base ?? "USD");
    if (!rates) return { configured: true, base: base ?? "USD", error: "No rates data" };
    return { configured: true, base: rates.base, rates: rates.quote };
  },
});

// ============================================================================
// Economic Codes
// ============================================================================

export const listEconomicCodesTool = createTool({
  id: "list_economic_codes",
  description:
    "List Finnhub economic indicator codes: GDP, CPI, unemployment, " +
    "industrial production, etc. Returns code, country, indicator name, and " +
    "unit. Use to find valid codes for get_economic_data.",
  inputSchema: z.object({}),
  outputSchema: z.object({
    configured: z.boolean(),
    total: z.number(),
    codes: z.array(z.any()).optional(),
    error: z.string().optional(),
  }),
  execute: async () => {
    if (!isFinnhubConfigured()) return unconfigured({ total: 0 });
    const codes = await finnhub.listEconomicCodes();
    return { configured: true, total: codes.length, codes };
  },
});

// ============================================================================
// Economic Data
// ============================================================================

export const getEconomicDataTool = createTool({
  id: "get_economic_data",
  description:
    "Time series for a specific economic indicator code. Use list_economic_codes " +
    "to find valid codes, then this tool to fetch the series. Returns date/value " +
    "pairs.",
  inputSchema: z.object({
    code: z.string().describe("Indicator code from list_economic_codes, e.g. 'MA-USA-CPI'"),
  }),
  outputSchema: z.object({
    configured: z.boolean(),
    code: z.string(),
    total: z.number(),
    series: z.array(z.any()).optional(),
    error: z.string().optional(),
  }),
  execute: async ({ code }) => {
    if (!isFinnhubConfigured()) return unconfigured({ code, total: 0 });
    const data = await finnhub.getEconomicData(code);
    if (!data?.data) return { configured: true, code, total: 0, error: "No data for code" };
    return { configured: true, code, total: data.data.length, series: data.data };
  },
});

// ============================================================================
// Export
// ============================================================================

export const finnhubMarketsTools = {
  get_stock_quote: getStockQuoteTool,
  get_stock_candles: getStockCandlesTool,
  get_stock_symbols: getStockSymbolsTool,
  symbol_lookup: symbolLookupTool,
  get_market_status: getMarketStatusTool,
  get_company_news: getCompanyNewsTool,
  get_market_news: getMarketNewsTool,
  get_pattern_recognition: getPatternRecognitionTool,
  get_support_resistance: getSupportResistanceTool,
  get_aggregate_signal: getAggregateSignalTool,
  get_etf_profile: getEtfProfileTool,
  get_etf_country_exposure: getEtfCountryExposureTool,
  get_etf_sector_exposure: getEtfSectorExposureTool,
  get_mutual_fund_profile: getMutualFundProfileTool,
  get_mutual_fund_holdings: getMutualFundHoldingsTool,
  get_mutual_fund_country_exposure: getMutualFundCountryExposureTool,
  get_mutual_fund_sector_exposure: getMutualFundSectorExposureTool,
  get_index_constituents: getIndexConstituentsTool,
  get_bond_yield_curve: getBondYieldCurveTool,
  get_bond_profile: getBondProfileTool,
  get_finnhub_crypto_exchanges: getCryptoExchangesTool,
  get_finnhub_crypto_symbols: getCryptoSymbolsTool,
  get_finnhub_crypto_candles: getFinnhubCryptoCandlesTool,
  get_finnhub_crypto_profile: getCryptoProfileTool,
  get_forex_rates: getForexRatesTool,
  list_economic_codes: listEconomicCodesTool,
  get_economic_data: getEconomicDataTool,
};
