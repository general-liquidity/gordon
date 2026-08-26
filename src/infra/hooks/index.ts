/**
 * Gordon Hooks System
 *
 * User-extensible lifecycle hooks: register handlers that fire at key
 * points to enforce custom risk rules, log events, or veto operations.
 *
 * Every declared HookPoint has a production bridge. `checkHookCoverage` in
 * `infra/diagnostics/gateEnforcement.ts` keeps that claim executable so a
 * future declaration cannot silently remain inert.
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
export {
  installExternalHooks,
  loadExternalHookConfig,
  resolveExternalHooksPath,
  getExternalHookInstallerState,
  EXTERNAL_HOOKS_PATH_ENV,
} from "./externalHookRegistry.ts";
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
