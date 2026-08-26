/**
 * Risk Kernel
 *
 * The central mandatory middleware that ALL financial actions must pass
 * through before execution. Wraps and orchestrates the existing risk
 * management modules (position-sizer, daily-limits, drawdown-tracker)
 * into a single evaluation pipeline.
 *
 * Every order request is evaluated against:
 *   1. Position size limits (absolute USD and portfolio %)
 *   2. Daily loss limits (absolute USD and portfolio %)
 *   3. Portfolio drawdown limits
 *   4. Single-asset concentration limits
 *   5. Correlated-asset exposure limits
 *   6. Maximum open positions
 *   7. Leverage limits
 *   8. Liquidity adequacy (available balance)
 *
 * The kernel can operate in three modes:
 *   - enforce: Block or modify orders that violate limits
 *   - warn: Log violations but allow orders through
 *   - paper: Always approve (for paper trading / backtesting)
 *
 * When autoAdjustSize is enabled, the kernel will reduce order size
 * to fit within limits rather than outright rejecting.
 */

import { createModuleLogger } from "../../infra/logger/index.ts";
import { getEventBus } from "../../events/bus.ts";
import {
  PositionSizer,
  DailyLimitTracker,
  DrawdownTracker,
} from "../risk-management/index.ts";
import { CorrelationChecker } from "./correlation.ts";
import { RiskAuditLog, riskAuditLog } from "./audit.ts";
import type { RiskKernelConfig } from "./config.ts";
import { DEFAULT_RISK_CONFIG, resolveLiveSafeMode } from "./config.ts";
import type { PortfolioContext, OpenPosition } from "./portfolio-context.ts";
import type { RiskCheck, RiskDecision, OrderRequest } from "./audit.ts";

const logger = createModuleLogger("risk-kernel");

// ============================================================================
// Risk Kernel
// ============================================================================

export class RiskKernel {
  private config: RiskKernelConfig;
  private positionSizer: PositionSizer;
  private correlationChecker: CorrelationChecker;
  private auditLog: RiskAuditLog;

  constructor(config?: Partial<RiskKernelConfig>) {
    this.config = { ...DEFAULT_RISK_CONFIG, ...config };
    this.positionSizer = new PositionSizer({
      maxPositionSize: this.config.maxPositionSizeUsd,
    });
    this.correlationChecker = new CorrelationChecker();
    this.auditLog = riskAuditLog;

    logger.debug("Risk kernel initialized", {
      mode: this.config.mode,
      maxPositionSizeUsd: this.config.maxPositionSizeUsd,
      maxOpenPositions: this.config.maxOpenPositions,
      dailyLossLimitUsd: this.config.dailyLossLimitUsd,
      maxDrawdownPercent: this.config.maxDrawdownPercent,
    });
  }

  // ==========================================================================
  // Core Evaluation
  // ==========================================================================

