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
  createAccessControlMiddleware,
  withAccessControl,
  requiresArmedMode,
  getTradingTools,
  formatRemainingTime,
  getArmedStatus,
  type AccessControlResult,
} from "./access-control.ts";
