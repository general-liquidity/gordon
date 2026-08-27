// Alpha Vantage Client
//
// Fallback data source for stocks when Yahoo Finance fails.
// Requires ALPHA_VANTAGE_API_KEY env var. Free tier: 25 requests/day.
// Paid tier: $50/month for 75 req/min.
//
// Provides: intraday OHLCV, fundamentals, news with sentiment, earnings.

const AV_BASE = "https://www.alphavantage.co/query";
const CACHE_TTL_MS = 60 * 1000; // 1 min (free tier is strict)

export interface AlphaVantageQuote {
  symbol: string;
  price: number;
  open: number;
  high: number;
  low: number;
  volume: number;
  change: number;
  changePercent: number;
  latestTradingDay: string;
}

export interface AlphaVantageIntradayBar {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface AlphaVantageFundamentals {
  symbol: string;
  name: string;
  description: string;
  sector: string;
  industry: string;
  marketCap: number;
  peRatio: number;
  pegRatio: number;
  bookValue: number;
  dividendYield: number;
  eps: number;
  revenuePerShare: number;
  profitMargin: number;
  operatingMargin: number;
  roe: number;
  roa: number;
  revenueTTM: number;
  grossProfitTTM: number;
  ebitda: number;
  quarterlyEarningsGrowth: number;
  quarterlyRevenueGrowth: number;
  analystTargetPrice: number;
  beta: number;
  fiftyTwoWeekHigh: number;
  fiftyTwoWeekLow: number;
}

export interface AlphaVantageNewsItem {
  title: string;
  url: string;
  timePublished: string;
  authors: string[];
  summary: string;
  source: string;
  sentimentScore: number; // -1 to 1 (pre-computed)
  sentimentLabel: "Bearish" | "Somewhat-Bearish" | "Neutral" | "Somewhat-Bullish" | "Bullish";
  tickerSentiments: Array<{
    ticker: string;
    relevanceScore: number;
    tickerSentimentScore: number;
    tickerSentimentLabel: string;
  }>;
}

export interface AlphaVantageEarnings {
  symbol: string;
  annual: Array<{ fiscalDateEnding: string; reportedEPS: number }>;
  quarterly: Array<{
    fiscalDateEnding: string;
    reportedDate: string;
    reportedEPS: number;
    estimatedEPS: number;
    surprise: number;
    surprisePercentage: number;
  }>;
}

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

export class AlphaVantageClient {
  private apiKey: string | undefined;
  private cache: Map<string, CacheEntry<any>> = new Map();

  constructor(apiKey?: string) {
    this.apiKey = apiKey ?? process.env.ALPHA_VANTAGE_API_KEY;
  }

  isConfigured(): boolean {
    return !!this.apiKey;
  }

  private async fetch<T>(params: Record<string, string>): Promise<T | null> {
    if (!this.apiKey) {
      console.warn("[alpha-vantage] No API key configured. Set ALPHA_VANTAGE_API_KEY to enable.");
      return null;
    }

    const url = new URL(AV_BASE);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    url.searchParams.set("apikey", this.apiKey);

    const cacheKey = url.toString();
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) return cached.data;

    try {
      const response = await fetch(url.toString(), {
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) return null;
      const data = (await response.json()) as any;

      // Alpha Vantage returns error info in the body
      if (data["Error Message"] || data.Note) {
        console.warn("[alpha-vantage]", data["Error Message"] ?? data.Note);
        return null;
      }

      this.cache.set(cacheKey, { data, timestamp: Date.now() });
      return data as T;
    } catch {
      return null;
    }
  }

  async getQuote(symbol: string): Promise<AlphaVantageQuote | null> {
    const data = await this.fetch<any>({ function: "GLOBAL_QUOTE", symbol: symbol.toUpperCase() });
    const q = data?.["Global Quote"];
    if (!q) return null;

    return {
      symbol: symbol.toUpperCase(),
      price: parseFloat(q["05. price"] ?? "0"),
      open: parseFloat(q["02. open"] ?? "0"),
      high: parseFloat(q["03. high"] ?? "0"),
      low: parseFloat(q["04. low"] ?? "0"),
      volume: parseInt(q["06. volume"] ?? "0", 10),
      change: parseFloat(q["09. change"] ?? "0"),
      changePercent: parseFloat(q["10. change percent"]?.replace("%", "") ?? "0") / 100,
      latestTradingDay: q["07. latest trading day"] ?? "",
    };
  }

  async getIntraday(
    symbol: string,
    interval: "1min" | "5min" | "15min" | "30min" | "60min" = "5min",
  ): Promise<AlphaVantageIntradayBar[]> {
    const data = await this.fetch<any>({
      function: "TIME_SERIES_INTRADAY",
      symbol: symbol.toUpperCase(),
      interval,
      outputsize: "compact", // 100 most recent
    });

    const series = data?.[`Time Series (${interval})`];
    if (!series) return [];

    return Object.entries(series)
      .map(([timestamp, bar]: [string, any]) => ({
        timestamp,
        open: parseFloat(bar["1. open"]),
        high: parseFloat(bar["2. high"]),
        low: parseFloat(bar["3. low"]),
        close: parseFloat(bar["4. close"]),
        volume: parseInt(bar["5. volume"], 10),
      }))
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }

