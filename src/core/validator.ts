import type { Plan, GordonConfig } from "../types/index.ts";

/**
 * Result of plan validation
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Current portfolio state for validation context
 */
export interface PortfolioState {
  totalValue: number; // in USDT
  availableCash: number; // USDT not in positions
  openPositions: number; // count of open trades
}

// Validation constants
const MIN_STOP_LOSS_PERCENT = 0.01; // 1% minimum distance from entry
const MAX_STOP_LOSS_PERCENT = 0.15; // 15% maximum distance from entry
const HIGH_VOLATILITY_THRESHOLD = 0.1; // 10% stop triggers warning
const MIN_RISK_REWARD_RATIO = 1.2; // Minimum R:R ratio
const LOW_REWARD_THRESHOLD = 1.5; // Below this triggers warning
const LARGE_ALLOCATION_THRESHOLD = 0.08; // 8% of portfolio triggers warning
const SYMBOL_REGEX = /^[A-Z]{2,10}USDT$/; // Valid symbol format

/**
 * Calculate the risk/reward ratio for a plan
 * Risk = distance from entry to stop loss
 * Reward = distance from entry to first take profit
 */
export function calculateRiskReward(plan: Plan): number {
  const entryPrice = plan.entry.price;

  // Market orders don't have a fixed entry price, can't calculate precise R:R
  if (entryPrice === null) {
    return 0;
  }

  const stopPrice = plan.stopLoss.price;
  const tp1Price = plan.takeProfit[0]?.price;

  if (!tp1Price) {
    return 0;
  }

  // For long positions: risk is entry - stop, reward is TP - entry
  const risk = entryPrice - stopPrice;
  const reward = tp1Price - entryPrice;

  // Prevent division by zero
  if (risk <= 0) {
    return 0;
  }

  return reward / risk;
}

/**
 * Calculate the allocation as a percentage of total portfolio value
 */
export function calculateAllocationPercent(
  plan: Plan,
  portfolioValue: number
): number {
  if (portfolioValue <= 0) {
    return 0;
  }

  return plan.allocation.amount / portfolioValue;
}

/**
 * Validate structure of the plan
 */
function validateStructure(plan: Plan, errors: string[]): void {
  // Entry price check (or market type)
  if (plan.entry.type !== "market" && plan.entry.price === null) {
    errors.push(
      "Entry price is required for limit orders. Set entry.price or change entry.type to 'market'."
    );
  }

  // Stop loss presence and position check (for long)
  if (plan.stopLoss.price === undefined || plan.stopLoss.price === null) {
    errors.push("Stop loss price is required for risk management.");
  } else if (plan.entry.price !== null && plan.direction === "long") {
    if (plan.stopLoss.price >= plan.entry.price) {
      errors.push(
        `Stop loss (${plan.stopLoss.price}) must be below entry price (${plan.entry.price}) for long positions.`
      );
    }
  }

  // At least one take profit level
  if (!plan.takeProfit || plan.takeProfit.length === 0) {
    errors.push(
      "At least one take profit level is required. Add a takeProfit entry with price and percentToSell."
    );
  } else {
    // Take profit percentages sum to 1.0
    const tpPercentSum = plan.takeProfit.reduce(
      (sum, tp) => sum + tp.percentToSell,
      0
    );
    if (Math.abs(tpPercentSum - 1.0) > 0.001) {
      errors.push(
        `Take profit percentages must sum to 100%. Current sum: ${(tpPercentSum * 100).toFixed(1)}%.`
      );
    }

    // Validate TP prices are above entry for long positions
    if (plan.entry.price !== null && plan.direction === "long") {
      for (let i = 0; i < plan.takeProfit.length; i++) {
        const tp = plan.takeProfit[i];
        if (tp && tp.price <= plan.entry.price) {
          errors.push(
            `Take profit level ${i + 1} (${tp.price}) must be above entry price (${plan.entry.price}) for long positions.`
          );
        }
      }
    }
  }

  // DCA percentages sum to 1.0 if DCA present
  if (plan.dca && plan.dca.length > 0) {
    const dcaPercentSum = plan.dca.reduce(
      (sum, level) => sum + level.percentOfAllocation,
      0
    );
    if (Math.abs(dcaPercentSum - 1.0) > 0.001) {
      errors.push(
        `DCA percentages must sum to 100%. Current sum: ${(dcaPercentSum * 100).toFixed(1)}%.`
      );
    }

    // Validate DCA prices are below entry for long positions
    if (plan.entry.price !== null && plan.direction === "long") {
      for (let i = 0; i < plan.dca.length; i++) {
        const dca = plan.dca[i];
        if (dca && dca.price >= plan.entry.price) {
          errors.push(
            `DCA level ${i + 1} (${dca.price}) must be below entry price (${plan.entry.price}) for long positions.`
          );
        }
      }
    }
  }

  // Symbol format validation
  if (!SYMBOL_REGEX.test(plan.symbol)) {
    errors.push(
      `Invalid symbol format: "${plan.symbol}". Expected format like "DOTUSDT" (2-10 uppercase letters followed by USDT).`
    );
  }
}

