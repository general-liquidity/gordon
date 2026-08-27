/**
 * Fundamental-quality + working-capital ratios, and a CAPM/WACC discount-rate
 * builder (from the LangAlpha equity-research scan; grep-verified absent).
 *
 *  - computeFundamentalQuality: Rule of 40, FCF margin/conversion, and the
 *    DSO/DIO/DPO + cash-conversion-cycle working-capital triple — the standard
 *    quality screen that complements Gordon's forensic-accounting (Beneish/
 *    Altman/Piotroski/Sloan) and DCF tools.
 *  - computeWACC: CAPM cost-of-equity (Ke = rf + β·ERP) + after-tax cost of debt,
 *    market-weighted into WACC. `dcf.ts` consumes `wacc` as an input but didn't
 *    derive it — this is that missing input.
 *
 * All inputs optional where a statement line may be unavailable → the dependent
 * metric returns null rather than a wrong number. Pure; never throws.
 */

const round = (x: number, p = 4): number => parseFloat(x.toFixed(p));

export interface FundamentalQualityInput {
  /** Revenue over the period. */
  revenue: number;
  /** Period revenue growth %, OR supply priorRevenue to derive it. */
  revenueGrowthPct?: number;
  priorRevenue?: number;
  freeCashFlow?: number;
  operatingCashFlow?: number;
  netIncome?: number;
  cogs?: number;
  accountsReceivable?: number;
  inventory?: number;
  accountsPayable?: number;
  /** Days in the period (annual = 365). Default 365. */
  daysInPeriod?: number;
}

export interface FundamentalQualityResult {
  /** Rule of 40: revenue-growth% + FCF-margin% (≥40 = healthy growth/profitability balance). */
  ruleOf40: number | null;
  ruleOf40Pass: boolean;
  revenueGrowthPct: number | null;
  fcfMarginPct: number | null;
  /** FCF / net income — cash backing of earnings (>1 = conservative). */
  fcfConversion: number | null;
  /** FCF / operating cash flow — share of operating cash left after capex. */
  fcfToOcf: number | null;
  dso: number | null;
  dio: number | null;
  dpo: number | null;
  /** DSO + DIO − DPO; lower (or negative) = stronger working-capital position. */
  cashConversionCycle: number | null;
  interpretation: string;
}

export function computeFundamentalQuality(
  input: FundamentalQualityInput,
): FundamentalQualityResult {
  const days = input.daysInPeriod && input.daysInPeriod > 0 ? input.daysInPeriod : 365;
  const rev = input.revenue;

  const growthPct =
    typeof input.revenueGrowthPct === "number"
      ? input.revenueGrowthPct
      : typeof input.priorRevenue === "number" && input.priorRevenue !== 0
        ? ((rev - input.priorRevenue) / Math.abs(input.priorRevenue)) * 100
        : null;

  const fcfMarginPct =
    typeof input.freeCashFlow === "number" && rev > 0 ? (input.freeCashFlow / rev) * 100 : null;
  const ruleOf40 = growthPct !== null && fcfMarginPct !== null ? growthPct + fcfMarginPct : null;

  const fcfConversion =
    typeof input.freeCashFlow === "number" &&
    typeof input.netIncome === "number" &&
    input.netIncome !== 0
      ? input.freeCashFlow / input.netIncome
      : null;
  const fcfToOcf =
    typeof input.freeCashFlow === "number" &&
    typeof input.operatingCashFlow === "number" &&
    input.operatingCashFlow !== 0
      ? input.freeCashFlow / input.operatingCashFlow
      : null;

  const dso =
    typeof input.accountsReceivable === "number" && rev > 0
      ? (input.accountsReceivable / rev) * days
      : null;
  const dio =
    typeof input.inventory === "number" && input.cogs && input.cogs > 0
      ? (input.inventory / input.cogs) * days
      : null;
  const dpo =
    typeof input.accountsPayable === "number" && input.cogs && input.cogs > 0
      ? (input.accountsPayable / input.cogs) * days
      : null;
  const ccc = dso !== null && dio !== null && dpo !== null ? dso + dio - dpo : null;

  const parts: string[] = [];
  if (ruleOf40 !== null)
    parts.push(
      `Rule-of-40 ${round(ruleOf40, 1)} (${ruleOf40 >= 40 ? "PASS" : "fail"}: ${round(growthPct!, 1)}% growth + ${round(fcfMarginPct!, 1)}% FCF margin)`,
    );
  if (fcfConversion !== null)
    parts.push(
      `FCF/NI ${round(fcfConversion, 2)}${fcfConversion < 0.8 ? " (low — accrual-heavy earnings)" : ""}`,
    );
  if (ccc !== null)
    parts.push(
      `CCC ${round(ccc, 0)}d${ccc < 0 ? " (negative — collects before paying, strong)" : ""}`,
    );
  const interpretation = parts.length
    ? parts.join("; ")
    : "insufficient statement inputs for any quality ratio";

  return {
    ruleOf40: ruleOf40 !== null ? round(ruleOf40, 2) : null,
    ruleOf40Pass: ruleOf40 !== null && ruleOf40 >= 40,
    revenueGrowthPct: growthPct !== null ? round(growthPct, 2) : null,
    fcfMarginPct: fcfMarginPct !== null ? round(fcfMarginPct, 2) : null,
    fcfConversion: fcfConversion !== null ? round(fcfConversion, 3) : null,
    fcfToOcf: fcfToOcf !== null ? round(fcfToOcf, 3) : null,
    dso: dso !== null ? round(dso, 1) : null,
    dio: dio !== null ? round(dio, 1) : null,
    dpo: dpo !== null ? round(dpo, 1) : null,
    cashConversionCycle: ccc !== null ? round(ccc, 1) : null,
    interpretation,
  };
}

