/**
 * Position Manager
 * High-level API that agents interact with to drive positions through their lifecycle.
 *
 * Each method maps to a specific agent action:
 *   Scanner  -> reportSetup()
 *   Analyst  -> reportAnalysis()
 *   Planner  -> reportPlan()
 *   User     -> approve()
 *   Executor -> reportOrdered(), reportFilled()
 *   Monitor  -> updateLive(), initiateClose()
 *   Teacher  -> reportReview()
 *
 * Internally delegates to PositionStateMachine for state enforcement and event emission.
 */

import { createModuleLogger } from "../../infra/logger/index.ts";
import type { EventBus } from "../../events/bus.ts";
import { PositionStateMachine } from "./state-machine.ts";
import {
  TERMINAL_STATES,
  type PositionRecord,
  type PositionState,
  type SetupSignal,
  type AnalysisResult,
  type TradePlan,
  type RiskDecision,
  type OrderRecord,
  type FillData,
  type LivePositionData,
  type CloseData,
  type TradeReview,
  type HistoryOptions,
  type PositionSummary,
} from "./types.ts";
import { PositionStore, getPositionStore } from "./store.ts";

const logger = createModuleLogger("position-manager");

export class PositionManager {
  private sm: PositionStateMachine;
  private store: PositionStore;

  constructor(
    private stateMachine: PositionStateMachine,
    private bus: EventBus,
    store: PositionStore
  ) {
    this.sm = stateMachine;
    this.store = store;
  }

  // ==========================================================================
  // Lifecycle Methods (ordered by typical flow)
  // ==========================================================================

  /**
   * Scanner calls this when it finds a setup.
   * Creates a new position in the 'idea' state.
   */
  async reportSetup(signal: SetupSignal): Promise<PositionRecord> {
    logger.info("Setup reported", { symbol: signal.symbol, strategy: signal.strategy });

    const position = await this.sm.create({
      symbol: signal.symbol,
      exchangeId: "default", // Can be overridden later
      side: "long",          // Default; will be refined by Analyst/Planner
      setupSignal: signal,
      strategyId: signal.strategy,
    });

    return position;
  }

  /**
   * Analyst calls this with analysis results.
   * Transitions: idea -> analyzed
   */
  async reportAnalysis(
    positionId: string,
    analysis: AnalysisResult
  ): Promise<PositionRecord> {
    logger.info("Analysis reported", { positionId, bias: analysis.bias });

    return this.sm.transition(
      positionId,
      "analyzed",
      { analysis },
      undefined,
      "Analyst"
    );
  }

  /**
   * Planner calls this with the trade plan.
   * Transitions: analyzed -> planned
   */
  async reportPlan(
    positionId: string,
    plan: TradePlan
  ): Promise<PositionRecord> {
    logger.info("Plan reported", {
      positionId,
      entry: plan.entry,
      stopLoss: plan.stopLoss,
      takeProfits: plan.takeProfits,
    });

    return this.sm.transition(
      positionId,
      "planned",
      {
        plan,
        stopLoss: plan.stopLoss,
        takeProfit: plan.takeProfits[0],
      },
      undefined,
      "Planner"
    );
  }

  /**
   * User approves the trade (or risk kernel auto-approves in paper mode).
   * Transitions: planned -> approved
   */
  async approve(positionId: string): Promise<PositionRecord> {
    logger.info("Position approved", { positionId });

    return this.sm.transition(
      positionId,
      "approved",
      {
        riskDecision: {
          approved: true,
          reason: "User approved",
          timestamp: new Date().toISOString(),
        },
      },
      "User approved",
      "User"
    );
  }

  /**
   * Risk kernel rejects the trade.
   * Transitions: planned -> rejected
   */
  async reject(positionId: string, reason: string): Promise<PositionRecord> {
    logger.info("Position rejected", { positionId, reason });

    return this.sm.transition(
      positionId,
      "rejected",
      {
        rejectReason: reason,
        riskDecision: {
          approved: false,
          reason,
          timestamp: new Date().toISOString(),
        },
      },
      reason,
      "RiskKernel"
    );
  }

  /**
   * Executor reports order placed on exchange.
   * Transitions: approved -> ordering
   */
  async reportOrdered(
    positionId: string,
    order: OrderRecord
  ): Promise<PositionRecord> {
    logger.info("Order placed", { positionId, orderId: order.orderId });

    return this.sm.transition(
      positionId,
      "ordering",
      { entryOrder: order },
      undefined,
      "Executor"
    );
  }

  /**
   * Executor reports order filled.
   * Transitions: ordering -> filled
   */
  async reportFilled(
    positionId: string,
    fillData: FillData
  ): Promise<PositionRecord> {
    logger.info("Order filled", {
      positionId,
      entryPrice: fillData.entryPrice,
      quantity: fillData.quantity,
    });

    return this.sm.transition(
      positionId,
      "filled",
      {
        entryPrice: fillData.entryPrice,
        quantity: fillData.quantity,
        entryOrder: fillData.entryOrder,
        stopLoss: fillData.stopLoss,
        takeProfit: fillData.takeProfit,
        highWaterMark: 0,
        unrealizedPnL: 0,
        currentPrice: fillData.entryPrice,
      },
      undefined,
      "Executor"
    );
  }

  /**
   * Start monitoring a filled position.
   * Transitions: filled -> monitoring
   */
  async startMonitoring(positionId: string): Promise<PositionRecord> {
    logger.info("Monitoring started", { positionId });

    return this.sm.transition(
      positionId,
      "monitoring",
      undefined,
      undefined,
      "Monitor"
    );
  }

