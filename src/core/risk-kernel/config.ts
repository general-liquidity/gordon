/**
 * Risk Kernel Configuration
 *
 * Defines the configuration schema for the Risk Kernel including
 * position limits, loss limits, exposure limits, and behavioral modes.
 * Configuration can be loaded from environment variables or defaults.
 */

import { flagEnv } from "../../infra/config/flagResolver.ts";
import { z } from "zod";
import { createModuleLogger } from "../../infra/logger/index.ts";

const logger = createModuleLogger("risk-kernel-config");

// ============================================================================
// Schema
// ============================================================================

export const RiskKernelConfigSchema = z.object({
  // Position limits
  maxPositionSizeUsd: z.number().positive().default(5000),
  maxPositionSizePercent: z.number().min(0).max(100).default(10),
  maxOpenPositions: z.number().int().positive().default(5),

  // Loss limits
  dailyLossLimitUsd: z.number().positive().default(500),
  dailyLossLimitPercent: z.number().min(0).max(100).default(3),
  maxDrawdownPercent: z.number().min(0).max(100).default(15),

  // Exposure limits
  maxSingleAssetExposure: z.number().min(0).max(100).default(25),
  maxCorrelatedExposure: z.number().min(0).max(100).default(40),
  maxLeverage: z.number().min(1).default(1),

  // Behavior
  mode: z.enum(["enforce", "warn", "paper"]).default("enforce"),
  autoAdjustSize: z.boolean().default(true),
  requireApproval: z.boolean().default(true),
});

export type RiskKernelConfig = z.infer<typeof RiskKernelConfigSchema>;

// ============================================================================
// Defaults
// ============================================================================

/**
 * Sensible defaults that protect new users:
 * - Small max position ($5k, 10% of portfolio)
 * - Conservative daily loss ($500, 3%)
 * - 15% max drawdown before trading halts
 * - No leverage
 * - Auto-adjust sizes to fit limits
 * - Require user approval for live trades
 */
export const DEFAULT_RISK_CONFIG: RiskKernelConfig = {
  maxPositionSizeUsd: 5000,
  maxPositionSizePercent: 10,
  maxOpenPositions: 5,

  dailyLossLimitUsd: 500,
  dailyLossLimitPercent: 3,
  maxDrawdownPercent: 15,

  maxSingleAssetExposure: 25,
  maxCorrelatedExposure: 40,
  maxLeverage: 1,

  mode: "enforce",
  autoAdjustSize: true,
  requireApproval: true,
};

// ============================================================================
// Environment Loading
// ============================================================================

/**
 * Load risk kernel configuration from environment variables.
 * Falls back to defaults for any unset value.
 *
 * Environment variables (all optional):
 *   GORDON_RISK_MAX_POSITION_USD
 *   GORDON_RISK_MAX_POSITION_PERCENT
 *   GORDON_RISK_MAX_OPEN_POSITIONS
 *   GORDON_RISK_DAILY_LOSS_USD
 *   GORDON_RISK_DAILY_LOSS_PERCENT
 *   GORDON_RISK_MAX_DRAWDOWN_PERCENT
 *   GORDON_RISK_MAX_SINGLE_ASSET_EXPOSURE
 *   GORDON_RISK_MAX_CORRELATED_EXPOSURE
 *   GORDON_RISK_MAX_LEVERAGE
 *   GORDON_RISK_MODE (enforce | warn | paper)
 *   GORDON_RISK_AUTO_ADJUST (true | false)
 *   GORDON_RISK_REQUIRE_APPROVAL (true | false)
 */
