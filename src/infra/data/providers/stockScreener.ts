/**
 * Fundamental Stock Screener
 *
 * Screens a universe of tickers against fundamental criteria (market cap,
 * P/E, growth, margins, debt, etc.). Built on top of Gordon's existing
 * Yahoo Finance fundamentals client — no new API dependency.
 *
 * Designed to complement Gordon's crypto scanner: for stocks, you want
 * fundamental filtering first (find quality businesses), then technical
 * scanning (find entry timing). This module provides the first half.
 */

import { createModuleLogger } from "../../logger/index.ts";
import { getFundamentalsClient, type StockFundamentals } from "./fundamentals.ts";

const logger = createModuleLogger("stock-screener");

// ============================================================================
// Criteria
// ============================================================================

export interface ScreenCriteria {
  /** Market cap range in USD (min, max inclusive). */
  marketCap?: { min?: number; max?: number };
  /** Trailing P/E range. */
  peRatio?: { min?: number; max?: number };
  /** Forward P/E range. */
  forwardPe?: { min?: number; max?: number };
  /** Price-to-book ratio range. */
  priceToBook?: { min?: number; max?: number };
  /** Dividend yield range in percentage points (e.g. 2.5 means 2.5%). */
  dividendYield?: { min?: number; max?: number };
  /** Profit margin range in percentage points. */
  profitMargin?: { min?: number; max?: number };
  /** Return on equity range. */
  returnOnEquity?: { min?: number; max?: number };
  /** Debt-to-equity ratio range. */
  debtToEquity?: { min?: number; max?: number };
  /** Revenue growth (YoY) range in percentage points. */
  revenueGrowth?: { min?: number; max?: number };
  /** Earnings growth (YoY) range in percentage points. */
  earningsGrowth?: { min?: number; max?: number };
  /** Sector filter (e.g., "Technology", "Healthcare"). */
  sector?: string;
  /** Beta range. */
  beta?: { min?: number; max?: number };
}

export interface ScreenResult {
  ticker: string;
  companyName: string;
  sector: string;
  marketCap: number;
  price: number;
  peRatio: number | null;
  dividendYield: number | null;
  revenueGrowth: number | null;
  /** Criteria matched out of total applied. */
  matchCount: number;
  totalCriteria: number;
  /** Individual criterion pass/fail detail. */
  details: Record<string, boolean>;
  /** Full fundamentals snapshot. */
  fundamentals: StockFundamentals;
}

// ============================================================================
// Universes (common ticker lists)
// ============================================================================

/** Canonical list of S&P 500 tickers (subset — 100 most well-known). */
export const SP500_TOP: string[] = [
  "AAPL",
  "MSFT",
  "GOOGL",
  "GOOG",
  "AMZN",
  "NVDA",
  "META",
  "TSLA",
  "BRK-B",
  "AVGO",
  "JPM",
  "V",
  "WMT",
  "XOM",
  "LLY",
  "MA",
  "UNH",
  "HD",
  "PG",
  "COST",
  "JNJ",
  "ABBV",
  "NFLX",
  "BAC",
  "CRM",
  "CVX",
  "KO",
  "TMUS",
  "ORCL",
  "AMD",
  "MRK",
  "PEP",
  "CSCO",
  "ACN",
  "LIN",
  "ABT",
  "ADBE",
  "MCD",
  "WFC",
  "DIS",
  "TMO",
  "CAT",
  "NOW",
  "PM",
  "IBM",
  "TXN",
  "GE",
  "ISRG",
  "QCOM",
  "DHR",
  "VZ",
  "GS",
  "AXP",
  "INTU",
  "PFE",
  "BKNG",
  "CMCSA",
  "MS",
  "RTX",
  "T",
  "NEE",
  "SPGI",
  "BLK",
  "LOW",
  "PLD",
  "AMGN",
  "C",
  "AMAT",
  "UBER",
  "SYK",
  "HON",
  "ETN",
  "PGR",
  "DE",
  "BA",
  "GILD",
  "LMT",
  "ADI",
  "SCHW",
  "BX",
  "VRTX",
  "ADP",
  "MDLZ",
  "PANW",
  "MU",
  "SBUX",
  "TJX",
  "ANET",
  "ELV",
  "MMC",
  "REGN",
  "INTC",
  "CB",
  "SO",
  "BSX",
  "FI",
  "CVS",
  "DUK",
  "COP",
  "KLAC",
];

