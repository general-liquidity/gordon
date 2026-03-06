/**
 * Middleware Index
 * Exports all middleware functions for Mastra agents
 */

export {
  checkInputGuardrails,
  checkOutputGuardrails,
  validateTrade,
  validateRiskReward,
  withGuardrails,
  type TradeValidationInput,
  type RiskRewardInput,
} from "./guardrails.ts";

export {
  checkToolAccess,
  checkExplicitExecutionAccess,
  createAccessControlMiddleware,
  withAccessControl,
  requiresArmedMode,
  requiresArmedModeForTool,
  isStateModifyingTool,
  getTradingTools,
  formatRemainingTime,
  getArmedStatus,
  type AccessControlResult,
} from "./access-control.ts";
