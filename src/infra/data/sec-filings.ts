/**
 * SEC EDGAR Filings Client
 *
 * Retrieves SEC filings (10-K, 10-Q, 8-K) via the EDGAR Full-Text Search (EFTS) API.
 * Free, no API key required. Rate limit: max 10 requests/second per SEC rules.
 *
 * API docs: https://efts.sec.gov/LATEST/
 */

import { Cache } from "../platform/cache/cache.ts";
import { createModuleLogger } from "../logger/index.ts";

const logger = createModuleLogger("sec-filings");

const EFTS_BASE = "https://efts.sec.gov/LATEST";
const SEC_ARCHIVES = "https://www.sec.gov/Archives/edgar/data";
const USER_AGENT = "Gordon-CLI/0.8 (trading terminal; contact@gordon-cli.dev)";

// Rate-limiting: track last request time, enforce 100ms minimum gap
let lastRequestTime = 0;

const searchCache = new Cache<Filing[]>({ defaultTtl: 5 * 60 * 1000 });
const filingCache = new Cache<FilingDetail>({ defaultTtl: 10 * 60 * 1000 });

// ============================================================================
// Types
// ============================================================================

export interface Filing {
  accessionNumber: string;
  formType: string;
  filedDate: string;
  companyName: string;
  ticker: string;
  description: string;
  url: string;
}

export interface FilingDetail extends Filing {
  /** First 5000 characters of the filing full text (for LLM context) */
  fullText: string;
}

/** Raw EFTS search hit shape */
interface EFTSHit {
  _id: string;
  _source: {
    file_date?: string;
    display_date_filed?: string;
    form_type?: string;
    entity_name?: string;
    display_names?: string[];
    tickers?: string[];
    file_description?: string;
    file_num?: string;
    period_of_report?: string;
  };
}

interface EFTSResponse {
  hits?: {
    total?: { value?: number };
    hits?: EFTSHit[];
  };
}

// ============================================================================
// Internal helpers
// ============================================================================

async function rateLimitedFetch(url: string): Promise<Response> {
  const now = Date.now();
  const gap = now - lastRequestTime;
  if (gap < 100) {
    await new Promise((r) => setTimeout(r, 100 - gap));
  }
  lastRequestTime = Date.now();

  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    throw new Error(`SEC EDGAR API error: ${res.status} ${res.statusText}`);
  }

  return res;
}

function accessionToPath(accession: string): string {
  // "0000320193-24-000081" -> "000032019324000081"
  return accession.replace(/-/g, "");
}

function buildFilingUrl(cik: string, accession: string): string {
  const cleanAcc = accessionToPath(accession);
  const dashed = accession;
  return `${SEC_ARCHIVES}/${cik}/${cleanAcc}/${dashed}-index.htm`;
}

function parseHit(hit: EFTSHit, queryTicker: string): Filing {
  const src = hit._source;
  const accession = hit._id;

  // Extract CIK from _id or file_num
  const cikMatch = src.file_num?.match(/(\d+)/);
  const cik = cikMatch?.[1] ?? "0";

  return {
    accessionNumber: accession,
    formType: src.form_type ?? "unknown",
    filedDate: src.file_date ?? src.display_date_filed ?? "unknown",
    companyName: src.entity_name ?? src.display_names?.[0] ?? "Unknown",
    ticker: src.tickers?.[0] ?? queryTicker,
    description: src.file_description ?? src.period_of_report ?? "",
    url: buildFilingUrl(cik, accession),
  };
}

// ============================================================================
// SECFilingsClient
// ============================================================================

export class SECFilingsClient {
  /**
   * Search SEC filings for a ticker or company name.
   *
   * @param ticker - Stock ticker symbol (e.g., "AAPL")
   * @param formType - Optional form type filter ("10-K", "10-Q", "8-K")
   * @param limit - Max results to return (default 10)
   */
  async searchFilings(
    ticker: string,
    formType?: "10-K" | "10-Q" | "8-K",
    limit = 10,
  ): Promise<Filing[]> {
    const cacheKey = `search:${ticker}:${formType ?? "all"}:${limit}`;
    const cached = searchCache.get(cacheKey);
    if (cached) return cached;

    const params = new URLSearchParams({
      q: `"${ticker}"`,
      from: "0",
      size: String(Math.min(limit, 40)),
    });

    if (formType) {
      params.set("forms", formType);
    }

    const url = `${EFTS_BASE}/search-index?${params.toString()}`;
    logger.debug("Searching EDGAR EFTS", { ticker, formType: formType ?? "all", url });

    try {
      const res = await rateLimitedFetch(url);
      const json = (await res.json()) as EFTSResponse;
      const hits = json.hits?.hits ?? [];

      const filings = hits.map((h) => parseHit(h, ticker)).slice(0, limit);
      searchCache.set(cacheKey, filings);

      logger.info("EDGAR search complete", {
        ticker,
        results: String(filings.length),
      });

      return filings;
    } catch (error) {
      logger.warn("EDGAR search failed", {
        ticker,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get filing detail including truncated full text.
   *
   * @param accessionNumber - SEC accession number (e.g., "0000320193-24-000081")
   */
  async getFiling(accessionNumber: string): Promise<FilingDetail> {
    const cached = filingCache.get(accessionNumber);
    if (cached) return cached;

    // Fetch the filing index page to extract primary document link
    const cleanAcc = accessionToPath(accessionNumber);
    const indexUrl = `${EFTS_BASE}/search-index?q=%22${accessionNumber}%22&size=1`;

    logger.debug("Fetching filing detail", { accessionNumber });

    const res = await rateLimitedFetch(indexUrl);
    const json = (await res.json()) as EFTSResponse;
    const hit = json.hits?.hits?.[0];

    if (!hit) {
      throw new Error(`Filing not found: ${accessionNumber}`);
    }

    const filing = parseHit(hit, "");

    // Try to fetch the full text from EFTS rendering endpoint
    let fullText = "";
    try {
      const textUrl = `${EFTS_BASE}/search-index?q=%22${accessionNumber}%22&size=1&_source=file_description`;
      const textRes = await rateLimitedFetch(
        `${SEC_ARCHIVES}/${cleanAcc}/${accessionNumber}-index.htm`,
      );
      const html = await textRes.text();
      // Strip HTML tags for plain text
      fullText = html
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 5000);
    } catch {
      logger.debug("Could not fetch filing full text", { accessionNumber });
      fullText = "(Full text unavailable)";
    }

    const detail: FilingDetail = { ...filing, fullText };
    filingCache.set(accessionNumber, detail);
    return detail;
  }

  /**
   * Get the most recent annual (10-K) filing for a ticker.
   */
  async getLatestAnnual(ticker: string): Promise<FilingDetail | null> {
    const filings = await this.searchFilings(ticker, "10-K", 1);
    if (filings.length === 0) return null;
    return this.getFiling(filings[0]!.accessionNumber);
  }

  /**
   * Get the most recent quarterly (10-Q) filing for a ticker.
   */
  async getLatestQuarterly(ticker: string): Promise<FilingDetail | null> {
    const filings = await this.searchFilings(ticker, "10-Q", 1);
    if (filings.length === 0) return null;
    return this.getFiling(filings[0]!.accessionNumber);
  }
}

// ============================================================================
// Singleton
// ============================================================================

let defaultClient: SECFilingsClient | null = null;

export function getSECFilingsClient(): SECFilingsClient {
  if (!defaultClient) {
    defaultClient = new SECFilingsClient();
  }
  return defaultClient;
}
