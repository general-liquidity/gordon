/**
 * Scenario-Based Valuation (Bear/Base/Bull DCF)
 *
 * Runs 3 DCF scenarios with different growth assumptions, returns a
 * valuation range. Answers "Is this stock cheap?" with a range, not
 * a single number.
 *
 * From AI Hedge Fund's Valuation Agent: DCF + Owner Earnings + EV/EBITDA.
 * Gordon adaptation: simplified to work with Yahoo Finance fundamentals.
 */

// ============================================================================
// Types
// ============================================================================

export interface DCFInputs {
  /** Free cash flow (trailing 12 months). */
  fcfTtm: number;
  /** Shares outstanding. */
  sharesOutstanding: number;
  /** Current stock price. */
  currentPrice: number;
  /** Weighted average cost of capital (decimal, e.g., 0.10 = 10%). */
  wacc?: number;
  /** Terminal growth rate (decimal, default 0.03 = 3%). */
  terminalGrowthRate?: number;
  /** Projection years (default 10). */
  projectionYears?: number;
  /** Net debt (total debt - cash). */
  netDebt?: number;
}

export interface ScenarioAssumptions {
  /** FCF growth rate for years 1-5. */
  nearTermGrowth: number;
  /** FCF growth rate for years 6-10. */
  longTermGrowth: number;
  /** Label for this scenario. */
  label: string;
}

export interface ScenarioResult {
  label: string;
  intrinsicValuePerShare: number;
  upsidePct: number;
  assumptions: ScenarioAssumptions;
  /** Enterprise value from DCF. */
  enterpriseValue: number;
  /** Present value of projected FCFs. */
  pvOfCashFlows: number;
  /** Present value of terminal value. */
  pvOfTerminal: number;
}

export interface ValuationResult {
  symbol: string;
  currentPrice: number;
  scenarios: {
    bear: ScenarioResult;
    base: ScenarioResult;
    bull: ScenarioResult;
  };
  /** Weighted fair value (20% bear, 60% base, 20% bull). */
  weightedFairValue: number;
  /** Weighted upside/downside percentage. */
  weightedUpsidePct: number;
  /** Margin of safety (weighted fair value vs current price). */
  marginOfSafety: number;
  /** Signal based on margin of safety. */
  signal: "undervalued" | "fairly_valued" | "overvalued";
  confidence: number;
}

// ============================================================================
// DCF Engine
// ============================================================================

/**
 * Run a single DCF scenario.
 */
function runDCF(
  inputs: DCFInputs,
  scenario: ScenarioAssumptions,
): ScenarioResult {
  const wacc = inputs.wacc ?? 0.10;
  const terminalGrowth = inputs.terminalGrowthRate ?? 0.03;
  const years = inputs.projectionYears ?? 10;
  const midpoint = Math.floor(years / 2);

  // Project free cash flows
  let fcf = inputs.fcfTtm;
  let pvOfCashFlows = 0;

  for (let year = 1; year <= years; year++) {
    const growthRate = year <= midpoint ? scenario.nearTermGrowth : scenario.longTermGrowth;
    fcf *= (1 + growthRate);
    pvOfCashFlows += fcf / Math.pow(1 + wacc, year);
  }

  // Terminal value (Gordon Growth Model)
  const terminalFCF = fcf * (1 + terminalGrowth);
  const terminalValue = terminalFCF / (wacc - terminalGrowth);
  const pvOfTerminal = terminalValue / Math.pow(1 + wacc, years);

  // Enterprise value → equity value → per share
  const enterpriseValue = pvOfCashFlows + pvOfTerminal;
  const equityValue = enterpriseValue - (inputs.netDebt ?? 0);
  const intrinsicValuePerShare = Math.max(0, equityValue / inputs.sharesOutstanding);
  const upsidePct = ((intrinsicValuePerShare - inputs.currentPrice) / inputs.currentPrice) * 100;

  return {
    label: scenario.label,
    intrinsicValuePerShare,
    upsidePct,
    assumptions: scenario,
    enterpriseValue,
    pvOfCashFlows,
    pvOfTerminal,
  };
}

/**
 * Run bear/base/bull DCF scenarios and compute weighted fair value.
 */
export function runScenarioValuation(
  symbol: string,
  inputs: DCFInputs,
  customScenarios?: { bear?: Partial<ScenarioAssumptions>; base?: Partial<ScenarioAssumptions>; bull?: Partial<ScenarioAssumptions> },
): ValuationResult {
  const bear: ScenarioAssumptions = {
    label: "Bear",
    nearTermGrowth: customScenarios?.bear?.nearTermGrowth ?? -0.05,
    longTermGrowth: customScenarios?.bear?.longTermGrowth ?? 0.01,
  };
  const base: ScenarioAssumptions = {
    label: "Base",
    nearTermGrowth: customScenarios?.base?.nearTermGrowth ?? 0.08,
    longTermGrowth: customScenarios?.base?.longTermGrowth ?? 0.04,
  };
  const bull: ScenarioAssumptions = {
    label: "Bull",
    nearTermGrowth: customScenarios?.bull?.nearTermGrowth ?? 0.18,
    longTermGrowth: customScenarios?.bull?.longTermGrowth ?? 0.08,
  };

  const bearResult = runDCF(inputs, bear);
  const baseResult = runDCF(inputs, base);
  const bullResult = runDCF(inputs, bull);

  // Weighted fair value: 20% bear, 60% base, 20% bull
  const weightedFairValue =
    bearResult.intrinsicValuePerShare * 0.2 +
    baseResult.intrinsicValuePerShare * 0.6 +
    bullResult.intrinsicValuePerShare * 0.2;

  const weightedUpsidePct = ((weightedFairValue - inputs.currentPrice) / inputs.currentPrice) * 100;
  const marginOfSafety = weightedUpsidePct;

  let signal: ValuationResult["signal"];
  let confidence: number;

  if (marginOfSafety > 25) {
    signal = "undervalued";
    confidence = Math.min(95, 60 + marginOfSafety);
  } else if (marginOfSafety > -10) {
    signal = "fairly_valued";
    confidence = 50;
  } else {
    signal = "overvalued";
    confidence = Math.min(95, 60 + Math.abs(marginOfSafety));
  }

  return {
    symbol,
    currentPrice: inputs.currentPrice,
    scenarios: { bear: bearResult, base: baseResult, bull: bullResult },
    weightedFairValue,
    weightedUpsidePct,
    marginOfSafety,
    signal,
    confidence,
  };
}