export const NASDAQ_100_SAMPLE: string[] = [
  "AAPL",
  "MSFT",
  "GOOGL",
  "AMZN",
  "NVDA",
  "META",
  "TSLA",
  "AVGO",
  "COST",
  "NFLX",
  "AMD",
  "PEP",
  "CSCO",
  "ADBE",
  "INTC",
  "TMUS",
  "CMCSA",
  "QCOM",
  "TXN",
  "AMGN",
  "AMAT",
  "HON",
  "INTU",
  "MU",
  "ADI",
  "LRCX",
  "SBUX",
  "BKNG",
  "REGN",
  "VRTX",
];

// ============================================================================
// Screening
// ============================================================================

function inRange(
  value: number | null | undefined,
  range?: { min?: number; max?: number },
): boolean {
  if (!range) return true;
  if (value == null || !Number.isFinite(value)) return false;
  if (range.min !== undefined && value < range.min) return false;
  if (range.max !== undefined && value > range.max) return false;
  return true;
}

function countCriteria(criteria: ScreenCriteria): number {
  let n = 0;
  for (const [, v] of Object.entries(criteria)) {
    if (v !== undefined) n++;
  }
  return n;
}

function evaluateTicker(
  f: StockFundamentals,
  criteria: ScreenCriteria,
): { matchCount: number; totalCriteria: number; details: Record<string, boolean> } {
  const details: Record<string, boolean> = {};

  if (criteria.marketCap !== undefined) {
    details.marketCap = inRange(f.marketCap, criteria.marketCap);
  }
  if (criteria.peRatio !== undefined) {
    details.peRatio = inRange(f.peRatio, criteria.peRatio);
  }
  if (criteria.forwardPe !== undefined) {
    details.forwardPe = inRange(f.forwardPE, criteria.forwardPe);
  }
  if (criteria.priceToBook !== undefined) {
    details.priceToBook = inRange(f.priceToBook, criteria.priceToBook);
  }
  if (criteria.dividendYield !== undefined) {
    details.dividendYield = inRange(
      f.dividendYield != null ? f.dividendYield * 100 : null,
      criteria.dividendYield,
    );
  }
  if (criteria.profitMargin !== undefined) {
    details.profitMargin = inRange(
      f.profitMargin != null ? f.profitMargin * 100 : null,
      criteria.profitMargin,
    );
  }
  if (criteria.returnOnEquity !== undefined) {
    details.returnOnEquity = inRange(f.roe != null ? f.roe * 100 : null, criteria.returnOnEquity);
  }
  if (criteria.debtToEquity !== undefined) {
    details.debtToEquity = inRange(f.debtToEquity, criteria.debtToEquity);
  }
  if (criteria.revenueGrowth !== undefined) {
    details.revenueGrowth = inRange(
      f.revenueGrowth != null ? f.revenueGrowth * 100 : null,
      criteria.revenueGrowth,
    );
  }
  if (criteria.earningsGrowth !== undefined) {
    details.earningsGrowth = inRange(
      f.earningsGrowth != null ? f.earningsGrowth * 100 : null,
      criteria.earningsGrowth,
    );
  }
  if (criteria.sector) {
    details.sector = f.sector?.toLowerCase() === criteria.sector.toLowerCase();
  }
  if (criteria.beta !== undefined) {
    details.beta = inRange(f.beta, criteria.beta);
  }

  const total = Object.keys(details).length;
  const matchCount = Object.values(details).filter(Boolean).length;
  return { matchCount, totalCriteria: total, details };
}