/**
 * Validate risk parameters of the plan
 */
function validateRisk(
  plan: Plan,
  config: GordonConfig,
  portfolio: PortfolioState,
  errors: string[]
): void {
  const maxAllocationAmount =
    config.preferences.maxAllocationPerTrade * portfolio.totalValue;
  const minCashReserve =
    config.preferences.cashReservePercent * portfolio.totalValue;

  // Allocation amount check
  if (plan.allocation.amount > maxAllocationAmount) {
    errors.push(
      `Allocation of ${plan.allocation.amount} USDT exceeds maximum allowed per trade (${maxAllocationAmount.toFixed(2)} USDT = ${(config.preferences.maxAllocationPerTrade * 100).toFixed(0)}% of portfolio).`
    );
  }

  // Cash reserve check
  const remainingCash = portfolio.availableCash - plan.allocation.amount;
  if (remainingCash < minCashReserve) {
    errors.push(
      `Insufficient cash reserve after trade. Would have ${remainingCash.toFixed(2)} USDT remaining, but need at least ${minCashReserve.toFixed(2)} USDT (${(config.preferences.cashReservePercent * 100).toFixed(0)}% reserve).`
    );
  }

  // Stop loss distance checks (only if we have entry price)
  if (plan.entry.price !== null) {
    const stopDistance =
      Math.abs(plan.entry.price - plan.stopLoss.price) / plan.entry.price;

    // Stop loss too tight
    if (stopDistance < MIN_STOP_LOSS_PERCENT) {
      errors.push(
        `Stop loss is too tight (${(stopDistance * 100).toFixed(2)}% from entry). Minimum distance is ${(MIN_STOP_LOSS_PERCENT * 100).toFixed(0)}% to avoid being stopped out by normal volatility.`
      );
    }

    // Stop loss too wide
    if (stopDistance > MAX_STOP_LOSS_PERCENT) {
      errors.push(
        `Stop loss is too wide (${(stopDistance * 100).toFixed(2)}% from entry). Maximum distance is ${(MAX_STOP_LOSS_PERCENT * 100).toFixed(0)}% to limit potential losses.`
      );
    }
  }

  // Risk/reward ratio check
  const riskReward = calculateRiskReward(plan);
  if (plan.entry.price !== null && riskReward > 0 && riskReward < MIN_RISK_REWARD_RATIO) {
    errors.push(
      `Risk/reward ratio of ${riskReward.toFixed(2)}:1 is below minimum ${MIN_RISK_REWARD_RATIO}:1. Consider a higher take profit or tighter stop loss.`
    );
  }
}

/**
 * Generate warnings for non-blocking concerns
 */
