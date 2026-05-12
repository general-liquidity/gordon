/**
 * Finnhub Fundamentals, Analyst, Ownership & Alt-Data Tools
 *
 * Second batch of Finnhub tools beyond the core events set. Covers:
 * company fundamentals (profile, financials, peers, dividends, splits,
 * earnings surprises, revenue estimates), analyst surface (price target,
 * upgrade/downgrade, insider sentiment, social sentiment), ownership
 * (fund + institutional), alt-data (lobbying, US spending, USPTO patents,
 * H1-B visa applications, supply chain, ESG, earnings call transcripts),
 * and IPO calendar.
 *
 * Many of these are premium Finnhub endpoints — tools degrade gracefully
 * when the key is missing or the tier is insufficient.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { finnhub, isFinnhubConfigured, FINNHUB_NOT_CONFIGURED_MSG } from "../../../data/providers/finnhub.ts";

function unconfigured<T extends Record<string, unknown>>(extra: T): T & { configured: false; error: string } {
  return { ...extra, configured: false as const, error: FINNHUB_NOT_CONFIGURED_MSG };
}

function daysFromNow(days: number): string {
  const d = new Date(Date.now() + days * 86_400_000);
  return d.toISOString().slice(0, 10);
}

// ============================================================================
// Company Profile
// ============================================================================

export const getCompanyProfileTool = createTool({
  id: "get_company_profile",
  description:
    "Company profile: name, exchange, country, currency, market cap, shares " +
    "outstanding, IPO date, industry, logo, website. Foundational tool for " +
    "any stock due-diligence workflow.",
  inputSchema: z.object({ symbol: z.string() }),
  outputSchema: z.object({
    configured: z.boolean(),
    symbol: z.string(),
    profile: z.record(z.string(), z.any()).optional(),
    error: z.string().optional(),
  }),
  execute: async ({ symbol }) => {
    if (!isFinnhubConfigured()) return unconfigured({ symbol });
    const profile = await finnhub.getCompanyProfile(symbol);
    if (!profile) return { configured: true, symbol, error: "No profile data" };
    return { configured: true, symbol, profile: profile as unknown as Record<string, unknown> };
  },
});

// ============================================================================
// Basic Financials (metrics)
// ============================================================================

export const getBasicFinancialsTool = createTool({
  id: "get_basic_financials",
  description:
    "Fundamental ratios and metrics for a stock: P/E, P/B, P/S, EV/EBITDA, " +
    "ROE, ROA, profit margins, debt ratios, growth rates, 52-week high/low, " +
    "beta. Use for valuation screens and pre-trade fundamental sanity checks.",
  inputSchema: z.object({
    symbol: z.string(),
    metric: z.enum(["all", "price", "valuation", "margin", "management"]).optional().default("all"),
  }),
  outputSchema: z.object({
    configured: z.boolean(),
    symbol: z.string(),
    metrics: z.record(z.string(), z.any()).optional(),
    error: z.string().optional(),
  }),
  execute: async ({ symbol, metric }) => {
    if (!isFinnhubConfigured()) return unconfigured({ symbol });
    const financials = await finnhub.getBasicFinancials(symbol, metric);
    if (!financials) return { configured: true, symbol, error: "No financials data" };
    return { configured: true, symbol, metrics: financials.metric };
  },
});

// ============================================================================
// Financials Reported (raw from filings)
// ============================================================================

export const getFinancialsReportedTool = createTool({
  id: "get_financials_reported",
  description:
    "Financial statements as reported to the SEC (10-K / 10-Q). Returns raw " +
    "line items exactly as filed — useful for custom ratio construction or " +
    "when you need the underlying numbers rather than pre-calculated metrics.",
  inputSchema: z.object({
    symbol: z.string(),
    freq: z.enum(["annual", "quarterly"]).optional().default("annual"),
  }),
  outputSchema: z.object({
    configured: z.boolean(),
    symbol: z.string(),
    total: z.number(),
    reports: z.array(z.any()).optional(),
    error: z.string().optional(),
  }),
  execute: async ({ symbol, freq }) => {
    if (!isFinnhubConfigured()) return unconfigured({ symbol, total: 0 });
    const data = await finnhub.getFinancialsReported(symbol, { freq });
    if (!data) return { configured: true, symbol, total: 0, error: "No financial reports" };
    return { configured: true, symbol, total: data.data.length, reports: data.data };
  },
});

// ============================================================================
// Earnings Surprises
// ============================================================================

export const getEarningsSurprisesTool = createTool({
  id: "get_earnings_surprises",
  description:
    "Historical earnings surprise results for a symbol — actual vs estimate " +
    "EPS per quarter with surprise percent. Use for scoring earnings " +
    "reliability (does this company beat or miss consistently?) and for " +
    "earnings-play setups.",
  inputSchema: z.object({ symbol: z.string() }),
  outputSchema: z.object({
    configured: z.boolean(),
    symbol: z.string(),
    total: z.number(),
    surprises: z.array(z.any()).optional(),
    beatRate: z.number().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ symbol }) => {
    if (!isFinnhubConfigured()) return unconfigured({ symbol, total: 0 });
    const surprises = await finnhub.getEarningsSurprises(symbol);
    const beats = surprises.filter((s) => (s.actual ?? 0) >= (s.estimate ?? 0)).length;
    const beatRate = surprises.length > 0 ? beats / surprises.length : 0;
    return { configured: true, symbol, total: surprises.length, surprises, beatRate };
  },
});

// ============================================================================
// Revenue Estimates
// ============================================================================

export const getRevenueEstimatesTool = createTool({
  id: "get_revenue_estimates",
  description:
    "Analyst consensus revenue estimates for a symbol by period (quarterly " +
    "or annual). Returns avg / high / low / analyst count. Complements " +
    "get_earnings_estimates with the top-line picture.",
  inputSchema: z.object({
    symbol: z.string(),
    freq: z.enum(["quarterly", "annual"]).optional().default("quarterly"),
  }),
  outputSchema: z.object({
    configured: z.boolean(),
    symbol: z.string(),
    total: z.number(),
    estimates: z.array(z.any()).optional(),
    error: z.string().optional(),
  }),
  execute: async ({ symbol, freq }) => {
    if (!isFinnhubConfigured()) return unconfigured({ symbol, total: 0 });
    const estimates = await finnhub.getRevenueEstimates(symbol, freq);
    return { configured: true, symbol, total: estimates.length, estimates };
  },
});

// ============================================================================
// Peer Companies
// ============================================================================

export const getPeerCompaniesTool = createTool({
  id: "get_peer_companies",
  description:
    "Peer companies for a symbol — list of comparable tickers in the same " +
    "industry, sector, or sub-industry. Use for pairs/comps analysis, " +
    "relative valuation, and building sector baskets.",
  inputSchema: z.object({
    symbol: z.string(),
    grouping: z.enum(["industry", "sector", "subIndustry"]).optional().default("industry"),
  }),
  outputSchema: z.object({
    configured: z.boolean(),
    symbol: z.string(),
    grouping: z.string(),
    peers: z.array(z.string()).optional(),
    error: z.string().optional(),
  }),
  execute: async ({ symbol, grouping }) => {
    if (!isFinnhubConfigured()) return unconfigured({ symbol, grouping: grouping ?? "industry" });
    const peers = await finnhub.getPeerCompanies(symbol, grouping);
    return { configured: true, symbol, grouping: grouping ?? "industry", peers };
  },
});

// ============================================================================
// Dividends
// ============================================================================

export const getDividendsTool = createTool({
  id: "get_dividends",
  description:
    "Historical dividend payments for a symbol: amount, ex-date, pay date, " +
    "record date. Use for income strategies, dividend-capture setups, and " +
    "avoiding ex-date shock on long positions.",
  inputSchema: z.object({
    symbol: z.string(),
    daysBack: z.number().int().min(1).max(3650).optional().default(730),
  }),
  outputSchema: z.object({
    configured: z.boolean(),
    symbol: z.string(),
    total: z.number(),
    dividends: z.array(z.any()).optional(),
    error: z.string().optional(),
  }),
  execute: async ({ symbol, daysBack }) => {
    if (!isFinnhubConfigured()) return unconfigured({ symbol, total: 0 });
    const divs = await finnhub.getDividends(symbol, {
      from: daysFromNow(-(daysBack ?? 730)),
      to: daysFromNow(30),
    });
    return { configured: true, symbol, total: divs.length, dividends: divs };
  },
});

// ============================================================================
// Splits
// ============================================================================

export const getSplitsTool = createTool({
  id: "get_stock_splits",
  description:
    "Historical stock splits for a symbol: date, from-factor, to-factor. " +
    "Important for normalizing historical prices in backtests and avoiding " +
    "false signal generation across split boundaries.",
  inputSchema: z.object({
    symbol: z.string(),
    daysBack: z.number().int().min(1).max(7300).optional().default(3650),
  }),
  outputSchema: z.object({
    configured: z.boolean(),
    symbol: z.string(),
    total: z.number(),
    splits: z.array(z.any()).optional(),
    error: z.string().optional(),
  }),
  execute: async ({ symbol, daysBack }) => {
    if (!isFinnhubConfigured()) return unconfigured({ symbol, total: 0 });
    const splits = await finnhub.getSplits(symbol, {
      from: daysFromNow(-(daysBack ?? 3650)),
      to: daysFromNow(0),
    });
    return { configured: true, symbol, total: splits.length, splits };
  },
});

// ============================================================================
// Price Target
// ============================================================================

export const getPriceTargetTool = createTool({
  id: "get_price_target",
  description:
    "Analyst price target consensus for a symbol: mean, median, high, low, " +
    "last updated. Pair with current quote to compute implied upside/downside.",
  inputSchema: z.object({ symbol: z.string() }),
  outputSchema: z.object({
    configured: z.boolean(),
    symbol: z.string(),
    target: z.record(z.string(), z.any()).optional(),
    error: z.string().optional(),
  }),
  execute: async ({ symbol }) => {
    if (!isFinnhubConfigured()) return unconfigured({ symbol });
    const target = await finnhub.getPriceTarget(symbol);
    if (!target) return { configured: true, symbol, error: "No price target data" };
    return { configured: true, symbol, target: target as unknown as Record<string, unknown> };
  },
});

// ============================================================================
// Upgrade / Downgrade
// ============================================================================

export const getUpgradeDowngradeTool = createTool({
  id: "get_upgrade_downgrade",
  description:
    "Analyst upgrade/downgrade history for a symbol. Returns from-grade, " +
    "to-grade, action (up/down/main/init), issuing company, and timestamp. " +
    "Use for momentum plays around rating changes and detecting analyst " +
    "consensus shifts.",
  inputSchema: z.object({
    symbol: z.string(),
    daysBack: z.number().int().min(1).max(365).optional().default(90),
  }),
  outputSchema: z.object({
    configured: z.boolean(),
    symbol: z.string(),
    total: z.number(),
    changes: z.array(z.any()).optional(),
    error: z.string().optional(),
  }),
  execute: async ({ symbol, daysBack }) => {
    if (!isFinnhubConfigured()) return unconfigured({ symbol, total: 0 });
    const changes = await finnhub.getUpgradeDowngrade(symbol, {
      from: daysFromNow(-(daysBack ?? 90)),
      to: daysFromNow(0),
    });
    return { configured: true, symbol, total: changes.length, changes };
  },
});

// ============================================================================
// Insider Sentiment
// ============================================================================

export const getInsiderSentimentTool = createTool({
  id: "get_insider_sentiment",
  description:
    "Aggregate monthly insider sentiment for a symbol — change (net shares " +
    "traded) and MSPR (monthly share purchase ratio). MSPR > 0 means net " +
    "insider buying, MSPR < 0 means net insider selling. Premium Finnhub " +
    "endpoint.",
  inputSchema: z.object({
    symbol: z.string(),
    monthsBack: z.number().int().min(1).max(24).optional().default(12),
  }),
  outputSchema: z.object({
    configured: z.boolean(),
    symbol: z.string(),
    total: z.number(),
    sentiment: z.array(z.any()).optional(),
    error: z.string().optional(),
  }),
  execute: async ({ symbol, monthsBack }) => {
    if (!isFinnhubConfigured()) return unconfigured({ symbol, total: 0 });
    const sentiment = await finnhub.getInsiderSentiment(symbol, {
      from: daysFromNow(-(monthsBack ?? 12) * 30),
      to: daysFromNow(0),
    });
    return { configured: true, symbol, total: sentiment.length, sentiment };
  },
});

// ============================================================================
// Social Sentiment (Reddit + Twitter)
// ============================================================================

export const getSocialSentimentTool = createTool({
  id: "get_social_sentiment",
  description:
    "Social sentiment scores for a symbol across Reddit and Twitter: mention " +
    "count, positive/negative split, aggregate score. Use to detect retail " +
    "buzz spikes around specific tickers. Complements the X social " +
    "intelligence tools with Finnhub's aggregation.",
  inputSchema: z.object({
    symbol: z.string(),
    daysBack: z.number().int().min(1).max(30).optional().default(7),
  }),
  outputSchema: z.object({
    configured: z.boolean(),
    symbol: z.string(),
    reddit: z.array(z.any()).optional(),
    twitter: z.array(z.any()).optional(),
    error: z.string().optional(),
  }),
  execute: async ({ symbol, daysBack }) => {
    if (!isFinnhubConfigured()) return unconfigured({ symbol });
    const { reddit, twitter } = await finnhub.getSocialSentiment(symbol, {
      from: daysFromNow(-(daysBack ?? 7)),
      to: daysFromNow(0),
    });
    return { configured: true, symbol, reddit, twitter };
  },
});

// ============================================================================
// Fund Ownership
// ============================================================================

export const getFundOwnershipTool = createTool({
  id: "get_fund_ownership",
  description:
    "Mutual fund and ETF ownership for a symbol — fund name, share count, " +
    "change vs prior filing, portfolio percent. Use for spotting fund flow, " +
    "detecting which funds are accumulating or distributing a name.",
  inputSchema: z.object({
    symbol: z.string(),
    limit: z.number().int().min(1).max(100).optional().default(20),
  }),
  outputSchema: z.object({
    configured: z.boolean(),
    symbol: z.string(),
    total: z.number(),
    ownership: z.array(z.any()).optional(),
    error: z.string().optional(),
  }),
  execute: async ({ symbol, limit }) => {
    if (!isFinnhubConfigured()) return unconfigured({ symbol, total: 0 });
    const ownership = await finnhub.getFundOwnership(symbol, limit ?? 20);
    return { configured: true, symbol, total: ownership.length, ownership };
  },
});

// ============================================================================
// Institutional Ownership
// ============================================================================

export const getInstitutionalOwnershipTool = createTool({
  id: "get_institutional_ownership",
  description:
    "13F institutional ownership for a symbol — largest institutional holders " +
    "with share counts, value, and portfolio percentage. Sourced from most " +
    "recent 13F filings. Premium Finnhub endpoint.",
  inputSchema: z.object({
    symbol: z.string(),
    limit: z.number().int().min(1).max(100).optional().default(25),
  }),
  outputSchema: z.object({
    configured: z.boolean(),
    symbol: z.string(),
    total: z.number(),
    ownership: z.array(z.any()).optional(),
    error: z.string().optional(),
  }),
  execute: async ({ symbol, limit }) => {
    if (!isFinnhubConfigured()) return unconfigured({ symbol, total: 0 });
    const ownership = await finnhub.getInstitutionalOwnership(symbol, { limit });
    return { configured: true, symbol, total: ownership.length, ownership };
  },
});

// ============================================================================
// Lobbying
// ============================================================================

export const getLobbyingTool = createTool({
  id: "get_lobbying",
  description:
    "Federal lobbying disclosures for a symbol — registrant, issues, " +
    "expenses, and period. Use for regulatory / political risk surfacing. " +
    "Premium Finnhub endpoint.",
  inputSchema: z.object({
    symbol: z.string(),
    daysBack: z.number().int().min(1).max(1825).optional().default(365),
  }),
  outputSchema: z.object({
    configured: z.boolean(),
    symbol: z.string(),
    total: z.number(),
    records: z.array(z.any()).optional(),
    error: z.string().optional(),
  }),
  execute: async ({ symbol, daysBack }) => {
    if (!isFinnhubConfigured()) return unconfigured({ symbol, total: 0 });
    const records = await finnhub.getLobbying(symbol, {
      from: daysFromNow(-(daysBack ?? 365)),
      to: daysFromNow(0),
    });
    return { configured: true, symbol, total: records.length, records };
  },
});

// ============================================================================
// USA Government Spending
// ============================================================================

export const getUsaSpendingTool = createTool({
  id: "get_usa_spending",
  description:
    "US government contract awards and spending recipients tied to a symbol. " +
    "Useful for defense/gov-contractor names (LMT, RTX, BA, GD, NOC, etc.) " +
    "where government revenue is a major driver. Premium Finnhub endpoint.",
  inputSchema: z.object({
    symbol: z.string(),
    daysBack: z.number().int().min(1).max(1825).optional().default(365),
  }),
  outputSchema: z.object({
    configured: z.boolean(),
    symbol: z.string(),
    total: z.number(),
    contracts: z.array(z.any()).optional(),
    error: z.string().optional(),
  }),
  execute: async ({ symbol, daysBack }) => {
    if (!isFinnhubConfigured()) return unconfigured({ symbol, total: 0 });
    const contracts = await finnhub.getUsaSpending(symbol, {
      from: daysFromNow(-(daysBack ?? 365)),
      to: daysFromNow(0),
    });
    return { configured: true, symbol, total: contracts.length, contracts };
  },
});

// ============================================================================
// USPTO Patents
// ============================================================================

export const getUsptoPatentsTool = createTool({
  id: "get_uspto_patents",
  description:
    "USPTO patent filings for a symbol — application number, category, " +
    "filing date, description, patent type. Useful for R&D intensity tracking " +
    "and spotting innovation cadence for hardware / biotech / pharma names. " +
    "Premium Finnhub endpoint.",
  inputSchema: z.object({
    symbol: z.string(),
    daysBack: z.number().int().min(1).max(1825).optional().default(365),
  }),
  outputSchema: z.object({
    configured: z.boolean(),
    symbol: z.string(),
    total: z.number(),
    patents: z.array(z.any()).optional(),
    error: z.string().optional(),
  }),
  execute: async ({ symbol, daysBack }) => {
    if (!isFinnhubConfigured()) return unconfigured({ symbol, total: 0 });
    const patents = await finnhub.getUsptoPatents(symbol, {
      from: daysFromNow(-(daysBack ?? 365)),
      to: daysFromNow(0),
    });
    return { configured: true, symbol, total: patents.length, patents };
  },
});

// ============================================================================
// Visa Applications
// ============================================================================

export const getVisaApplicationsTool = createTool({
  id: "get_visa_applications",
  description:
    "H-1B / L-1 visa applications sponsored by the employer tied to a symbol. " +
    "Proxy for hiring velocity and talent strategy — a leading indicator for " +
    "capex/opex direction in tech names. Premium Finnhub endpoint.",
  inputSchema: z.object({
    symbol: z.string(),
    daysBack: z.number().int().min(1).max(730).optional().default(365),
  }),
  outputSchema: z.object({
    configured: z.boolean(),
    symbol: z.string(),
    total: z.number(),
    applications: z.array(z.any()).optional(),
    error: z.string().optional(),
  }),
  execute: async ({ symbol, daysBack }) => {
    if (!isFinnhubConfigured()) return unconfigured({ symbol, total: 0 });
    const applications = await finnhub.getVisaApplications(symbol, {
      from: daysFromNow(-(daysBack ?? 365)),
      to: daysFromNow(0),
    });
    return { configured: true, symbol, total: applications.length, applications };
  },
});

// ============================================================================
// Supply Chain
// ============================================================================

export const getSupplyChainTool = createTool({
  id: "get_supply_chain",
  description:
    "Supply-chain relationships for a symbol — suppliers and customers with " +
    "return correlation bands. Useful for detecting second-order exposure " +
    "(e.g. 'will NVDA weakness hit TSMC?'). Premium Finnhub endpoint.",
  inputSchema: z.object({ symbol: z.string() }),
  outputSchema: z.object({
    configured: z.boolean(),
    symbol: z.string(),
    suppliers: z.array(z.any()).optional(),
    customers: z.array(z.any()).optional(),
    error: z.string().optional(),
  }),
  execute: async ({ symbol }) => {
    if (!isFinnhubConfigured()) return unconfigured({ symbol });
    const { suppliers, customers } = await finnhub.getSupplyChain(symbol);
    return { configured: true, symbol, suppliers, customers };
  },
});

// ============================================================================
// ESG Score
// ============================================================================

export const getEsgScoreTool = createTool({
  id: "get_esg_score",
  description:
    "ESG scores for a symbol: total, environment, social, governance, and " +
    "risk rating. Relevant for ESG-constrained strategies and ESG-aware " +
    "portfolio screens.",
  inputSchema: z.object({ symbol: z.string() }),
  outputSchema: z.object({
    configured: z.boolean(),
    symbol: z.string(),
    esg: z.record(z.string(), z.any()).optional(),
    error: z.string().optional(),
  }),
  execute: async ({ symbol }) => {
    if (!isFinnhubConfigured()) return unconfigured({ symbol });
    const esg = await finnhub.getEsgScore(symbol);
    if (!esg) return { configured: true, symbol, error: "No ESG data" };
    return { configured: true, symbol, esg: esg as unknown as Record<string, unknown> };
  },
});

// ============================================================================
// Earnings Call Transcripts List
// ============================================================================

export const listTranscriptsTool = createTool({
  id: "list_earnings_transcripts",
  description:
    "List available earnings-call transcripts for a symbol. Returns transcript " +
    "IDs, titles, and quarter/year metadata. Use list_earnings_transcripts to " +
    "find IDs, then get_earnings_transcript to pull the full text.",
  inputSchema: z.object({ symbol: z.string() }),
  outputSchema: z.object({
    configured: z.boolean(),
    symbol: z.string(),
    total: z.number(),
    transcripts: z.array(z.any()).optional(),
    error: z.string().optional(),
  }),
  execute: async ({ symbol }) => {
    if (!isFinnhubConfigured()) return unconfigured({ symbol, total: 0 });
    const transcripts = await finnhub.listTranscripts(symbol);
    return { configured: true, symbol, total: transcripts.length, transcripts };
  },
});

// ============================================================================
// Earnings Call Transcript (full)
// ============================================================================

export const getTranscriptTool = createTool({
  id: "get_earnings_transcript",
  description:
    "Full earnings-call transcript for a specific transcript ID, including " +
    "participant list and per-speaker turns. Use for deep due-diligence and " +
    "extracting forward-guidance language. Premium Finnhub endpoint.",
  inputSchema: z.object({ id: z.string() }),
  outputSchema: z.object({
    configured: z.boolean(),
    transcript: z.record(z.string(), z.any()).optional(),
    error: z.string().optional(),
  }),
  execute: async ({ id }) => {
    if (!isFinnhubConfigured()) return unconfigured({});
    const transcript = await finnhub.getTranscript(id);
    if (!transcript) return { configured: true, error: "No transcript data" };
    return { configured: true, transcript: transcript as unknown as Record<string, unknown> };
  },
});

// ============================================================================
// IPO Calendar
// ============================================================================

export const getIpoCalendarTool = createTool({
  id: "get_ipo_calendar",
  description:
    "Upcoming and recent IPOs with date, exchange, symbol, price range, share " +
    "count, and status. Use for IPO-play positioning and tracking new " +
    "listings as they come to market.",
  inputSchema: z.object({
    daysAhead: z.number().int().min(1).max(60).optional().default(30),
    daysBack: z.number().int().min(0).max(60).optional().default(7),
  }),
  outputSchema: z.object({
    configured: z.boolean(),
    total: z.number(),
    ipos: z.array(z.any()).optional(),
    error: z.string().optional(),
  }),
  execute: async ({ daysAhead, daysBack }) => {
    if (!isFinnhubConfigured()) return unconfigured({ total: 0 });
    const ipos = await finnhub.getIpoCalendar({
      from: daysFromNow(-(daysBack ?? 7)),
      to: daysFromNow(daysAhead ?? 30),
    });
    return { configured: true, total: ipos.length, ipos };
  },
});

// ============================================================================
// Export
// ============================================================================

export const finnhubFundamentalsTools = {
  get_company_profile: getCompanyProfileTool,
  get_basic_financials: getBasicFinancialsTool,
  get_financials_reported: getFinancialsReportedTool,
  get_earnings_surprises: getEarningsSurprisesTool,
  get_revenue_estimates: getRevenueEstimatesTool,
  get_peer_companies: getPeerCompaniesTool,
  get_dividends: getDividendsTool,
  get_stock_splits: getSplitsTool,
  get_price_target: getPriceTargetTool,
  get_upgrade_downgrade: getUpgradeDowngradeTool,
  get_insider_sentiment: getInsiderSentimentTool,
  get_social_sentiment: getSocialSentimentTool,
  get_fund_ownership: getFundOwnershipTool,
  get_institutional_ownership: getInstitutionalOwnershipTool,
  get_lobbying: getLobbyingTool,
  get_usa_spending: getUsaSpendingTool,
  get_uspto_patents: getUsptoPatentsTool,
  get_visa_applications: getVisaApplicationsTool,
  get_supply_chain: getSupplyChainTool,
  get_esg_score: getEsgScoreTool,
  list_earnings_transcripts: listTranscriptsTool,
  get_earnings_transcript: getTranscriptTool,
  get_ipo_calendar: getIpoCalendarTool,
};
