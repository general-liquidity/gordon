/**
 * Gordon Hooks System
 *
 * User-extensible lifecycle hooks: register handlers that fire at key
 * points to enforce custom risk rules, log events, or veto operations.
 *
 * `HookPoint` declares 14 points, but only the two order-placement points
 * are actually emitted by production call sites today:
 *
 *   emitted : PreOrderPlacement, PostOrderPlacement
 *   declared but never reached : PreToolUse, PostToolUse, PreCompact,
 *     PostCompact, SessionStart, SessionEnd, Stop, UserPromptSubmit,
 *     PreApproval, PostApproval, SubagentStart, SubagentStop
 *
 * A hook registered at an unemitted point never runs. `checkHookCoverage`
 * in `infra/diagnostics/gateEnforcement.ts` reports that as a doctor
 * finding so an inert hook is visible instead of silently trusted.
 */

export {
  registerHook,
  unregisterHook,
  listHooks,
  clearHooks,
  runHooks,
  emitHook,
  setHookStatusListener,
} from "./engine.ts";
export type { HookStatusEvent } from "./engine.ts";
export {
  validateStructuredOutput,
  createPostToolOutputSchemaHook,
  createPreToolInputSchemaHook,
} from "./structuredOutputEnforcement.ts";
export type {
  StructuredValidationResult,
  StructuredValidationOk,
  StructuredValidationFail,
  CreatePostToolOutputHookOptions,
  CreatePreToolInputHookOptions,
} from "./structuredOutputEnforcement.ts";
export type {
  HookPoint,
  HookAction,
  HookResult,
  HookDefinition,
  HookHandler,
  HookPayloadMap,
  PreToolUsePayload,
  PostToolUsePayload,
  PreCompactPayload,
  PostCompactPayload,
  SessionStartPayload,
  StopPayload,
  PreApprovalPayload,
  PostApprovalPayload,
  PreOrderPlacementPayload,
  PostOrderPlacementPayload,
  SubagentStartPayload,
  SubagentStopPayload,
} from "./types.ts";