  /**
   * Monitor updates live position data (price, PnL, trailing stop).
   * Does NOT change state — just updates data fields.
   */
  async updateLive(
    positionId: string,
    liveData: LivePositionData
  ): Promise<PositionRecord> {
    return this.sm.update(positionId, {
      currentPrice: liveData.currentPrice,
      unrealizedPnL: liveData.unrealizedPnL,
      highWaterMark: liveData.highWaterMark,
      trailingStop: liveData.trailingStop,
      stopLoss: liveData.stopLoss,
      takeProfit: liveData.takeProfit,
    });
  }

  /**
   * Monitor or Executor initiates a close.
   * Transitions: monitoring -> closing
   */
  async initiateClose(
    positionId: string,
    reason: string
  ): Promise<PositionRecord> {
    logger.info("Close initiated", { positionId, reason });

    return this.sm.transition(
      positionId,
      "closing",
      { closeReason: reason },
      reason,
      "Monitor"
    );
  }

  /**
   * Position fully closed. Can be called from monitoring (instant market close)
   * or from closing (after close order fills).
   * Transitions: monitoring -> closed  OR  closing -> closed
   */
  async reportClosed(
    positionId: string,
    closeData: CloseData
  ): Promise<PositionRecord> {
    logger.info("Position closed", {
      positionId,
      exitPrice: closeData.exitPrice,
      realizedPnL: closeData.realizedPnL,
    });

    return this.sm.transition(
      positionId,
      "closed",
      {
        exitPrice: closeData.exitPrice,
        realizedPnL: closeData.realizedPnL,
        exitOrder: closeData.exitOrder,
      },
      undefined,
      "Executor"
    );
  }

  /**
   * Teacher submits a post-trade review.
   * Transitions: closed -> reviewed
   */
  async reportReview(
    positionId: string,
    review: TradeReview
  ): Promise<PositionRecord> {
    logger.info("Review submitted", { positionId, grade: review.grade });

    return this.sm.transition(
      positionId,
      "reviewed",
      { review },
      undefined,
      "Teacher"
    );
  }

  /**
   * Cancel a position at any pre-fill stage.
   * Valid from: idea, analyzed, planned, approved, ordering
   */
  async cancel(positionId: string, reason: string): Promise<PositionRecord> {
    logger.info("Position cancelled", { positionId, reason });

    return this.sm.transition(
      positionId,
      "cancelled",
      { cancelReason: reason },
      reason,
      "User"
    );
  }

  // ==========================================================================
  // Query Methods
  // ==========================================================================

  /**
   * Get all active (non-terminal) positions.
   */
  async getActivePositions(): Promise<PositionRecord[]> {
    return this.sm.getActive();
  }

  /**
   * Get all positions in a specific state.
   */
  async getPositionsByState(state: PositionState): Promise<PositionRecord[]> {
    return this.sm.getByState(state);
  }

  /**
   * Get a single position by ID.
   */
  async getPosition(positionId: string): Promise<PositionRecord | null> {
    return this.sm.getPosition(positionId);
  }

  /**
   * Get positions for a symbol.
   */
  async getPositionsBySymbol(symbol: string): Promise<PositionRecord[]> {
    return this.sm.getBySymbol(symbol);
  }

  /**
   * Get trade history with optional filters.
   */
  async getTradeHistory(options?: HistoryOptions): Promise<PositionRecord[]> {
    return this.store.getHistory(options ?? {});
  }

  /**
   * Get a summary of all positions — counts, PnL, win rate.
   */
  async getPositionSummary(): Promise<PositionSummary> {
    const all = await this.store.getHistory({});
    const active = all.filter((p) => !TERMINAL_STATES.has(p.state));
    const closedOrReviewed = all.filter(
      (p) => p.state === "closed" || p.state === "reviewed"
    );
    const wins = closedOrReviewed.filter((p) => (p.realizedPnL ?? 0) > 0);
    const losses = closedOrReviewed.filter((p) => (p.realizedPnL ?? 0) < 0);

    const openPnL = active.reduce((sum, p) => sum + (p.unrealizedPnL ?? 0), 0);
    const closedPnL = closedOrReviewed.reduce(
      (sum, p) => sum + (p.realizedPnL ?? 0),
      0
    );

    // Count by state
    const byState: Record<PositionState, number> = {
      idea: 0,
      analyzed: 0,
      planned: 0,
      approved: 0,
      ordering: 0,
      filled: 0,
      monitoring: 0,
      closing: 0,
      closed: 0,
      reviewed: 0,
      cancelled: 0,
      rejected: 0,
    };
    for (const p of all) {
      byState[p.state] = (byState[p.state] || 0) + 1;
    }

    return {
      total: all.length,
      active: active.length,
      byState,
      openPnL,
      closedPnL,
      winRate: closedOrReviewed.length > 0 ? wins.length / closedOrReviewed.length : 0,
      totalClosed: closedOrReviewed.length,
      totalWins: wins.length,
      totalLosses: losses.length,
    };
  }
}

// ============================================================================
// Factory / Singleton
// ============================================================================

let _manager: PositionManager | null = null;

/**
 * Create a PositionManager with the given dependencies.
 */
export function createPositionManager(
  bus: EventBus,
  store: PositionStore
): PositionManager {
  const sm = new PositionStateMachine(bus, store);
  return new PositionManager(sm, bus, store);
}

/**
 * Get or create the default PositionManager singleton.
 * Lazily initializes the PositionStore on first call.
 */
export async function getPositionManager(bus: EventBus): Promise<PositionManager> {
  if (!_manager) {
    const store = await getPositionStore();
    _manager = createPositionManager(bus, store);
  }
  return _manager;
}

/**
 * Reset the singleton (useful for tests).
 */
export function resetPositionManager(): void {
  _manager = null;
}
