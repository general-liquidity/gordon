/**
 * Fundamental ratios — ROIC / ROIIC + valuation multiples.
 *
 * Operator-friendly typed wrappers over arithmetic that the LLM
 * otherwise tends to mis-format or forget. The math is trivial; the
 * value is having one tool the LLM can call when it needs to surface
 * a ratio in the memo skill or DCF context.
 *
 * Sources of confusion this primitive removes:
 *   - ROIC: numerator is NOPAT (EBIT * (1 - tax_rate)), not net income
 *   - ROIIC: marginal ROIC on the LAST DOLLAR of invested capital,
 *            not lifetime average
 *   - EV: market cap + net debt (debt - cash), not just market cap
 *   - P/E: trailing or forward? we require the caller to pick
 *   - FCF yield: FCF/market cap, NOT FCF/enterprise value (different
 *                primitive — sometimes labelled "owner's yield")
 *
 * Missing inputs produce null outputs (not zeros, not throws) so the
 * caller can render a partial ratio sheet without false zeros.
 */

export interface FundamentalRatiosInput {
  /** EBIT for the period (operating income). For ROIC. */
  ebit?: number;
  /** Effective tax rate, decimal (e.g. 0.21 for 21%). For NOPAT. */
  taxRate?: number;
  /** Invested capital at period start (or average). For ROIC. */
  investedCapital?: number;
  /** Change in NOPAT period-over-period. For ROIIC. */
  deltaNopat?: number;
  /** Change in invested capital period-over-period. For ROIIC. */
  deltaInvestedCapital?: number;
  /** Stock price. */
  price?: number;
  /** Diluted shares outstanding. */
  sharesOutstanding?: number;
  /** Earnings per share. */
  eps?: number;
  /** EBITDA for the period. */
  ebitda?: number;
  /** Free cash flow for the period. */
  fcf?: number;
  /** Total book equity. For ROE. */
  bookEquity?: number;
  /** Net income for the period. For ROE. */
  netIncome?: number;
  /** Total debt. For EV. */
  totalDebt?: number;
  /** Cash + marketable securities. For EV. */
  cashAndEquivalents?: number;
}

export interface FundamentalRatiosResult {
  /** Net cash position. cashAndEquivalents - totalDebt. null if
   *  either input is missing. */
  netCash: number | null;
  /** Market cap. price * sharesOutstanding. null if either missing. */
  marketCap: number | null;
  /** Enterprise value. marketCap + totalDebt - cashAndEquivalents.
   *  null if any input missing. */
  enterpriseValue: number | null;
  /** Net Operating Profit After Tax. ebit * (1 - taxRate). */
  nopat: number | null;
  /** Return On Invested Capital. nopat / investedCapital. */
  roic: number | null;
  /** Return On Incremental Invested Capital.
   *  deltaNopat / deltaInvestedCapital. */
  roiic: number | null;
  /** Return On Equity. netIncome / bookEquity. */
  roe: number | null;
  /** Price-to-Earnings. price / eps. */
  peRatio: number | null;
  /** EV / EBITDA. enterpriseValue / ebitda. */
  evToEbitda: number | null;
  /** Free Cash Flow yield. fcf / marketCap. */
  fcfYield: number | null;
  /** One-line summary surfacing what was computed. */
  interpretation: string;
}

function safeRatio(num: number | undefined, denom: number | undefined): number | null {
  if (num == null || denom == null) return null;
  if (!Number.isFinite(num) || !Number.isFinite(denom)) return null;
  if (denom === 0) return null;
  return num / denom;
}

function safeDiff(a: number | undefined, b: number | undefined): number | null {
  if (a == null || b == null) return null;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return a - b;
}

export function computeFundamentalRatios(input: FundamentalRatiosInput): FundamentalRatiosResult {
  const netCash = safeDiff(input.cashAndEquivalents, input.totalDebt);
  const marketCap =
    input.price != null && input.sharesOutstanding != null
      ? input.price * input.sharesOutstanding
      : null;
  const enterpriseValue =
    marketCap != null && input.totalDebt != null && input.cashAndEquivalents != null
      ? marketCap + input.totalDebt - input.cashAndEquivalents
      : null;

  const nopat =
    input.ebit != null && input.taxRate != null ? input.ebit * (1 - input.taxRate) : null;
  const roic = safeRatio(nopat ?? undefined, input.investedCapital);
  const roiic = safeRatio(input.deltaNopat, input.deltaInvestedCapital);
  const roe = safeRatio(input.netIncome, input.bookEquity);
  const peRatio = safeRatio(input.price, input.eps);
  const evToEbitda = safeRatio(enterpriseValue ?? undefined, input.ebitda);
  const fcfYield = safeRatio(input.fcf, marketCap ?? undefined);

  // Surface what was actually computable — missing inputs produce
  // null fields, and the interpretation calls out the relevant ones.
  const parts: string[] = [];
  if (roic != null) parts.push(`ROIC ${(roic * 100).toFixed(1)}%`);
  if (roiic != null) parts.push(`ROIIC ${(roiic * 100).toFixed(1)}%`);
  if (roe != null) parts.push(`ROE ${(roe * 100).toFixed(1)}%`);
  if (peRatio != null) parts.push(`P/E ${peRatio.toFixed(1)}x`);
  if (evToEbitda != null) parts.push(`EV/EBITDA ${evToEbitda.toFixed(1)}x`);
  if (fcfYield != null) parts.push(`FCF yield ${(fcfYield * 100).toFixed(2)}%`);
  const interpretation =
    parts.length > 0 ? parts.join(" | ") : "No ratios computable from supplied inputs.";

  return {
    netCash,
    marketCap,
    enterpriseValue,
    nopat,
    roic,
    roiic,
    roe,
    peRatio,
    evToEbitda,
    fcfYield,
    interpretation,
  };
}
