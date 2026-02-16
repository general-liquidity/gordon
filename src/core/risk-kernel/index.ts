/**
 * Risk Kernel Module
 *
 * Mandatory middleware for all financial actions in Gordon.
 * Every order must pass through the Risk Kernel before execution.
 *
 * Usage:
 * ```ts
 * import { riskKernel } from "../core/risk-kernel/index.ts";
 *
 * const decision = await riskKernel.evaluate(order, portfolioContext);
 * if (!decision.approved) {
 *   // Order was rejected or needs modification
 *   console.log(decision.reason);
 *   return;
 * }
 * // Use decision.modifiedOrder ?? decision.originalOrder for execution
 * const finalOrder = decision.modifiedOrder ?? decision.originalOrder;
 * ```
 */

// Core kernel
export { RiskKernel } from "./kernel.ts";

// Configuration
export {
  type RiskKernelConfig,
  RiskKernelConfigSchema,
  DEFAULT_RISK_CONFIG,
  loadConfigFromEnv,
} from "./config.ts";

// Portfolio context
export {
  PortfolioContextBuilder,
  portfolioContextBuilder,
  type PortfolioContext,
  type OpenPosition,
  type CachedPortfolioState,
  PortfolioContextSchema,
  OpenPositionSchema,
} from "./portfolio-context.ts";

// Correlation
export {
  CorrelationChecker,
  correlationChecker,
  type CorrelationResult,
} from "./correlation.ts";

// Audit
export {
  RiskAuditLog,
  riskAuditLog,
  type RiskAuditEntry,
  type RiskDecision,
  type RiskCheck,
  type OrderRequest,
  RiskDecisionSchema,
  RiskCheckSchema,
  OrderRequestSchema,
} from "./audit.ts";

// ============================================================================
// Singleton Instance
// ============================================================================

import { RiskKernel } from "./kernel.ts";
import { loadConfigFromEnv } from "./config.ts";

/**
 * Default Risk Kernel singleton.
 * Loads configuration from environment variables with sensible defaults.
 * Import this for all risk evaluation calls.
 */
export const riskKernel = new RiskKernel(loadConfigFromEnv());
