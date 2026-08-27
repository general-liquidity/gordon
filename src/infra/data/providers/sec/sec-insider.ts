/**
 * SEC Form 4 Insider Trades Client
 *
 * Fetches insider buy/sell transactions from SEC EDGAR. Form 4 must be filed
 * within 2 business days of a transaction by officers, directors, and 10%+
 * owners. Cluster buying (multiple insiders buying within a short window) is
 * a well-documented alpha signal for equity trading.
 *
 * Free, no API key. Data source: https://data.sec.gov/
 * Rate limit: 10 requests/second per SEC fair-use policy.
 */

import { Cache } from "../../../platform/cache/cache.ts";
import { createModuleLogger } from "../../../logger/index.ts";

const logger = createModuleLogger("sec-insider");
const USER_AGENT = "Gordon/0.8 (trading terminal; contact@gordon-cli.dev)";

const submissionsCache = new Cache<InsiderTransaction[]>({ defaultTtl: 60 * 60 * 1000 });
const tickerCikCache = new Cache<string>({ defaultTtl: 24 * 60 * 60 * 1000 });

let lastRequestTime = 0;
async function rateLimitedFetch(url: string): Promise<Response> {
  const elapsed = Date.now() - lastRequestTime;
  if (elapsed < 110) {
    await new Promise((r) => setTimeout(r, 110 - elapsed));
  }
  lastRequestTime = Date.now();
  return fetch(url, { headers: { "User-Agent": USER_AGENT, accept: "application/json" } });
}

// ============================================================================
// Types
// ============================================================================

export type InsiderTransactionType = "buy" | "sell" | "option_exercise" | "grant" | "other";

export interface InsiderTransaction {
  /** Insider's name */
  insiderName: string;
  /** Reporting person's role (officer title, "director", "10% owner") */
  role: string;
  /** Transaction type (derived from Form 4 transaction code) */
  transactionType: InsiderTransactionType;
  /** SEC Form 4 transaction code (P, S, A, M, etc.) */
  transactionCode: string;
  /** Date of transaction */
  transactionDate: string;
  /** Filing date (when the Form 4 was filed) */
  filedDate: string;
  /** Shares transacted */
  shares: number;
  /** Price per share (0 if not applicable, e.g. grants) */
  pricePerShare: number;
  /** Total value in USD (shares * pricePerShare) */
  totalValue: number;
  /** Shares owned after the transaction */
  sharesOwnedAfter: number;
  /** SEC accession number */
  accessionNumber: string;
  /** Direct link to the Form 4 filing */
  url: string;
}

export interface InsiderSummary {
  ticker: string;
  windowDays: number;
  buyCount: number;
  sellCount: number;
  netShares: number;
  netValue: number;
  /** Number of distinct insiders who bought */
  uniqueBuyers: number;
  /** Number of distinct insiders who sold */
  uniqueSellers: number;
  /** Cluster-buy signal: true if >= 3 distinct insiders bought in the window */
  clusterBuySignal: boolean;
  topBuys: InsiderTransaction[];
  topSells: InsiderTransaction[];
}

// ============================================================================
// Form 4 Transaction Code → type mapping
// ============================================================================

const CODE_TO_TYPE: Record<string, InsiderTransactionType> = {
  P: "buy", // Open market or private purchase
  S: "sell", // Open market or private sale
  A: "grant", // Award or grant
  M: "option_exercise", // Exercise or conversion of derivative
  F: "other", // Payment of exercise price or tax via surrender
  G: "other", // Gift
  D: "other", // Disposition to issuer
  X: "option_exercise", // Exercise of in-the-money derivative
  C: "other", // Conversion of derivative
  J: "other", // Other acquisition/disposition
};

// ============================================================================
// Ticker → CIK lookup
// ============================================================================

async function tickerToCik(ticker: string): Promise<string | null> {
  const cached = tickerCikCache.get(ticker.toUpperCase());
  if (cached) return cached;

  try {
    const res = await rateLimitedFetch("https://www.sec.gov/files/company_tickers.json");
    const json = (await res.json()) as Record<
      string,
      { cik_str: number; ticker: string; title: string }
    >;
    for (const entry of Object.values(json)) {
      if (entry.ticker.toUpperCase() === ticker.toUpperCase()) {
        const paddedCik = String(entry.cik_str).padStart(10, "0");
        tickerCikCache.set(ticker.toUpperCase(), paddedCik);
        return paddedCik;
      }
    }
  } catch (err) {
    logger.warn("ticker→CIK lookup failed", { ticker, err: String(err) });
  }
  return null;
}

// ============================================================================
// Client
// ============================================================================

