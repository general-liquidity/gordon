/**
 * Risk Management Module
 *
 * Advanced risk management capabilities including:
 * - Kelly Criterion position sizing
 * - Volatility-adjusted sizing
 * - Daily loss limits
 * - PnL rate-based exits
 * - Time-based exits
 * - Drawdown tracking and management
 */

// Position Sizing
export {
  PositionSizer,
  positionSizer,
  type PositionSizeConfig,
  type KellyResult,
  type VolatilityAdjustedResult,
  type RiskBasedSizeResult,
} from "./position-sizer.ts";

// Daily Limits
export {
  DailyLimitTracker,
  dailyLimitTracker,
  type DailyLimitConfig,
  type DailyPnLStatus,
  type TradeRecord,
} from "./daily-limits.ts";

// Exit Conditions
export {
  ExitConditionChecker,
  exitConditionChecker,
  type PnLExitConfig,
  type PnLRateConfig,
  type TimeExitConfig,
  type ExitSignal,
  type PnLExitResult,
  type PnLRateResult,
  type TimeExitResult,
} from "./exit-conditions.ts";

// Drawdown Tracking
export {
  DrawdownTracker,
  drawdownTracker,
  type DrawdownConfig,
  type DrawdownStatus,
  type DrawdownEvent,
} from "./drawdown-tracker.ts";