export interface WACCInput {
  /** Risk-free rate (decimal, e.g. 0.04). */
  riskFreeRate: number;
  beta: number;
  /** Equity risk premium (decimal, e.g. 0.05). */
  equityRiskPremium: number;
  /** Market value of equity (E). */
  marketCapEquity: number;
  /** Market value of debt (D). */
  marketValueDebt: number;
  /** Pre-tax cost of debt (decimal). */
  costOfDebt: number;
  /** Marginal tax rate (decimal). */
  taxRate: number;
  /** Optional size/country premium added to cost of equity. */
  additionalPremium?: number;
}

export interface WACCResult {
  costOfEquity: number;
  afterTaxCostOfDebt: number;
  weightEquity: number;
  weightDebt: number;
  wacc: number;
  valid: boolean;
  interpretation: string;
}

export function computeWACC(input: WACCInput): WACCResult {
  const {
    riskFreeRate: rf,
    beta,
    equityRiskPremium: erp,
    marketCapEquity: E,
    marketValueDebt: D,
    costOfDebt: kd,
    taxRate: t,
  } = input;
  const invalid = (reason: string): WACCResult => ({
    costOfEquity: 0,
    afterTaxCostOfDebt: 0,
    weightEquity: 0,
    weightDebt: 0,
    wacc: 0,
    valid: false,
    interpretation: reason,
  });
  if (!(E >= 0) || !(D >= 0) || E + D <= 0)
    return invalid("need marketCapEquity, marketValueDebt ≥ 0 with E+D > 0");

  const costOfEquity = rf + beta * erp + (input.additionalPremium ?? 0);
  const afterTaxKd = kd * (1 - t);
  const total = E + D;
  const wE = E / total;
  const wD = D / total;
  const wacc = wE * costOfEquity + wD * afterTaxKd;

  return {
    costOfEquity: round(costOfEquity, 5),
    afterTaxCostOfDebt: round(afterTaxKd, 5),
    weightEquity: round(wE, 4),
    weightDebt: round(wD, 4),
    wacc: round(wacc, 5),
    valid: true,
    interpretation: `WACC ${round(wacc * 100, 2)}% = ${round(wE * 100, 0)}%·Ke(${round(costOfEquity * 100, 2)}%) + ${round(wD * 100, 0)}%·Kd_aftertax(${round(afterTaxKd * 100, 2)}%) — feed into dcf as the discount rate`,
  };
}
