/**
 * Gordon Permissions System
 *
 * Content-scoped permission rules for fine-grained trade approval control.
 * Rules match tool names + arg conditions; first matching rule wins.
 */

export {
  evaluateRules,
  PRESET_SMALL_TRADE_AUTO_APPROVE,
  PRESET_LARGE_TRADE_REQUIRE_APPROVAL,
  PRESET_BLOCK_SHORTING,
  PRESET_WHITELIST_SYMBOLS,
} from "./rules.ts";
export type {
  PermissionRule,
  PermissionDecision,
  ContentCondition,
  RuleBehavior,
  RuleSource,
  EvaluateInput,
} from "./rules.ts";

// Permission rule fast-path (short-circuits the ApprovalDialog)
export { quickPermissionCheck } from "./racing.ts";
