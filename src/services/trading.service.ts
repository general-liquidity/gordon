/**
 * Trading Service
 * High-level trading operations with validation and events
 */

import { getContainer } from "./container.ts";
import { emitEvent } from "../events/index.ts";
import {
  TradingModeError,
  InsufficientFundsError,
  PlanNotFoundError,
  InvalidPlanError,
  RiskLimitExceededError,
} from "../errors/index.ts";
import { createModuleLogger } from "../infra/logger/index.ts";
import type { Plan, Trade, GordonConfig } from "../types/index.ts";

const logger = createModuleLogger("trading");

/**
 * Trading service - orchestrates trading operations
 */
export class TradingService {
  /**
   * Validate a plan before execution
   */
  async validatePlan(plan: Plan, config: GordonConfig, portfolioValue: number): Promise<void> {
    // Check permissionMode allows trade execution
    if (config.permissionMode === "strict") {
      throw new TradingModeError("strict");
    }

    // Check allocation limits
    const allocationPercent = plan.allocation.percentOfPortfolio;
    if (allocationPercent > config.preferences.maxAllocationPerTrade) {
      throw new RiskLimitExceededError(
        "allocation",
        config.preferences.maxAllocationPerTrade,
        allocationPercent
      );
    }

    // Check position limits (default max 5 open positions)
    const container = getContainer();
    const openTrades = container.tradesRepo.findOpen();
    const maxOpenPositions = 5; // Could be added to config in future
    if (openTrades.length >= maxOpenPositions) {
      throw new RiskLimitExceededError(
        "positions",
        maxOpenPositions,
        openTrades.length
      );
    }

    // Check plan status
    if (plan.status !== "APPROVED") {
      throw new InvalidPlanError("Plan must be approved before execution", plan.id);
    }

    logger.debug("Plan validated successfully", { planId: plan.id });
  }

  /**
   * Check if we have sufficient funds
   */
  async checkFunds(required: number, currency: string = "USDT"): Promise<void> {
    const container = getContainer();
    const exchange = container.exchange;

    if (!exchange) {
      throw new Error("Exchange client not available");
    }

    const balance = await exchange.getBalance(currency);
    if (balance < required) {
      throw new InsufficientFundsError(required, balance, currency);
    }
  }

  /**
   * Create a new trading plan
   */
  async createPlan(plan: Plan): Promise<Plan> {
    const container = getContainer();
    const created = container.plansRepo.create(plan);

    await emitEvent("plan:created", { plan: created });
    logger.info("Plan created", { planId: created.id, symbol: created.symbol });

    return created;
  }

  /**
   * Approve a plan
   */
  async approvePlan(planId: string): Promise<Plan> {
    const container = getContainer();
    const plan = container.plansRepo.findById(planId);

    if (!plan) {
      throw new PlanNotFoundError(planId);
    }

    if (plan.status !== "DRAFT") {
      throw new InvalidPlanError(`Cannot approve plan in ${plan.status} status`, planId);
    }

    const approved = container.plansRepo.updateStatus(planId, "APPROVED");

    await emitEvent("plan:approved", { planId });
    logger.info("Plan approved", { planId });

    return approved;
  }

  /**
   * Cancel a plan
   */
  async cancelPlan(planId: string, reason?: string): Promise<Plan> {
    const container = getContainer();
    const plan = container.plansRepo.findById(planId);

    if (!plan) {
      throw new PlanNotFoundError(planId);
    }

    if (plan.status === "CLOSED" || plan.status === "CANCELLED") {
      throw new InvalidPlanError(`Cannot cancel plan in ${plan.status} status`, planId);
    }

    const cancelled = container.plansRepo.updateStatus(planId, "CANCELLED");

    await emitEvent("plan:cancelled", { planId, reason });
    logger.info("Plan cancelled", { planId, reason });

    return cancelled;
  }

  /**
   * Record trade opened
   */
  async recordTradeOpened(trade: Trade, planId: string): Promise<Trade> {
    const container = getContainer();
    const created = container.tradesRepo.create(trade);

    // Update plan status
    container.plansRepo.updateStatus(planId, "EXECUTING");

    await emitEvent("trade:opened", { trade: created, planId });
    logger.info("Trade opened", { tradeId: created.id, symbol: created.symbol });

    return created;
  }

  /**
   * Record trade closed
   */
  async recordTradeClosed(
    tradeId: string,
    reason: "MANUAL" | "STOP" | "TP1" | "TP2" | "TP3",
    pnl: number,
    pnlPercent: number
  ): Promise<Trade> {
    const container = getContainer();

    // Update trade
    let trade = container.tradesRepo.updateStatus(tradeId, "CLOSED", new Date().toISOString());
    trade = container.tradesRepo.updatePnl(tradeId, pnl, pnlPercent);

    // Update plan status
    container.plansRepo.updateStatus(trade.planId, "CLOSED");

    await emitEvent("trade:closed", { trade, reason, pnl, pnlPercent });
    logger.info("Trade closed", { tradeId, reason, pnl, pnlPercent });

    return trade;
  }

  /**
   * Get trading statistics
   */
  getStats() {
    const container = getContainer();
    return container.tradesRepo.getStats();
  }
}

// Default instance
let defaultService: TradingService | null = null;

export function getTradingService(): TradingService {
  if (!defaultService) {
    defaultService = new TradingService();
  }
  return defaultService;
}
