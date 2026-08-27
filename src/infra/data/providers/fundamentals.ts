// Stock Fundamentals Client
//
// Fetches fundamental data for equities: P/E, EPS, revenue, balance sheet,
// income statement, cash flow. Uses Yahoo Finance public endpoints (free).
// No API key required.

export interface StockFundamentals {
  symbol: string;
  companyName: string;
  sector: string;
  industry: string;
  marketCap: number;
  peRatio: number;
  forwardPE: number;
  eps: number;
  epsForward: number;
  dividendYield: number;
  beta: number;
  priceToBook: number;
  priceToSales: number;
  debtToEquity: number;
  roe: number; // return on equity
  roa: number; // return on assets
  profitMargin: number;
  revenueGrowth: number; // YoY
  earningsGrowth: number; // YoY
  freeCashFlow: number;
  currentPrice: number;
  fiftyTwoWeekHigh: number;
  fiftyTwoWeekLow: number;
  avgVolume: number;
  lastUpdated: number;
}

export interface FinancialStatement {
  symbol: string;
  period: "annual" | "quarterly";
  fiscalDateEnding: string;
  revenue: number;
  costOfRevenue: number;
  grossProfit: number;
  operatingIncome: number;
  netIncome: number;
  ebitda: number;
  eps: number;
}

export interface BalanceSheet {
  symbol: string;
  period: "annual" | "quarterly";
  fiscalDateEnding: string;
  totalAssets: number;
  totalLiabilities: number;
  totalEquity: number;
  cashAndEquivalents: number;
  totalDebt: number;
  currentAssets: number;
  currentLiabilities: number;
}

export interface CashFlowStatement {
  symbol: string;
  period: "annual" | "quarterly";
  fiscalDateEnding: string;
  operatingCashFlow: number;
  investingCashFlow: number;
  financingCashFlow: number;
  freeCashFlow: number;
  capex: number;
  dividendsPaid: number;
}

export interface AnalystEstimate {
  symbol: string;
  targetMeanPrice: number;
  targetHighPrice: number;
  targetLowPrice: number;
  numberOfAnalysts: number;
  recommendationKey: string; // "buy", "hold", "sell", "strong_buy"
  recommendationMean: number; // 1-5 scale
}

export interface EarningsCalendar {
  symbol: string;
  earningsDate: string;
  epsEstimate: number | null;
  epsActual: number | null;
  surprise: number | null;
  surprisePercent: number | null;
}

export interface YahooNewsItem {
  title: string;
  publisher: string;
  link: string;
  providerPublishTime: number; // unix timestamp
  type: string; // STORY, VIDEO
  relatedTickers: string[];
  // Sentiment inferred from title keywords
  sentimentScore?: number; // -1 to 1
  sentimentLabel?: "bullish" | "bearish" | "neutral";
}

const YAHOO_BASE = "https://query2.finance.yahoo.com";
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

export class FundamentalsClient {
  private cache: Map<string, CacheEntry<any>> = new Map();

