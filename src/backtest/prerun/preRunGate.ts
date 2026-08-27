/**
 * Backtest Pre-Run Gate
 *
 * Rejects backtest configurations that violate Gordon's trading constitution
 * BEFORE the engine starts running. Inspired by autotrade-main's
 * `check_leverage_hard()` pattern — fail early instead of wasting compute on
 * a known-unsafe configuration.
 *
 * The gate consults the live RiskKernelConfig (same limits the runtime
 * RiskKernel enforces) so backtests can't test configurations the live
 * system would reject. Keeps the simulation honest about the constraints
 * of actual deployment. Env overrides to the risk config (GORDON_RISK_*
 * env vars) automatically flow through here — no duplicated config surface.
 */

import type { BacktestConfig } from "../types.ts";
import {
  loadConfigFromEnv as loadRiskConfig,
  type RiskKernelConfig,
} from "../../core/risk-kernel/config.ts";

// ============================================================================
// Types
// ============================================================================

export interface PreRunGateLimits {
  /** Hard cap on leverage (1 = no leverage). */
  maxLeverage: number;
  /** Maximum drawdown percentage allowed (positive, e.g. 40 = 40%). */
  maxDrawdownCap: number;
  /** Minimum initial capital (prevents nonsensical tiny runs). */
  minInitialCapital: number;
  /** Maximum position size percentage per trade. */
  maxPositionSizePct: number;
  /** Minimum backtest window in days (prevents ultra-short runs). */
  minWindowDays: number;
  /** Maximum backtest window in days (prevents runaway fetches). */
  maxWindowDays: number;
  /** Maximum fee percentage (prevents pathological fee configs). */
  maxFeePct: number;
}

export interface PreRunGateResult {
  passed: boolean;
  violations: string[];
  /** Echo of the limits applied. */
  limits: PreRunGateLimits;
}

// ============================================================================
// Defaults — derived from Gordon's trading constitution defaults
// ============================================================================

/**
 * Default gate limits. These are used ONLY as fallbacks when the risk kernel
 * config can't be read (e.g. in tests). The normal path uses
 * `getGateLimitsFromRiskConfig()` which pulls live values from
 * RiskKernelConfig — same source as the runtime RiskKernel.
 */
export const DEFAULT_GATE_LIMITS: PreRunGateLimits = {
  maxLeverage: 3,
  maxDrawdownCap: 40,
  minInitialCapital: 100,
  maxPositionSizePct: 50,
  minWindowDays: 7,
  maxWindowDays: 1825, // 5 years
  maxFeePct: 2,
};

/**
 * Derive gate limits from the user's live risk kernel config. Env overrides
 * (GORDON_RISK_MAX_LEVERAGE, GORDON_RISK_MAX_DRAWDOWN_PERCENT, etc.) are
 * honored automatically because loadConfigFromEnv reads them itself.
 *
 * Fields not covered by RiskKernelConfig (window bounds, fee sanity cap)
 * fall back to DEFAULT_GATE_LIMITS values — those are backtest-specific
 * and don't have a live-runtime analog.
 */
export function getGateLimitsFromRiskConfig(
  override?: Partial<RiskKernelConfig>,
): PreRunGateLimits {
  let risk: RiskKernelConfig;
  try {
    risk = loadRiskConfig(override);
  } catch {
    return DEFAULT_GATE_LIMITS;
  }
  return {
    maxLeverage: risk.maxLeverage ?? DEFAULT_GATE_LIMITS.maxLeverage,
    maxDrawdownCap: risk.maxDrawdownPercent ?? DEFAULT_GATE_LIMITS.maxDrawdownCap,
    // Minimum capital isn't in the risk config — the risk config is in USD
    // *position* size, not portfolio size. Keep the default floor.
    minInitialCapital: DEFAULT_GATE_LIMITS.minInitialCapital,
    maxPositionSizePct: risk.maxPositionSizePercent ?? DEFAULT_GATE_LIMITS.maxPositionSizePct,
    minWindowDays: DEFAULT_GATE_LIMITS.minWindowDays,
    maxWindowDays: DEFAULT_GATE_LIMITS.maxWindowDays,
    maxFeePct: DEFAULT_GATE_LIMITS.maxFeePct,
  };
}

// ============================================================================
// Check
// ============================================================================

/**
 * Run the pre-run gate against a backtest configuration. Pure function.
 * Caller decides what to do with violations — typically return the result
 * from the tool with an error field and skip the engine call.
 *
 * Limits default to the live risk kernel config so the gate and the
 * runtime RiskKernel enforce the same limits. Tests and tools that need
 * different limits can pass explicit `limits` to override.
 */
export function checkBacktestPreconditions(
  config: Partial<BacktestConfig> & { leverage?: number },
  limits: PreRunGateLimits = getGateLimitsFromRiskConfig(),
): PreRunGateResult {
  const violations: string[] = [];

  // Leverage cap
  const leverage = config.leverage ?? 1;
  if (leverage > limits.maxLeverage) {
    violations.push(`leverage ${leverage}x exceeds cap ${limits.maxLeverage}x`);
  }
  if (leverage < 1) {
    violations.push(`leverage ${leverage}x is invalid (must be >= 1)`);
  }

  // Initial capital floor
  if (config.initialCapital !== undefined && config.initialCapital < limits.minInitialCapital) {
    violations.push(
      `initial capital $${config.initialCapital} < $${limits.minInitialCapital} minimum`,
    );
  }

  // Position size cap
  if (
    config.positionSizePercent !== undefined &&
    config.positionSizePercent > limits.maxPositionSizePct
  ) {
    violations.push(
      `position size ${config.positionSizePercent}% > ${limits.maxPositionSizePct}% cap`,
    );
  }

  // Window bounds
  if (config.days !== undefined) {
    if (config.days < limits.minWindowDays) {
      violations.push(`window ${config.days}d < ${limits.minWindowDays}d minimum`);
    }
    if (config.days > limits.maxWindowDays) {
      violations.push(`window ${config.days}d > ${limits.maxWindowDays}d maximum`);
    }
  }

  // Fee sanity
  if (config.feePercent !== undefined && config.feePercent > limits.maxFeePct) {
    violations.push(`fee ${config.feePercent}% exceeds ${limits.maxFeePct}% sanity cap — typo?`);
  }

  return {
    passed: violations.length === 0,
    violations,
    limits,
  };
}

/**
 * Merge user-provided limit overrides with defaults. Handy for tools that
 * accept partial limit objects from the agent.
 */
export function mergeGateLimits(overrides: Partial<PreRunGateLimits>): PreRunGateLimits {
  return { ...DEFAULT_GATE_LIMITS, ...overrides };
}