export interface ScreenOptions {
  /** Ticker universe to screen (defaults to SP500_TOP). */
  universe?: string[];
  /** Require ALL criteria to match (default true). If false, rank by match count. */
  requireAll?: boolean;
  /** Max results to return. */
  limit?: number;
  /** Concurrency for fundamental fetches. */
  concurrency?: number;
}

export async function screenStocks(
  criteria: ScreenCriteria,
  options: ScreenOptions = {},
): Promise<ScreenResult[]> {
  const universe = options.universe ?? SP500_TOP;
  const requireAll = options.requireAll ?? true;
  const limit = options.limit ?? 50;
  const concurrency = options.concurrency ?? 5;
  const totalCriteria = countCriteria(criteria);

  logger.info("Screening stocks", {
    universeSize: universe.length,
    criteria: totalCriteria,
    requireAll,
  });

  const results: ScreenResult[] = [];
  const client = getFundamentalsClient();

  // Parallel fetch with concurrency limit
  for (let i = 0; i < universe.length; i += concurrency) {
    const batch = universe.slice(i, i + concurrency);
    const fetched = await Promise.all(
      batch.map(async (ticker) => {
        try {
          return { ticker, fundamentals: await client.getFundamentals(ticker) };
        } catch {
          return null;
        }
      }),
    );

    for (const entry of fetched) {
      if (!entry?.fundamentals) continue;
      const { ticker, fundamentals } = entry;
      const evaluation = evaluateTicker(fundamentals, criteria);

      if (requireAll && evaluation.matchCount < totalCriteria) continue;
      if (!requireAll && evaluation.matchCount === 0) continue;

      results.push({
        ticker,
        companyName: fundamentals.companyName ?? ticker,
        sector: fundamentals.sector ?? "Unknown",
        marketCap: fundamentals.marketCap ?? 0,
        price: fundamentals.currentPrice ?? 0,
        peRatio: fundamentals.peRatio ?? null,
        dividendYield: fundamentals.dividendYield != null ? fundamentals.dividendYield * 100 : null,
        revenueGrowth: fundamentals.revenueGrowth != null ? fundamentals.revenueGrowth * 100 : null,
        matchCount: evaluation.matchCount,
        totalCriteria: evaluation.totalCriteria,
        details: evaluation.details,
        fundamentals,
      });
    }
  }

  // Sort: in strict mode by market cap desc; in lenient mode by match count desc.
  if (requireAll) {
    results.sort((a, b) => b.marketCap - a.marketCap);
  } else {
    results.sort((a, b) => b.matchCount - a.matchCount || b.marketCap - a.marketCap);
  }

  return results.slice(0, limit);
}

// ============================================================================
// Preset screens
// ============================================================================

/** Quality large-caps: profitable, growing, reasonable valuation. */
export const PRESET_QUALITY_GROWTH: ScreenCriteria = {
  marketCap: { min: 10_000_000_000 },
  peRatio: { min: 5, max: 40 },
  profitMargin: { min: 10 },
  revenueGrowth: { min: 5 },
  returnOnEquity: { min: 15 },
};

/** Dividend aristocrats candidates: yield + stability. */
export const PRESET_DIVIDEND: ScreenCriteria = {
  marketCap: { min: 5_000_000_000 },
  dividendYield: { min: 2.5 },
  peRatio: { max: 25 },
  debtToEquity: { max: 2 },
};

/** Deep value: low P/B, low P/E, profitable. */
export const PRESET_DEEP_VALUE: ScreenCriteria = {
  marketCap: { min: 1_000_000_000 },
  priceToBook: { max: 1.5 },
  peRatio: { min: 1, max: 15 },
  profitMargin: { min: 5 },
};

/** Momentum growth: high growth, premium valuation accepted. */
export const PRESET_MOMENTUM: ScreenCriteria = {
  marketCap: { min: 2_000_000_000 },
  revenueGrowth: { min: 20 },
  earningsGrowth: { min: 15 },
};

export const PRESETS = {
  quality_growth: PRESET_QUALITY_GROWTH,
  dividend: PRESET_DIVIDEND,
  deep_value: PRESET_DEEP_VALUE,
  momentum: PRESET_MOMENTUM,
};