export class SECInsiderClient {
  /**
   * Get Form 4 insider transactions for a ticker.
   * @param ticker - Stock ticker symbol
   * @param sinceDays - Look back this many days (default 90)
   */
  async getTransactions(ticker: string, sinceDays: number = 90): Promise<InsiderTransaction[]> {
    const cacheKey = `${ticker}:${sinceDays}`;
    const cached = submissionsCache.get(cacheKey);
    if (cached) return cached;

    const cik = await tickerToCik(ticker);
    if (!cik) {
      logger.warn("No CIK found for ticker", { ticker });
      return [];
    }

    try {
      // Fetch filings index for this issuer — includes all Form 4 filings
      const url = `https://data.sec.gov/submissions/CIK${cik}.json`;
      const res = await rateLimitedFetch(url);
      const json = (await res.json()) as {
        cik: string;
        name: string;
        filings: {
          recent: {
            accessionNumber: string[];
            form: string[];
            filingDate: string[];
            primaryDocument: string[];
          };
        };
      };

      const cutoff = Date.now() - sinceDays * 24 * 60 * 60 * 1000;
      const recent = json.filings.recent;
      const transactions: InsiderTransaction[] = [];

      for (let i = 0; i < recent.form.length; i++) {
        if (recent.form[i] !== "4") continue;
        const filedTs = new Date(recent.filingDate[i]!).getTime();
        if (filedTs < cutoff) break;

        const acc = recent.accessionNumber[i]!;
        const doc = recent.primaryDocument[i]!;
        const accNoDashes = acc.replace(/-/g, "");
        const formUrl = `https://www.sec.gov/Archives/edgar/data/${parseInt(cik, 10)}/${accNoDashes}/${doc}`;

        // Parse the Form 4 XML
        const parsed = await this.parseForm4(formUrl, acc, recent.filingDate[i]!);
        if (parsed) transactions.push(...parsed);
      }

      submissionsCache.set(cacheKey, transactions);
      logger.info("Fetched insider transactions", {
        ticker,
        days: sinceDays,
        count: transactions.length,
      });
      return transactions;
    } catch (err) {
      logger.warn("Insider transaction fetch failed", { ticker, err: String(err) });
      return [];
    }
  }

  /** Parse a single Form 4 filing XML document. */
  private async parseForm4(
    url: string,
    accessionNumber: string,
    filedDate: string,
  ): Promise<InsiderTransaction[] | null> {
    try {
      const res = await rateLimitedFetch(url);
      const xml = await res.text();

      // Extract reporting owner info
      const ownerName = xml.match(/<rptOwnerName>([^<]+)<\/rptOwnerName>/)?.[1] ?? "Unknown";
      const isDirector = /<isDirector>1<\/isDirector>/.test(xml);
      const isOfficer = /<isOfficer>1<\/isOfficer>/.test(xml);
      const isTenPct = /<isTenPercentOwner>1<\/isTenPercentOwner>/.test(xml);
      const officerTitle = xml.match(/<officerTitle>([^<]+)<\/officerTitle>/)?.[1];
      const role = officerTitle
        ? officerTitle
        : isDirector
          ? "Director"
          : isTenPct
            ? "10% Owner"
            : isOfficer
              ? "Officer"
              : "Other";

      // Extract non-derivative transactions (actual share buys/sells)
      const transactions: InsiderTransaction[] = [];
      const txBlocks =
        xml.match(/<nonDerivativeTransaction>[\s\S]*?<\/nonDerivativeTransaction>/g) ?? [];

      for (const block of txBlocks) {
        const txDate =
          block.match(/<transactionDate>[\s\S]*?<value>([^<]+)<\/value>/)?.[1] ?? filedDate;
        const code = block.match(/<transactionCode>([^<]+)<\/transactionCode>/)?.[1] ?? "";
        const shares = parseFloat(
          block.match(/<transactionShares>[\s\S]*?<value>([^<]+)<\/value>/)?.[1] ?? "0",
        );
        const price = parseFloat(
          block.match(/<transactionPricePerShare>[\s\S]*?<value>([^<]+)<\/value>/)?.[1] ?? "0",
        );
        const sharesAfter = parseFloat(
          block.match(/<sharesOwnedFollowingTransaction>[\s\S]*?<value>([^<]+)<\/value>/)?.[1] ??
            "0",
        );

        transactions.push({
          insiderName: ownerName,
          role,
          transactionType: CODE_TO_TYPE[code] ?? "other",
          transactionCode: code,
          transactionDate: txDate,
          filedDate,
          shares,
          pricePerShare: price,
          totalValue: shares * price,
          sharesOwnedAfter: sharesAfter,
          accessionNumber,
          url,
        });
      }
      return transactions;
    } catch (err) {
      logger.debug("Form 4 parse failed", { url, err: String(err) });
      return null;
    }
  }

  /**
   * Summarize insider activity for a ticker: cluster buy signal, net flow, top trades.
   */
  async getSummary(ticker: string, windowDays: number = 90): Promise<InsiderSummary> {
    const transactions = await this.getTransactions(ticker, windowDays);

    const buys = transactions.filter((t) => t.transactionType === "buy");
    const sells = transactions.filter((t) => t.transactionType === "sell");
    const uniqueBuyers = new Set(buys.map((t) => t.insiderName)).size;
    const uniqueSellers = new Set(sells.map((t) => t.insiderName)).size;

    const buyValue = buys.reduce((s, t) => s + t.totalValue, 0);
    const sellValue = sells.reduce((s, t) => s + t.totalValue, 0);
    const buyShares = buys.reduce((s, t) => s + t.shares, 0);
    const sellShares = sells.reduce((s, t) => s + t.shares, 0);

    return {
      ticker,
      windowDays,
      buyCount: buys.length,
      sellCount: sells.length,
      netShares: buyShares - sellShares,
      netValue: buyValue - sellValue,
      uniqueBuyers,
      uniqueSellers,
      clusterBuySignal: uniqueBuyers >= 3,
      topBuys: [...buys].sort((a, b) => b.totalValue - a.totalValue).slice(0, 5),
      topSells: [...sells].sort((a, b) => b.totalValue - a.totalValue).slice(0, 5),
    };
  }
}

let instance: SECInsiderClient | null = null;
export function getSECInsiderClient(): SECInsiderClient {
  if (!instance) instance = new SECInsiderClient();
  return instance;
}