function generateWarnings(
  plan: Plan,
  portfolio: PortfolioState,
  warnings: string[]
): void {
  // High volatility warning (stop > 10%)
  if (plan.entry.price !== null) {
    const stopDistance =
      Math.abs(plan.entry.price - plan.stopLoss.price) / plan.entry.price;

    if (
      stopDistance > HIGH_VOLATILITY_THRESHOLD &&
      stopDistance <= MAX_STOP_LOSS_PERCENT
    ) {
      warnings.push(
        `High volatility: Stop loss is ${(stopDistance * 100).toFixed(1)}% from entry. Consider reducing position size to manage risk.`
      );
    }
  }

  // Low reward warning (R:R >= 1.2 but < 1.5)
  const riskReward = calculateRiskReward(plan);
  if (
    riskReward >= MIN_RISK_REWARD_RATIO &&
    riskReward < LOW_REWARD_THRESHOLD
  ) {
    warnings.push(
      `Low reward ratio: ${riskReward.toFixed(2)}:1 R:R is acceptable but below recommended ${LOW_REWARD_THRESHOLD}:1. Higher conviction trades typically have better R:R.`
    );
  }

  // Large allocation warning (> 8% of portfolio)
  const allocationPercent = calculateAllocationPercent(plan, portfolio.totalValue);
  if (allocationPercent > LARGE_ALLOCATION_THRESHOLD) {
    warnings.push(
      `Large allocation: ${(allocationPercent * 100).toFixed(1)}% of portfolio. Consider sizing down to reduce concentration risk.`
    );
  }
}

/**
 * Validate grid-specific rules
 */
function validateGrid(
  plan: Plan,
  errors: string[],
  warnings: string[]
): void {
  if (plan.strategy !== "grid_entry" || !plan.grid) {
    return;
  }

  const { grid } = plan;

  // Level count validation
  if (grid.levels.length < 3 || grid.levels.length > 7) {
    errors.push(
      `Grid must have 3-7 levels. Current: ${grid.levels.length} levels.`
    );
  }

  // Percentages must sum to 1
  const totalPercent = grid.levels.reduce(
    (sum, level) => sum + level.percentOfAllocation,
    0
  );
  if (Math.abs(totalPercent - 1.0) > 0.01) {
    errors.push(
      `Grid level percentages must sum to 100%. Current sum: ${(totalPercent * 100).toFixed(1)}%.`
    );
  }

  // Prices must be in descending order
  for (let i = 1; i < grid.levels.length; i++) {
    const current = grid.levels[i];
    const previous = grid.levels[i - 1];
    if (current && previous && current.price >= previous.price) {
      errors.push(
        `Grid levels must be in descending price order. Level ${i + 1} (${current.price}) >= Level ${i} (${previous.price}).`
      );
      break;
    }
  }

  // Stop loss must be below lowest grid level
  const lowestLevel = grid.levels[grid.levels.length - 1];
  if (lowestLevel && plan.stopLoss.price >= lowestLevel.price) {
    errors.push(
      `Stop loss (${plan.stopLoss.price}) must be below lowest grid level (${lowestLevel.price}).`
    );
  }

  // Warning: Grid range too wide (>20%)
  const rangePercent =
    (grid.priceRange.high - grid.priceRange.low) / grid.priceRange.high;
  if (rangePercent > 0.20) {
    warnings.push(
      `Grid range is ${(rangePercent * 100).toFixed(1)}% - consider a tighter range for better capital efficiency.`
    );
  }
}

/**
 * Validate a trading plan against configuration and portfolio state
 *
 * @param plan - The trading plan to validate
 * @param config - Gordon configuration with risk parameters
 * @param portfolio - Current portfolio state
 * @returns ValidationResult with valid flag, errors, and warnings
 */
export function validatePlan(
  plan: Plan,
  config: GordonConfig,
  portfolio: PortfolioState
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Run all validation checks
  validateStructure(plan, errors);
  validateRisk(plan, config, portfolio, errors);
  generateWarnings(plan, portfolio, warnings);
  validateGrid(plan, errors, warnings);

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