  private async fetch<T>(url: string): Promise<T | null> {
    const cached = this.cache.get(url);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return cached.data;
    }

    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 Gordon CLI Trading Terminal",
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) return null;
      const data = (await response.json()) as T;
      this.cache.set(url, { data, timestamp: Date.now() });
      return data;
    } catch {
      return null;
    }
  }

  async getFundamentals(symbol: string): Promise<StockFundamentals | null> {
    const sym = symbol.toUpperCase();
    const url = `${YAHOO_BASE}/v10/finance/quoteSummary/${sym}?modules=summaryDetail,defaultKeyStatistics,financialData,price,summaryProfile`;

    const data = await this.fetch<any>(url);
    if (!data?.quoteSummary?.result?.[0]) return null;

    const r = data.quoteSummary.result[0];
    const sd = r.summaryDetail ?? {};
    const dks = r.defaultKeyStatistics ?? {};
    const fd = r.financialData ?? {};
    const price = r.price ?? {};
    const profile = r.summaryProfile ?? {};

    return {
      symbol: sym,
      companyName: price.longName ?? price.shortName ?? sym,
      sector: profile.sector ?? "Unknown",
      industry: profile.industry ?? "Unknown",
      marketCap: price.marketCap?.raw ?? 0,
      peRatio: sd.trailingPE?.raw ?? 0,
      forwardPE: sd.forwardPE?.raw ?? 0,
      eps: dks.trailingEps?.raw ?? 0,
      epsForward: dks.forwardEps?.raw ?? 0,
      dividendYield: sd.dividendYield?.raw ?? 0,
      beta: dks.beta?.raw ?? 0,
      priceToBook: dks.priceToBook?.raw ?? 0,
      priceToSales: dks.priceToSalesTrailing12Months?.raw ?? 0,
      debtToEquity: fd.debtToEquity?.raw ?? 0,
      roe: fd.returnOnEquity?.raw ?? 0,
      roa: fd.returnOnAssets?.raw ?? 0,
      profitMargin: fd.profitMargins?.raw ?? 0,
      revenueGrowth: fd.revenueGrowth?.raw ?? 0,
      earningsGrowth: fd.earningsGrowth?.raw ?? 0,
      freeCashFlow: fd.freeCashflow?.raw ?? 0,
      currentPrice: price.regularMarketPrice?.raw ?? 0,
      fiftyTwoWeekHigh: sd.fiftyTwoWeekHigh?.raw ?? 0,
      fiftyTwoWeekLow: sd.fiftyTwoWeekLow?.raw ?? 0,
      avgVolume: sd.averageVolume?.raw ?? 0,
      lastUpdated: Date.now(),
    };
  }

  async getFinancialStatements(
    symbol: string,
    period: "annual" | "quarterly" = "annual",
  ): Promise<FinancialStatement[]> {
    const sym = symbol.toUpperCase();
    const module =
      period === "annual" ? "incomeStatementHistory" : "incomeStatementHistoryQuarterly";
    const url = `${YAHOO_BASE}/v10/finance/quoteSummary/${sym}?modules=${module}`;

    const data = await this.fetch<any>(url);
    const statements =
      period === "annual"
        ? data?.quoteSummary?.result?.[0]?.incomeStatementHistory?.incomeStatementHistory
        : data?.quoteSummary?.result?.[0]?.incomeStatementHistoryQuarterly?.incomeStatementHistory;

    if (!Array.isArray(statements)) return [];

    return statements.map((s: any) => ({
      symbol: sym,
      period,
      fiscalDateEnding: s.endDate?.fmt ?? "",
      revenue: s.totalRevenue?.raw ?? 0,
      costOfRevenue: s.costOfRevenue?.raw ?? 0,
      grossProfit: s.grossProfit?.raw ?? 0,
      operatingIncome: s.operatingIncome?.raw ?? 0,
      netIncome: s.netIncome?.raw ?? 0,
      ebitda: s.ebit?.raw ?? 0,
      eps: 0, // would need separate calculation
    }));
  }

  async getBalanceSheet(
    symbol: string,
    period: "annual" | "quarterly" = "annual",
  ): Promise<BalanceSheet[]> {
    const sym = symbol.toUpperCase();
    const module = period === "annual" ? "balanceSheetHistory" : "balanceSheetHistoryQuarterly";
    const url = `${YAHOO_BASE}/v10/finance/quoteSummary/${sym}?modules=${module}`;

    const data = await this.fetch<any>(url);
    const sheets =
      period === "annual"
        ? data?.quoteSummary?.result?.[0]?.balanceSheetHistory?.balanceSheetStatements
        : data?.quoteSummary?.result?.[0]?.balanceSheetHistoryQuarterly?.balanceSheetStatements;

    if (!Array.isArray(sheets)) return [];

    return sheets.map((s: any) => ({
      symbol: sym,
      period,
      fiscalDateEnding: s.endDate?.fmt ?? "",
      totalAssets: s.totalAssets?.raw ?? 0,
      totalLiabilities: s.totalLiab?.raw ?? 0,
      totalEquity: s.totalStockholderEquity?.raw ?? 0,
      cashAndEquivalents: s.cash?.raw ?? 0,
      totalDebt: s.totalCurrentLiabilities?.raw ?? 0,
      currentAssets: s.totalCurrentAssets?.raw ?? 0,
      currentLiabilities: s.totalCurrentLiabilities?.raw ?? 0,
    }));
  }

  async getCashFlow(
    symbol: string,
    period: "annual" | "quarterly" = "annual",
  ): Promise<CashFlowStatement[]> {
    const sym = symbol.toUpperCase();
    const module =
      period === "annual" ? "cashflowStatementHistory" : "cashflowStatementHistoryQuarterly";
    const url = `${YAHOO_BASE}/v10/finance/quoteSummary/${sym}?modules=${module}`;

    const data = await this.fetch<any>(url);
    const flows =
      period === "annual"
        ? data?.quoteSummary?.result?.[0]?.cashflowStatementHistory?.cashflowStatements
        : data?.quoteSummary?.result?.[0]?.cashflowStatementHistoryQuarterly?.cashflowStatements;

    if (!Array.isArray(flows)) return [];

    return flows.map((s: any) => ({
      symbol: sym,
      period,
      fiscalDateEnding: s.endDate?.fmt ?? "",
      operatingCashFlow: s.totalCashFromOperatingActivities?.raw ?? 0,
      investingCashFlow: s.totalCashflowsFromInvestingActivities?.raw ?? 0,
      financingCashFlow: s.totalCashFromFinancingActivities?.raw ?? 0,
      freeCashFlow:
        (s.totalCashFromOperatingActivities?.raw ?? 0) - (s.capitalExpenditures?.raw ?? 0),
      capex: Math.abs(s.capitalExpenditures?.raw ?? 0),
      dividendsPaid: Math.abs(s.dividendsPaid?.raw ?? 0),
    }));
  }

  async getAnalystEstimates(symbol: string): Promise<AnalystEstimate | null> {
    const sym = symbol.toUpperCase();
    const url = `${YAHOO_BASE}/v10/finance/quoteSummary/${sym}?modules=financialData,recommendationTrend`;

    const data = await this.fetch<any>(url);
    const fd = data?.quoteSummary?.result?.[0]?.financialData;
    if (!fd) return null;

    return {
      symbol: sym,
      targetMeanPrice: fd.targetMeanPrice?.raw ?? 0,
      targetHighPrice: fd.targetHighPrice?.raw ?? 0,
      targetLowPrice: fd.targetLowPrice?.raw ?? 0,
      numberOfAnalysts: fd.numberOfAnalystOpinions?.raw ?? 0,
      recommendationKey: fd.recommendationKey ?? "none",
      recommendationMean: fd.recommendationMean?.raw ?? 3,
    };
  }

  async getEarnings(symbol: string): Promise<EarningsCalendar | null> {
    const sym = symbol.toUpperCase();
    const url = `${YAHOO_BASE}/v10/finance/quoteSummary/${sym}?modules=earnings,calendarEvents`;

    const data = await this.fetch<any>(url);
    const ce = data?.quoteSummary?.result?.[0]?.calendarEvents?.earnings;
    if (!ce) return null;

    return {
      symbol: sym,
      earningsDate: ce.earningsDate?.[0]?.fmt ?? "",
      epsEstimate: ce.earningsAverage?.raw ?? null,
      epsActual: null,
      surprise: null,
      surprisePercent: null,
    };
  }

  async getNews(symbol: string, limit: number = 10): Promise<YahooNewsItem[]> {
    const sym = symbol.toUpperCase();
    const url = `https://query2.finance.yahoo.com/v1/finance/search?q=${sym}&quotesCount=0&newsCount=${limit}`;

    const data = await this.fetch<any>(url);
    if (!data?.news || !Array.isArray(data.news)) return [];

    return data.news.slice(0, limit).map((n: any) => {
      const item: YahooNewsItem = {
        title: n.title ?? "",
        publisher: n.publisher ?? "",
        link: n.link ?? "",
        providerPublishTime: n.providerPublishTime ?? 0,
        type: n.type ?? "STORY",
        relatedTickers: n.relatedTickers ?? [],
      };
      // Simple keyword-based sentiment
      const title = item.title.toLowerCase();
      const bullish = [
        "beat",
        "surge",
        "soar",
        "rally",
        "upgrade",
        "buy",
        "bullish",
        "growth",
        "record",
        "strong",
        "positive",
      ];
      const bearish = [
        "miss",
        "plunge",
        "crash",
        "fall",
        "downgrade",
        "sell",
        "bearish",
        "loss",
        "weak",
        "negative",
        "warn",
      ];
      let score = 0;
      for (const w of bullish) if (title.includes(w)) score += 0.2;
      for (const w of bearish) if (title.includes(w)) score -= 0.2;
      score = Math.max(-1, Math.min(1, score));
      item.sentimentScore = score;
      item.sentimentLabel = score > 0.1 ? "bullish" : score < -0.1 ? "bearish" : "neutral";
      return item;
    });
  }

  clearCache(): void {
    this.cache.clear();
  }
}

let instance: FundamentalsClient | null = null;
export function getFundamentalsClient(): FundamentalsClient {
  if (!instance) instance = new FundamentalsClient();
  return instance;
}