  /**
   * Evaluate an order request against all risk checks.
   * This is THE core method -- every order MUST call this before execution.
   *
   * @param order - The order to evaluate
   * @param context - Current portfolio state
   * @returns RiskDecision with approval status, checks, and optional modifications
   */
  async evaluate(
    order: OrderRequest,
    context: PortfolioContext,
    opts?: { modeOverride?: RiskKernelConfig["mode"]; sandboxActive?: boolean },
  ): Promise<RiskDecision> {
    const startTime = performance.now();

    logger.debug("Evaluating order", {
      symbol: order.symbol,
      side: order.side,
      type: order.type,
      quantity: order.quantity,
      agentId: order.agentId,
    });

    // Run all checks
    const checks: RiskCheck[] = await this.runChecks(order, context);

    // Determine overall decision
    const criticalFailures = checks.filter((c) => !c.passed && c.severity === "critical");
    const warningFailures = checks.filter((c) => !c.passed && c.severity === "warning");
    const allPassed = checks.every((c) => c.passed);

    let decision: RiskDecision;

    // Resolve mode at the live boundary: an explicit modeOverride wins, but a
    // `warn` mode (from config/env) is upgraded to `enforce` on a non-sandbox
    // venue so hard sizing caps cannot be silently disabled on real capital.
    const requestedMode = opts?.modeOverride ?? this.config.mode;
    const effectiveMode = resolveLiveSafeMode(
      requestedMode,
      opts?.sandboxActive ?? false,
    );

    if (effectiveMode === "paper") {
      // Paper mode: always approve
      decision = {
        approved: true,
        action: "approve",
        originalOrder: order,
        checks,
        reason: "Paper mode -- all orders approved.",
        timestamp: new Date().toISOString(),
      };
    } else if (allPassed) {
      // All checks passed
      decision = {
        approved: true,
        action: "approve",
        originalOrder: order,
        checks,
        reason: "All risk checks passed.",
        timestamp: new Date().toISOString(),
      };
    } else if (criticalFailures.length > 0) {
      if (effectiveMode === "warn") {
        // Warn mode: log but allow
        decision = {
          approved: true,
          action: "approve",
          originalOrder: order,
          checks,
          reason: `WARN MODE: ${criticalFailures.length} critical risk violation(s) detected but order allowed. ${criticalFailures.map((c) => c.details).join("; ")}`,
          timestamp: new Date().toISOString(),
        };
      } else {
        // Enforce mode: try to adjust, otherwise reject.
        //
        // A resize is only a remedy if the resized order actually passes. The
        // adjuster caps position value, available balance, single-asset exposure
        // and a drawdown-derived multiplier, so those breaches either resolve or
        // drive the quantity under its own floor and reject. Nothing it does
        // reduces the COUNT of open positions, and nothing makes a correlation
        // check that threw have run. At the open-position cap this returned a
        // smaller order and approved it.
        //
        // Rather than maintain a list of which checks a resize can fix, which
        // would drift as checks are added, re-run every check against the
        // adjusted order and require it to come back clean.
        const candidate = this.config.autoAdjustSize
          ? this.tryAdjustOrder(order, context)
          : null;
        let adjustedOrder: OrderRequest | null = null;
        let adjustedChecks: RiskCheck[] = [];
        if (candidate) {
          adjustedChecks = await this.runChecks(candidate, context);
          const stillCritical = adjustedChecks.filter(
            (c) => !c.passed && c.severity === "critical",
          );
          if (stillCritical.length === 0) adjustedOrder = candidate;
        }

        if (adjustedOrder) {
          decision = {
            approved: true,
            action: "modify",
            originalOrder: order,
            modifiedOrder: adjustedOrder,
            // The adjusted order's own checks, so a caller reading the decision
            // sees what the order it may actually place was scored against.
            checks: adjustedChecks,
            reason: `Order modified to comply with risk limits. Original qty: ${order.quantity}, adjusted: ${adjustedOrder.quantity}. ${criticalFailures.map((c) => c.details).join("; ")}`,
            timestamp: new Date().toISOString(),
          };
        } else {
          decision = {
            approved: false,
            action: "reject",
            originalOrder: order,
            checks,
            reason: `Order rejected: ${criticalFailures.map((c) => c.details).join("; ")}`,
            timestamp: new Date().toISOString(),
          };
        }
      }
    } else {
      // Only warnings, no critical failures
      if (this.config.autoAdjustSize && warningFailures.length > 0) {
        const adjustedOrder = this.tryAdjustOrder(order, context);
        if (adjustedOrder && adjustedOrder.quantity !== order.quantity) {
          decision = {
            approved: true,
            action: "modify",
            originalOrder: order,
            modifiedOrder: adjustedOrder,
            checks,
            reason: `Order adjusted for warnings. ${warningFailures.map((c) => c.details).join("; ")}`,
            timestamp: new Date().toISOString(),
          };
        } else {
          decision = {
            approved: true,
            action: "approve",
            originalOrder: order,
            checks,
            reason: `Approved with warnings: ${warningFailures.map((c) => c.details).join("; ")}`,
            timestamp: new Date().toISOString(),
          };
        }
      } else {
        decision = {
          approved: true,
          action: "approve",
          originalOrder: order,
          checks,
          reason: `Approved with warnings: ${warningFailures.map((c) => c.details).join("; ")}`,
          timestamp: new Date().toISOString(),
        };
      }
    }

    // Emit event
    this.emitDecision(decision);

    // Audit log (fire and forget). If the caller threaded a decisionTrace
    // into order.metadata (via `withDecisionTrace`), pull it out and pass
    // it alongside so reasoning chains persist without a schema change.
    const auditId = `ra_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const decisionTrace = order.metadata?.decisionTrace as
      | Record<string, unknown>
      | undefined;
    this.auditLog.log({
      id: auditId,
      timestamp: decision.timestamp,
      order,
      decision,
      portfolioSnapshot: context,
      ...(decisionTrace ? { decisionTrace } : {}),
    }).catch((err) => {
      logger.error("Failed to write audit log", err as Error);
    });

    const durationMs = performance.now() - startTime;
    logger.debug("Risk evaluation completed", {
      symbol: order.symbol,
      action: decision.action,
      approved: decision.approved,
      checksRun: checks.length,
      checksFailed: checks.filter((c) => !c.passed).length,
      durationMs: durationMs.toFixed(2),
    });

    return decision;
  }

  // ==========================================================================
  // Individual Check Methods
  // ==========================================================================

  /**
   * Check if the order size exceeds position size limits.
   * Checks both absolute USD limit and portfolio percentage limit.
   */
  private checkPositionSize(order: OrderRequest, context: PortfolioContext): RiskCheck {
    const orderValueUsd = this.estimateOrderValueUsd(order, context);
    if (orderValueUsd === undefined) {
      return this.unpricedOrderCheck("position_size", order);
    }

    // Check absolute USD limit
    if (orderValueUsd > this.config.maxPositionSizeUsd) {
      return {
        name: "position_size",
        passed: false,
        details: `Position size $${orderValueUsd.toFixed(2)} exceeds max $${this.config.maxPositionSizeUsd.toFixed(2)}.`,
        severity: "critical",
      };
    }

    // Check portfolio percentage limit
    if (context.totalEquity > 0) {
      const percentOfPortfolio = (orderValueUsd / context.totalEquity) * 100;
      if (percentOfPortfolio > this.config.maxPositionSizePercent) {
        return {
          name: "position_size",
          passed: false,
          details: `Position size ${percentOfPortfolio.toFixed(1)}% of portfolio exceeds max ${this.config.maxPositionSizePercent}%.`,
          severity: "critical",
        };
      }
    }

    return {
      name: "position_size",
      passed: true,
      details: `Position size $${orderValueUsd.toFixed(2)} within limits.`,
      severity: "info",
    };
  }

  /**
   * Check if the order would cause daily loss limits to be exceeded.
   * Uses the DailyLimitTracker for realized PnL tracking.
   */
  private checkDailyLossLimit(order: OrderRequest, context: PortfolioContext): RiskCheck {
    const tracker = new DailyLimitTracker({
      dailyLossLimitUsd: this.config.dailyLossLimitUsd,
      dailyLossLimitPercent: this.config.dailyLossLimitPercent,
    });

    // Simulate today's PnL into the tracker
    if (context.todayPnL !== 0) {
      tracker.recordTrade("DAILY_TOTAL", context.todayPnL);
    }

    const status = tracker.getStatus(context.totalEquity);

    if (!status.tradingAllowed) {
      return {
        name: "daily_loss_limit",
        passed: false,
        details: `Daily loss limit exceeded. Today's PnL: $${context.todayPnL.toFixed(2)}, limit: $${this.config.dailyLossLimitUsd.toFixed(2)}.`,
        severity: "critical",
      };
    }

    // Check if there's enough remaining allowance for a potential loss
    const orderValue = this.estimateOrderValueUsd(order, context);
    if (orderValue === undefined) {
      return this.unpricedOrderCheck("daily_loss_limit", order);
    }
    // Assume worst case: 5% loss on the position as a rough estimate
    const estimatedMaxLoss = orderValue * 0.05;

    if (estimatedMaxLoss > status.remainingAllowance) {
      return {
        name: "daily_loss_limit",
        passed: false,
        details: `Potential loss ($${estimatedMaxLoss.toFixed(2)}) may exceed remaining daily allowance ($${status.remainingAllowance.toFixed(2)}).`,
        severity: "warning",
      };
    }

    return {
      name: "daily_loss_limit",
      passed: true,
      details: `Daily loss within limits. Remaining allowance: $${status.remainingAllowance.toFixed(2)}.`,
      severity: "info",
    };
  }

  /**
   * Check if portfolio drawdown has exceeded the configured limit.
   * Uses the DrawdownTracker for peak-to-trough tracking.
   */
  private checkDrawdownLimit(order: OrderRequest, context: PortfolioContext): RiskCheck {
    const tracker = new DrawdownTracker({
      maxDrawdownPercent: this.config.maxDrawdownPercent,
    });

    // Initialize with peak and update with current
    const peakEquity = context.peakEquity > 0 ? context.peakEquity : context.totalEquity;
    tracker.initialize(peakEquity);
    const status = tracker.updateBalance(context.totalEquity);

    if (!status.tradingAllowed) {
      return {
        name: "drawdown_limit",
        passed: false,
        details: `Portfolio drawdown ${status.drawdownPercent.toFixed(1)}% exceeds max ${this.config.maxDrawdownPercent}%. Trading halted.`,
        severity: "critical",
      };
    }

    if (status.status === "critical" || status.status === "warning") {
      return {
        name: "drawdown_limit",
        passed: true,
        details: `Drawdown at ${status.drawdownPercent.toFixed(1)}% (${status.status}). Position size multiplier: ${status.sizeMultiplier.toFixed(2)}x.`,
        severity: "warning",
      };
    }

    return {
      name: "drawdown_limit",
      passed: true,
      details: `Drawdown at ${status.drawdownPercent.toFixed(1)}%. Within healthy range.`,
      severity: "info",
    };
  }

  /**
   * Check if adding this position would exceed the max single-asset exposure.
   */
  private checkPortfolioExposure(order: OrderRequest, context: PortfolioContext): RiskCheck {
    if (context.totalEquity <= 0) {
      return {
        name: "portfolio_exposure",
        passed: true,
        details: "Cannot calculate exposure -- total equity is zero.",
        severity: "info",
      };
    }

    // Calculate current exposure to this symbol
    const existingExposure = context.openPositions
      .filter((p) => p.symbol === order.symbol)
      .reduce((sum, p) => sum + p.size * p.currentPrice, 0);

    const newOrderValue = this.estimateOrderValueUsd(order, context);
    if (newOrderValue === undefined) {
      return this.unpricedOrderCheck("portfolio_exposure", order);
    }
    const totalExposure = existingExposure + newOrderValue;
    const exposurePercent = (totalExposure / context.totalEquity) * 100;

    if (exposurePercent > this.config.maxSingleAssetExposure) {
      return {
        name: "portfolio_exposure",
        passed: false,
        details: `${order.symbol} exposure would be ${exposurePercent.toFixed(1)}% (existing: $${existingExposure.toFixed(2)} + new: $${newOrderValue.toFixed(2)}), exceeding max ${this.config.maxSingleAssetExposure}%.`,
        severity: "critical",
      };
    }

    return {
      name: "portfolio_exposure",
      passed: true,
      details: `${order.symbol} exposure: ${exposurePercent.toFixed(1)}% (limit: ${this.config.maxSingleAssetExposure}%).`,
      severity: "info",
    };
  }

  /**
   * Check if adding this position creates too much correlated exposure.
   */
  private async checkCorrelation(order: OrderRequest, context: PortfolioContext): Promise<RiskCheck> {
    const side = order.side === "buy" ? "long" : "short";

    const result = await this.correlationChecker.checkCorrelation(
      order.symbol,
      side as "long" | "short",
      context.openPositions,
      this.config.maxCorrelatedExposure,
      context.totalEquity
    );

    // A check that threw measured nothing, so it cannot contribute a pass.
    if (result.status === "error") {
      return {
        name: "correlation",
        passed: false,
        details: result.details,
        severity: "critical",
      };
    }

    if (!result.acceptable) {
      return {
        name: "correlation",
        passed: false,
        details: result.details,
        severity: "warning",
      };
    }

    // An unmodelled pair is surfaced as a warning failure rather than an
    // `info` pass: it never lands in "all risk checks passed", but it also
    // does not block, since an unlisted symbol is routine, not a violation.
    if (result.status === "unknown") {
      return {
        name: "correlation",
        passed: false,
        details: result.details,
        severity: "warning",
      };
    }

    if (result.maxCorrelation !== null && result.maxCorrelation > 0.8) {
      return {
        name: "correlation",
        passed: true,
        details: `High correlation (${result.maxCorrelation.toFixed(2)}) with ${result.mostCorrelatedWith} but within exposure limits.`,
        severity: "warning",
      };
    }

    return {
      name: "correlation",
      passed: true,
      details: result.details,
      severity: "info",
    };
  }

  /**
   * Check if the maximum number of concurrent open positions would be exceeded.
   */
  private checkMaxOpenPositions(order: OrderRequest, context: PortfolioContext): RiskCheck {
    // Only check for buy orders (new positions)
    if (order.side === "sell") {
      return {
        name: "max_open_positions",
        passed: true,
        details: "Sell order -- does not increase position count.",
        severity: "info",
      };
    }

    // Check if this is adding to an existing position vs opening a new one
    const existingPosition = context.openPositions.find((p) => p.symbol === order.symbol);

    if (existingPosition) {
      return {
        name: "max_open_positions",
        passed: true,
        details: `Adding to existing ${order.symbol} position. ${context.openPositions.length} positions open.`,
        severity: "info",
      };
    }

    // This would be a new position
    if (context.openPositions.length >= this.config.maxOpenPositions) {
      return {
        name: "max_open_positions",
        passed: false,
        details: `Maximum open positions (${this.config.maxOpenPositions}) reached. Currently ${context.openPositions.length} positions open.`,
        severity: "critical",
      };
    }

    return {
      name: "max_open_positions",
      passed: true,
      details: `${context.openPositions.length + 1}/${this.config.maxOpenPositions} positions after this order.`,
      severity: "info",
    };
  }

  /**
   * Check if the order involves leverage beyond the configured limit.
   * For spot trading (Gordon's primary mode), leverage is always 1.
   */
  private checkLeverageLimit(order: OrderRequest, context: PortfolioContext): RiskCheck {
    // Calculate effective leverage: total position value / equity
    const totalPositionValue = context.openPositions.reduce(
      (sum, p) => sum + p.size * p.currentPrice,
      0
    );
    const newOrderValue = this.estimateOrderValueUsd(order, context);
    if (newOrderValue === undefined) {
      return this.unpricedOrderCheck("leverage_limit", order);
    }
    const totalAfterOrder = totalPositionValue + newOrderValue;

    const effectiveLeverage = context.totalEquity > 0
      ? totalAfterOrder / context.totalEquity
      : 0;

    if (effectiveLeverage > this.config.maxLeverage) {
      return {
        name: "leverage_limit",
        passed: false,
        details: `Effective leverage ${effectiveLeverage.toFixed(2)}x would exceed max ${this.config.maxLeverage}x.`,
        severity: "critical",
      };
    }

    return {
      name: "leverage_limit",
      passed: true,
      details: `Effective leverage: ${effectiveLeverage.toFixed(2)}x (max: ${this.config.maxLeverage}x).`,
      severity: "info",
    };
  }

  /**
   * Check if the account has sufficient available balance for the order.
   */
  private checkLiquidityAdequacy(order: OrderRequest, context: PortfolioContext): RiskCheck {
    // Only check for buy orders (requires capital)
    if (order.side === "sell") {
      return {
        name: "liquidity",
        passed: true,
        details: "Sell order -- no additional capital required.",
        severity: "info",
      };
    }

    const orderValueUsd = this.estimateOrderValueUsd(order, context);
    if (orderValueUsd === undefined) {
      return this.unpricedOrderCheck("liquidity", order);
    }

    if (orderValueUsd > context.availableBalance) {
      return {
        name: "liquidity",
        passed: false,
        details: `Insufficient balance. Order requires $${orderValueUsd.toFixed(2)} but only $${context.availableBalance.toFixed(2)} available.`,
        severity: "critical",
      };
    }

    // Warn if order uses more than 80% of available balance
    const usagePercent = (orderValueUsd / context.availableBalance) * 100;
    if (usagePercent > 80) {
      return {
        name: "liquidity",
        passed: true,
        details: `Order uses ${usagePercent.toFixed(1)}% of available balance. Consider keeping reserves.`,
        severity: "warning",
      };
    }

    return {
      name: "liquidity",
      passed: true,
      details: `Sufficient balance. Using $${orderValueUsd.toFixed(2)} of $${context.availableBalance.toFixed(2)} available.`,
      severity: "info",
    };
  }

  // ==========================================================================
  // Order Adjustment
  // ==========================================================================

  /** Every risk check, in order, against one candidate order. */
  private async runChecks(
    order: OrderRequest,
    context: PortfolioContext,
  ): Promise<RiskCheck[]> {
    return [
      this.checkPositionSize(order, context),
      this.checkDailyLossLimit(order, context),
      this.checkDrawdownLimit(order, context),
      this.checkPortfolioExposure(order, context),
      await this.checkCorrelation(order, context),
      this.checkMaxOpenPositions(order, context),
      this.checkLeverageLimit(order, context),
      this.checkLiquidityAdequacy(order, context),
    ];
  }

  /**
   * Try to adjust the order size to fit within risk limits.
   * Returns the adjusted order, or null if no viable adjustment exists.
   */
  private tryAdjustOrder(
    order: OrderRequest,
    context: PortfolioContext,
  ): OrderRequest | null {
    let adjustedQuantity = order.quantity;
    const orderPrice = order.price && order.price > 0
      ? order.price
      : context.openPositions.find((p) => p.symbol === order.symbol)?.currentPrice ?? 0;

    // An order that cannot be priced cannot be meaningfully resized: halving an
    // unpriced base quantity does not bring it under a dollar cap, it just
    // produces a second unpriced order. Reject instead.
    if (orderPrice <= 0) return null;

    const currentOrderValue = adjustedQuantity * orderPrice;

    // Adjust for position size limits
    const maxByUsd = this.config.maxPositionSizeUsd;
    const maxByPercent = context.totalEquity > 0
      ? context.totalEquity * (this.config.maxPositionSizePercent / 100)
      : Infinity;
    const maxPositionValue = Math.min(maxByUsd, maxByPercent);

    if (currentOrderValue > maxPositionValue) {
      adjustedQuantity = maxPositionValue / orderPrice;
    }

    // Adjust for available balance
    if (order.side === "buy" && adjustedQuantity * orderPrice > context.availableBalance) {
      adjustedQuantity = context.availableBalance / orderPrice;
    }

    // Adjust for single-asset exposure
    if (context.totalEquity > 0) {
      const existingExposure = context.openPositions
        .filter((p) => p.symbol === order.symbol)
        .reduce((sum, p) => sum + p.size * p.currentPrice, 0);

      const maxExposureValue = context.totalEquity * (this.config.maxSingleAssetExposure / 100);
      const remainingExposure = maxExposureValue - existingExposure;

      if (remainingExposure <= 0) {
        return null; // Already at max exposure for this asset
      }

      if (adjustedQuantity * orderPrice > remainingExposure) {
        adjustedQuantity = remainingExposure / orderPrice;
      }
    }

    // Adjust for the leverage ceiling. Positions already open consume the
    // allowance before this order gets any, so the room left is the ceiling
    // minus what is already held, not the ceiling itself. Without this the
    // adjuster under-reduced: an account already at 95% of its limit had an
    // oversized order cut to a size that still breached, and the breach was
    // only caught by the re-check that now follows every adjustment.
    if (this.config.maxLeverage > 0 && context.totalEquity > 0) {
      const heldValue = context.openPositions.reduce(
        (sum, p) => sum + p.size * p.currentPrice,
        0,
      );
      const leverageRoom =
        this.config.maxLeverage * context.totalEquity - heldValue;
      if (leverageRoom <= 0) return null;
      if (adjustedQuantity * orderPrice > leverageRoom) {
        adjustedQuantity = leverageRoom / orderPrice;
      }
    }

    // Adjust for drawdown-based size reduction
    const ddTracker = new DrawdownTracker({
      maxDrawdownPercent: this.config.maxDrawdownPercent,
    });
    const peakEquity = context.peakEquity > 0 ? context.peakEquity : context.totalEquity;
    ddTracker.initialize(peakEquity);
    const ddStatus = ddTracker.updateBalance(context.totalEquity);
    if (ddStatus.sizeMultiplier < 1) {
      adjustedQuantity = adjustedQuantity * ddStatus.sizeMultiplier;
    }

    // Sanity check: don't allow adjustment to less than 10% of original
    if (adjustedQuantity < order.quantity * 0.1) {
      logger.debug("Adjusted quantity too small, rejecting", {
        original: order.quantity,
        adjusted: adjustedQuantity,
      });
      return null;
    }

    // Round to reasonable precision (8 decimal places for crypto)
    adjustedQuantity = Math.floor(adjustedQuantity * 1e8) / 1e8;

    if (adjustedQuantity === order.quantity) {
      return null; // No adjustment needed
    }

    return { ...order, quantity: adjustedQuantity };
  }

  // ==========================================================================
  // Event Emission
  // ==========================================================================

  /**
   * Emit a risk decision event to the EventBus.
   */
  private emitDecision(decision: RiskDecision): void {
    try {
      const bus = getEventBus();

      if (decision.approved) {
        bus.emit({
          type: "risk:approved",
          timestamp: decision.timestamp,
          symbol: decision.originalOrder.symbol,
          action: decision.action as "approve" | "modify",
          agentId: decision.originalOrder.agentId,
          checks: decision.checks.length,
          reason: decision.reason,
        }).catch((err) => {
          logger.error("Failed to emit risk:approved event", err as Error);
        });
      } else {
        bus.emit({
          type: "risk:rejected",
          timestamp: decision.timestamp,
          symbol: decision.originalOrder.symbol,
          agentId: decision.originalOrder.agentId,
          checks: decision.checks.filter((c) => !c.passed).map((c) => c.name),
          reason: decision.reason,
        }).catch((err) => {
          logger.error("Failed to emit risk:rejected event", err as Error);
        });
      }
    } catch (error) {
      // Event emission should never block order processing
      logger.error("Failed to emit risk decision event", error as Error);
    }
  }

  // ==========================================================================
  // Utility
  // ==========================================================================

  /**
   * Estimate the USD value of an order.
   *
   * `order.quantity` is denominated in the BASE asset, so it is never a USD
   * value on its own: 0.5 BTC is not $0.50. A limit price prices the order
   * directly; a market order is priced off the mark price of an existing
   * position in the same symbol when the portfolio carries one. With neither,
   * the value is genuinely unknown and this returns `undefined` so the
   * dollar-denominated checks can fail closed instead of comparing a limit
   * against a number that is wrong by orders of magnitude.
   */
  private estimateOrderValueUsd(order: OrderRequest, context: PortfolioContext): number | undefined {
    if (order.price && order.price > 0) {
      return order.quantity * order.price;
    }
    const markPrice = context.openPositions.find((p) => p.symbol === order.symbol)?.currentPrice;
    if (markPrice && markPrice > 0) {
      return order.quantity * markPrice;
    }
    return undefined;
  }

  /** Uniform fail-closed check for an order whose USD value cannot be priced. */
  private unpricedOrderCheck(name: string, order: OrderRequest): RiskCheck {
    return {
      name,
      passed: false,
      details:
        `Cannot price ${order.quantity} ${order.symbol}: the order carries no price and no mark price ` +
        `is available for the symbol. Dollar-denominated limits cannot be verified.`,
      severity: "critical",
    };
  }

  /**
   * Get the current configuration (read-only).
   */
  getConfig(): Readonly<RiskKernelConfig> {
    return { ...this.config };
  }

  /**
   * Update configuration at runtime.
   */
  updateConfig(updates: Partial<RiskKernelConfig>): void {
    this.config = { ...this.config, ...updates };

    // Update position sizer if max size changed
    if (updates.maxPositionSizeUsd !== undefined) {
      this.positionSizer = new PositionSizer({
        maxPositionSize: this.config.maxPositionSizeUsd,
      });
    }

    logger.debug("Risk kernel config updated", updates);
  }

  /**
   * Get the audit log instance for querying history.
   */
  getAuditLog(): RiskAuditLog {
    return this.auditLog;
  }
}