export function loadConfigFromEnv(overrides?: Partial<RiskKernelConfig>): RiskKernelConfig {
  // Resolved rather than raw: the risk gate already reads GORDON_RISK_MODE through
  // the flag resolver, so reading process.env here meant a mode set via /flags
  // governed the gate but not the kernel it gates, and stopped applying at all on
  // the next restart. The two must not disagree about the same flag.
  const env = flagEnv();

  const raw: Record<string, unknown> = {
    maxPositionSizeUsd: parseEnvNumber(env.GORDON_RISK_MAX_POSITION_USD) ?? overrides?.maxPositionSizeUsd,
    maxPositionSizePercent: parseEnvNumber(env.GORDON_RISK_MAX_POSITION_PERCENT) ?? overrides?.maxPositionSizePercent,
    maxOpenPositions: parseEnvInt(env.GORDON_RISK_MAX_OPEN_POSITIONS) ?? overrides?.maxOpenPositions,
    dailyLossLimitUsd: parseEnvNumber(env.GORDON_RISK_DAILY_LOSS_USD) ?? overrides?.dailyLossLimitUsd,
    dailyLossLimitPercent: parseEnvNumber(env.GORDON_RISK_DAILY_LOSS_PERCENT) ?? overrides?.dailyLossLimitPercent,
    maxDrawdownPercent: parseEnvNumber(env.GORDON_RISK_MAX_DRAWDOWN_PERCENT) ?? overrides?.maxDrawdownPercent,
    maxSingleAssetExposure: parseEnvNumber(env.GORDON_RISK_MAX_SINGLE_ASSET_EXPOSURE) ?? overrides?.maxSingleAssetExposure,
    maxCorrelatedExposure: parseEnvNumber(env.GORDON_RISK_MAX_CORRELATED_EXPOSURE) ?? overrides?.maxCorrelatedExposure,
    maxLeverage: parseEnvNumber(env.GORDON_RISK_MAX_LEVERAGE) ?? overrides?.maxLeverage,
    mode: env.GORDON_RISK_MODE ?? overrides?.mode,
    autoAdjustSize: parseEnvBool(env.GORDON_RISK_AUTO_ADJUST) ?? overrides?.autoAdjustSize,
    requireApproval: parseEnvBool(env.GORDON_RISK_REQUIRE_APPROVAL) ?? overrides?.requireApproval,
  };

  // Strip undefined values so Zod defaults apply
  const cleaned = Object.fromEntries(
    Object.entries(raw).filter(([, v]) => v !== undefined)
  );

  const result = RiskKernelConfigSchema.safeParse(cleaned);

  if (!result.success) {
    logger.warn("Invalid risk config from environment, using defaults", {
      errors: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    });
    return { ...DEFAULT_RISK_CONFIG, ...overrides };
  }

  logger.debug("Risk kernel config loaded", {
    mode: result.data.mode,
    maxPositionSizeUsd: result.data.maxPositionSizeUsd,
    dailyLossLimitUsd: result.data.dailyLossLimitUsd,
    maxDrawdownPercent: result.data.maxDrawdownPercent,
  });

  return result.data;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Resolve the effective risk mode against live-venue state.
 *
 * `GORDON_RISK_MODE=warn` flows straight through `loadConfigFromEnv`, which
 * means a misconfigured operator could silently disable the hard sizing caps
 * on a LIVE venue (warn mode logs violations but lets every order through).
 * That is acceptable on a sandbox/paper venue where fills are simulated, but
 * never on real capital.
 *
 * Rule: when the venue is NOT sandbox/paper, `warn` is upgraded to `enforce`.
 *
 * `paper` is upgraded the same way, and for a stronger reason: paper mode
 * approves every order outright without running any check. The venue does not
 * block real fills — a live venue fills a live order regardless of what the
 * kernel calls its own mode. Returns the mode unchanged on a sandbox venue.
 */
export function resolveLiveSafeMode(
  mode: RiskKernelConfig["mode"],
  sandboxActive: boolean,
): RiskKernelConfig["mode"] {
  if (mode === "warn" && !sandboxActive) {
    logger.warn(
      "GORDON_RISK_MODE=warn overridden to enforce on a live venue — hard risk caps stay active on real capital",
    );
    return "enforce";
  }
  if (mode === "paper" && !sandboxActive) {
    logger.warn(
      "GORDON_RISK_MODE=paper overridden to enforce on a live venue — hard risk caps stay active on real capital",
    );
    return "enforce";
  }
  return mode;
}

function parseEnvNumber(val: string | undefined): number | undefined {
  if (val === undefined || val === "") return undefined;
  const num = Number(val);
  return Number.isFinite(num) ? num : undefined;
}

function parseEnvInt(val: string | undefined): number | undefined {
  if (val === undefined || val === "") return undefined;
  const num = parseInt(val, 10);
  return Number.isFinite(num) ? num : undefined;
}

function parseEnvBool(val: string | undefined): boolean | undefined {
  if (val === undefined || val === "") return undefined;
  return val.toLowerCase() === "true";
}
