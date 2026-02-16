export type CircuitBreakerName =
  | "portfolio_drawdown"
  | "correlation_shock"
  | "liquidity_gap";

export interface CircuitBreakerTrigger {
  name: CircuitBreakerName;
  current: number;
  threshold: number;
  message: string;
}

export interface BaselineCircuitBreakerInput {
  portfolioDrawdownPercent: number;
  maxPortfolioDrawdownPercent: number;
  correlationShockPercent: number;
  maxCorrelationShockPercent: number;
  liquidityGapBps: number;
  maxLiquidityGapBps: number;
}

export interface BaselineCircuitBreakerResult {
  open: boolean;
  triggers: CircuitBreakerTrigger[];
}

export function evaluateBaselineCircuitBreakers(
  input: BaselineCircuitBreakerInput,
): BaselineCircuitBreakerResult {
  const triggers: CircuitBreakerTrigger[] = [];

  if (input.portfolioDrawdownPercent >= input.maxPortfolioDrawdownPercent) {
    triggers.push({
      name: "portfolio_drawdown",
      current: input.portfolioDrawdownPercent,
      threshold: input.maxPortfolioDrawdownPercent,
      message: "Portfolio drawdown threshold exceeded.",
    });
  }

  if (input.correlationShockPercent >= input.maxCorrelationShockPercent) {
    triggers.push({
      name: "correlation_shock",
      current: input.correlationShockPercent,
      threshold: input.maxCorrelationShockPercent,
      message: "Correlation shock threshold exceeded.",
    });
  }

  if (input.liquidityGapBps >= input.maxLiquidityGapBps) {
    triggers.push({
      name: "liquidity_gap",
      current: input.liquidityGapBps,
      threshold: input.maxLiquidityGapBps,
      message: "Liquidity gap threshold exceeded.",
    });
  }

  return {
    open: triggers.length > 0,
    triggers,
  };
}