  async getFundamentals(symbol: string): Promise<AlphaVantageFundamentals | null> {
    const data = await this.fetch<any>({ function: "OVERVIEW", symbol: symbol.toUpperCase() });
    if (!data || Object.keys(data).length === 0 || !data.Symbol) return null;

    return {
      symbol: data.Symbol,
      name: data.Name ?? "",
      description: data.Description ?? "",
      sector: data.Sector ?? "",
      industry: data.Industry ?? "",
      marketCap: parseFloat(data.MarketCapitalization ?? "0"),
      peRatio: parseFloat(data.PERatio ?? "0"),
      pegRatio: parseFloat(data.PEGRatio ?? "0"),
      bookValue: parseFloat(data.BookValue ?? "0"),
      dividendYield: parseFloat(data.DividendYield ?? "0"),
      eps: parseFloat(data.EPS ?? "0"),
      revenuePerShare: parseFloat(data.RevenuePerShareTTM ?? "0"),
      profitMargin: parseFloat(data.ProfitMargin ?? "0"),
      operatingMargin: parseFloat(data.OperatingMarginTTM ?? "0"),
      roe: parseFloat(data.ReturnOnEquityTTM ?? "0"),
      roa: parseFloat(data.ReturnOnAssetsTTM ?? "0"),
      revenueTTM: parseFloat(data.RevenueTTM ?? "0"),
      grossProfitTTM: parseFloat(data.GrossProfitTTM ?? "0"),
      ebitda: parseFloat(data.EBITDA ?? "0"),
      quarterlyEarningsGrowth: parseFloat(data.QuarterlyEarningsGrowthYOY ?? "0"),
      quarterlyRevenueGrowth: parseFloat(data.QuarterlyRevenueGrowthYOY ?? "0"),
      analystTargetPrice: parseFloat(data.AnalystTargetPrice ?? "0"),
      beta: parseFloat(data.Beta ?? "0"),
      fiftyTwoWeekHigh: parseFloat(data["52WeekHigh"] ?? "0"),
      fiftyTwoWeekLow: parseFloat(data["52WeekLow"] ?? "0"),
    };
  }

  async getNewsSentiment(symbol: string, limit: number = 10): Promise<AlphaVantageNewsItem[]> {
    const data = await this.fetch<any>({
      function: "NEWS_SENTIMENT",
      tickers: symbol.toUpperCase(),
      limit: String(limit),
      sort: "LATEST",
    });

    const feed = data?.feed;
    if (!Array.isArray(feed)) return [];

    return feed.slice(0, limit).map((item: any) => ({
      title: item.title ?? "",
      url: item.url ?? "",
      timePublished: item.time_published ?? "",
      authors: item.authors ?? [],
      summary: item.summary ?? "",
      source: item.source ?? "",
      sentimentScore: parseFloat(item.overall_sentiment_score ?? "0"),
      sentimentLabel: item.overall_sentiment_label ?? "Neutral",
      tickerSentiments: (item.ticker_sentiment ?? []).map((t: any) => ({
        ticker: t.ticker,
        relevanceScore: parseFloat(t.relevance_score ?? "0"),
        tickerSentimentScore: parseFloat(t.ticker_sentiment_score ?? "0"),
        tickerSentimentLabel: t.ticker_sentiment_label ?? "Neutral",
      })),
    }));
  }

  async getEarnings(symbol: string): Promise<AlphaVantageEarnings | null> {
    const data = await this.fetch<any>({ function: "EARNINGS", symbol: symbol.toUpperCase() });
    if (!data?.symbol) return null;

    return {
      symbol: data.symbol,
      annual: (data.annualEarnings ?? []).map((e: any) => ({
        fiscalDateEnding: e.fiscalDateEnding,
        reportedEPS: parseFloat(e.reportedEPS ?? "0"),
      })),
      quarterly: (data.quarterlyEarnings ?? []).map((e: any) => ({
        fiscalDateEnding: e.fiscalDateEnding,
        reportedDate: e.reportedDate,
        reportedEPS: parseFloat(e.reportedEPS ?? "0"),
        estimatedEPS: parseFloat(e.estimatedEPS ?? "0"),
        surprise: parseFloat(e.surprise ?? "0"),
        surprisePercentage: parseFloat(e.surprisePercentage ?? "0"),
      })),
    };
  }

  clearCache(): void {
    this.cache.clear();
  }
}

let instance: AlphaVantageClient | null = null;
export function getAlphaVantageClient(): AlphaVantageClient {
  if (!instance) instance = new AlphaVantageClient();
  return instance;
}
