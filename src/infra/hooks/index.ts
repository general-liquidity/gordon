/**
 * Gordon Hooks System
 *
 * User-extensible lifecycle hooks: register handlers that fire at key
 * points (PreToolUse, PreOrderPlacement, PreCompact, SessionStart, etc.)
 * to enforce custom risk rules, log events, or veto operations.
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
