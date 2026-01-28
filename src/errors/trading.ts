/**
 * Trading-specific Error Classes
 */

import { GordonError, InvalidStateError } from "./base.ts";

/**
 * Error when there's not enough funds for a trade
 */
export class InsufficientFundsError extends GordonError {
  public readonly required: number;
  public readonly available: number;
  public readonly currency: string;

  constructor(
    required: number,
    available: number,
    currency: string = "USDT",
    context?: Record<string, unknown>
  ) {
    super(
      `Insufficient funds. Required: ${required} ${currency}, Available: ${available} ${currency}`,
      "INSUFFICIENT_FUNDS",
      { ...context, required, available, currency }
    );
    this.name = "InsufficientFundsError";
    this.required = required;
    this.available = available;
    this.currency = currency;
  }
}

/**
 * Error when a trading plan is invalid
 */
export class InvalidPlanError extends GordonError {
  public readonly planId?: string;
  public readonly reason: string;

  constructor(
    reason: string,
    planId?: string,
    context?: Record<string, unknown>
  ) {
    super(
      `Invalid trading plan${planId ? ` (${planId})` : ""}: ${reason}`,
      "INVALID_PLAN",
      { ...context, planId, reason }
    );
    this.name = "InvalidPlanError";
    this.planId = planId;
    this.reason = reason;
  }
}

/**
 * Error when trying to execute in wrong mode
 */
export class TradingModeError extends InvalidStateError {
  constructor(
    currentMode: "SAFE" | "ARMED",
    requiredMode: "SAFE" | "ARMED" = "ARMED",
    context?: Record<string, unknown>
  ) {
    super(
      `Cannot execute trade in ${currentMode} mode. System must be ${requiredMode}.`,
      currentMode,
      requiredMode,
      context
    );
    this.name = "TradingModeError";
  }
}

/**
 * Error when a plan is not found
 */
export class PlanNotFoundError extends GordonError {
  public readonly planId: string;

  constructor(planId: string, context?: Record<string, unknown>) {
    super(`Trading plan not found: ${planId}`, "PLAN_NOT_FOUND", { ...context, planId });
    this.name = "PlanNotFoundError";
    this.planId = planId;
  }
}

/**
 * Error when a trade is not found
 */
export class TradeNotFoundError extends GordonError {
  public readonly tradeId: string;

  constructor(tradeId: string, context?: Record<string, unknown>) {
    super(`Trade not found: ${tradeId}`, "TRADE_NOT_FOUND", { ...context, tradeId });
    this.name = "TradeNotFoundError";
    this.tradeId = tradeId;
  }
}

/**
 * Error when a trade cannot be modified
 */
export class TradeNotModifiableError extends InvalidStateError {
  public readonly tradeId: string;

  constructor(
    tradeId: string,
    currentStatus: string,
    context?: Record<string, unknown>
  ) {
    super(
      `Trade ${tradeId} cannot be modified in ${currentStatus} status`,
      currentStatus,
      "OPEN",
      { ...context, tradeId }
    );
    this.name = "TradeNotModifiableError";
    this.tradeId = tradeId;
  }
}

/**
 * Error when risk limits are exceeded
 */
export class RiskLimitExceededError extends GordonError {
  public readonly limitType: "allocation" | "positions" | "drawdown";
  public readonly limit: number;
  public readonly current: number;

  constructor(
    limitType: "allocation" | "positions" | "drawdown",
    limit: number,
    current: number,
    context?: Record<string, unknown>
  ) {
    const messages = {
      allocation: `Allocation limit exceeded. Max: ${limit * 100}%, Requested: ${current * 100}%`,
      positions: `Maximum open positions exceeded. Max: ${limit}, Current: ${current}`,
      drawdown: `Drawdown limit exceeded. Max: ${limit * 100}%, Current: ${current * 100}%`,
    };

    super(messages[limitType], "RISK_LIMIT_EXCEEDED", { ...context, limitType, limit, current });
    this.name = "RiskLimitExceededError";
    this.limitType = limitType;
    this.limit = limit;
    this.current = current;
  }
}

/**
 * Error when analysis fails
 */
export class AnalysisError extends GordonError {
  public readonly symbol: string;

  constructor(
    symbol: string,
    reason: string,
    context?: Record<string, unknown>
  ) {
    super(`Failed to analyze ${symbol}: ${reason}`, "ANALYSIS_ERROR", { ...context, symbol });
    this.name = "AnalysisError";
    this.symbol = symbol;
  }
}
