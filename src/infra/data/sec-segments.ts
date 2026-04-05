/**
 * SEC Revenue Segments Client
 *
 * Pulls business segment disclosures (revenue by product line / geography /
 * business unit) from SEC EDGAR XBRL Company Facts API. This data is what
 * gives insight into a company's "quality of business" — e.g. Apple's
 * Services revenue vs iPhone, or Microsoft's Cloud vs Office.
 *
 * Free, no API key. Endpoint: https://data.sec.gov/api/xbrl/companyfacts/
 * Rate limit: 10 req/sec.
 */

import { Cache } from "../platform/cache/cache.ts";
import { createModuleLogger } from "../logger/index.ts";

const logger = createModuleLogger("sec-segments");
const USER_AGENT = "Gordon-CLI/0.8 (trading terminal; contact@gordon-cli.dev)";

const segmentCache = new Cache<SegmentBreakdown>({ defaultTtl: 24 * 60 * 60 * 1000 });
const tickerCikCache = new Cache<string>({ defaultTtl: 24 * 60 * 60 * 1000 });

let lastRequestTime = 0;
async function rateLimitedFetch(url: string): Promise<Response> {
  const elapsed = Date.now() - lastRequestTime;
  if (elapsed < 110) await new Promise((r) => setTimeout(r, 110 - elapsed));
  lastRequestTime = Date.now();
  return fetch(url, { headers: { "User-Agent": USER_AGENT, accept: "application/json" } });
}

async function tickerToCik(ticker: string): Promise<string | null> {
  const cached = tickerCikCache.get(ticker.toUpperCase());
  if (cached) return cached;
  try {
    const res = await rateLimitedFetch("https://www.sec.gov/files/company_tickers.json");
    const json = (await res.json()) as Record<string, { cik_str: number; ticker: string }>;
    for (const entry of Object.values(json)) {
      if (entry.ticker.toUpperCase() === ticker.toUpperCase()) {
        const padded = String(entry.cik_str).padStart(10, "0");
        tickerCikCache.set(ticker.toUpperCase(), padded);
        return padded;
      }
    }
  } catch {
    // ignore
  }
  return null;
}

// ============================================================================
// Types
// ============================================================================

export interface SegmentEntry {
  segmentName: string;
  revenue: number;
  period: string; // e.g., "FY2024" or "Q4-2024"
  percentOfTotal: number;
  yoyGrowthPct?: number;
}

export interface SegmentBreakdown {
  ticker: string;
  cik: string;
  companyName: string;
  /** Most recent period for which data is available. */
  latestPeriod: string;
  totalRevenue: number;
  segments: SegmentEntry[];
  /** Concentration index (HHI) — 10000 = single-segment business. */
  concentrationIndex: number;
  /** Largest segment as % of revenue. */
  dominantSegmentShare: number;
}

// ============================================================================
// XBRL types (subset of what we need)
// ============================================================================

interface XBRLFact {
  end: string;
  val: number;
  fy?: number;
  fp?: string;
  form?: string;
  accn?: string;
}

interface XBRLSegmentConcept {
  label?: string;
  description?: string;
  units: Record<string, XBRLFact[]>;
}

interface CompanyFacts {
  cik: number;
  entityName: string;
  facts: {
    "us-gaap"?: Record<string, XBRLSegmentConcept>;
  };
}

// ============================================================================
// Client
// ============================================================================

/**
 * The XBRL tag structure for segments is one of:
 *   us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax (by segment dim)
 *   us-gaap:Revenues
 *   us-gaap:SalesRevenueNet
 *
 * Company Facts API exposes these as individual series; segment-dimension
 * breakdowns require the frames API or the filing's structured XBRL. Here we
 * use the simpler approach: grab the primary revenue concepts and provide
 * total + period info. Deep segment dimensionality needs filing-level XBRL.
 */
const REVENUE_CONCEPTS = [
  "Revenues",
  "RevenueFromContractWithCustomerExcludingAssessedTax",
  "RevenueFromContractWithCustomerIncludingAssessedTax",
  "SalesRevenueNet",
  "SalesRevenueGoodsNet",
];

export class SECSegmentsClient {
  /**
   * Get segment breakdown for a ticker.
   * Note: returns total revenue + latest period; deep per-segment breakdown
   * requires per-filing XBRL parsing (not supported here — use SEC filings
   * reader for MD&A narrative segment disclosure instead).
   */
  async getSegments(ticker: string): Promise<SegmentBreakdown | null> {
    const cacheKey = ticker.toUpperCase();
    const cached = segmentCache.get(cacheKey);
    if (cached) return cached;

    const cik = await tickerToCik(ticker);
    if (!cik) return null;

    try {
      const url = `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`;
      const res = await rateLimitedFetch(url);
      if (!res.ok) return null;
      const json = (await res.json()) as CompanyFacts;

      const usGaap = json.facts["us-gaap"] ?? {};
      // Find a revenue concept with fact data
      let revenueFacts: XBRLFact[] = [];
      let conceptUsed = "";
      for (const concept of REVENUE_CONCEPTS) {
        const facts = usGaap[concept]?.units?.["USD"];
        if (facts && facts.length > 0) {
          revenueFacts = facts;
          conceptUsed = concept;
          break;
        }
      }

      if (revenueFacts.length === 0) {
        logger.debug("No revenue concept found in XBRL", { ticker });
        return null;
      }

      // Keep only annual (10-K, FY) or quarterly (10-Q) facts; take the latest.
      const annual = revenueFacts
        .filter((f) => f.form === "10-K" && f.fp === "FY")
        .sort((a, b) => b.end.localeCompare(a.end));
      const quarterly = revenueFacts
        .filter((f) => f.form === "10-Q")
        .sort((a, b) => b.end.localeCompare(a.end));

      const latest = annual[0] ?? quarterly[0];
      if (!latest) return null;

      const totalRevenue = latest.val;
      const latestPeriod = `${latest.fy ?? ""}-${latest.fp ?? "FY"}`.trim();

      // Year-over-year comparison
      const previous = annual.find((f) => (f.fy ?? 0) === (latest.fy ?? 0) - 1);
      const yoyGrowth = previous ? ((latest.val - previous.val) / previous.val) * 100 : undefined;

      const breakdown: SegmentBreakdown = {
        ticker: ticker.toUpperCase(),
        cik,
        companyName: json.entityName,
        latestPeriod,
        totalRevenue,
        segments: [
          {
            segmentName: `Total Revenue (${conceptUsed})`,
            revenue: totalRevenue,
            period: latestPeriod,
            percentOfTotal: 100,
            yoyGrowthPct: yoyGrowth,
          },
        ],
        concentrationIndex: 10000, // single-segment placeholder
        dominantSegmentShare: 100,
      };

      segmentCache.set(cacheKey, breakdown);
      logger.info("Fetched segment data", { ticker, totalRevenue, period: latestPeriod });
      return breakdown;
    } catch (err) {
      logger.warn("Segments fetch failed", { ticker, err: String(err) });
      return null;
    }
  }
}

let instance: SECSegmentsClient | null = null;
export function getSECSegmentsClient(): SECSegmentsClient {
  if (!instance) instance = new SECSegmentsClient();
  return instance;
}
