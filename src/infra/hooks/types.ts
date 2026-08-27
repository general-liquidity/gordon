/**
 * Hooks Engine Types
 *
 * Gordon's extensibility layer — users define hooks in settings to inject
 * custom validators / logging / side-effects at key lifecycle points.
 * Inspired by Claude Code's hook system but trading-specific.
 *
 * Each hook point has its own payload shape + return semantics.
 */

/** Canonical runtime list. Config parsing and diagnostics import this same
 * value, so a newly declared point cannot silently disappear from either. */
export const HOOK_POINTS = [
  "PreToolUse",
  "PostToolUse",
  "PreCompact",
  "PostCompact",
  "SessionStart",
  "Stop",
  "UserPromptSubmit",
  "SessionEnd",
  "PreApproval",
  "PostApproval",
  "PreOrderPlacement",
  "PostOrderPlacement",
  "SubagentStart",
  "SubagentStop",
] as const;

export type HookPoint = (typeof HOOK_POINTS)[number];

export type HookAction =
  /** Let execution continue unchanged. */
  | "allow"
  /** Block execution. Payload carries the reason. */
  | "block"
  /** Modify the execution's args/result. Payload carries the mutation. */
  | "modify";

export interface HookResult {
  action: HookAction;
  /** Reason shown to user/logs when blocking. */
  reason?: string;
  /** New args/result when action is "modify". */
  replacement?: unknown;
  /** Custom metadata the hook wants to attach. */
  metadata?: Record<string, unknown>;
}

// ============================================================================
// Per-point payload shapes
// ============================================================================

export interface PreToolUsePayload {
  toolName: string;
  toolCallId: string;
  args: unknown;
  agentName?: string;
}

export interface PostToolUsePayload {
  toolName: string;
  toolCallId: string;
  args: unknown;
  result: unknown;
  durationMs: number;
  agentName?: string;
  success: boolean;
}

export interface PreCompactPayload {
  estimatedTokens: number;
  threshold: number;
  messageCount: number;
}

export interface PostCompactPayload {
  beforeTokens: number;
  afterTokens: number;
  clearedCount: number;
}

export interface SessionStartPayload {
  sessionId: string;
  userId?: string;
  threadId?: string;
  configSnapshot: Record<string, unknown>;
}

export interface StopPayload {
  reason: "user_interrupt" | "error" | "graceful" | "timeout";
  sessionId: string;
  error?: string;
}

export interface UserPromptSubmitPayload {
  /** Raw prompt text the user submitted. */
  prompt: string;
  /** Thread id, when available. */
  threadId?: string;
  /** Session id. */
  sessionId: string;
  /** ISO timestamp of submission. */
  submittedAt: string;
  /** Optional source (cli / tui / api / slash-command-expansion). */
  source?: "cli" | "tui" | "api" | "slash-command" | "external";
}

export interface SessionEndPayload {
  sessionId: string;
  threadId?: string;
  /** Why the session ended. */
  reason: "user_quit" | "timeout" | "error" | "graceful" | "external_signal";
  /** ISO timestamp. */
  endedAt: string;
  /** Total turns in the session, if tracked. */
  turnCount?: number;
  /** Total tool calls, if tracked. */
  toolCallCount?: number;
  /** Free-form summary the engine has assembled. */
  summary?: string;
}

export interface PreApprovalPayload {
  action: string;
  riskTier: "standard" | "high" | "critical";
  rationale: string;
  args: unknown;
}

export interface PostApprovalPayload {
  action: string;
  decision: "once" | "always" | "deny";
  args: unknown;
}

export interface PreOrderPlacementPayload {
  /**
   * Agent-issued order intent at a public execution boundary. This hook is
   * deliberately not a universal venue-adapter interceptor: protective exits,
   * emergency liquidation, reconciliation, and adapter-internal follow-ups
   * keep their dedicated safety invariants and cannot be stranded by a hook.
   */
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  orderType: string;
  notionalUsd: number;
  brokerId?: string;
  exchangeId?: string;
  /** Intended limit price for the order (omit for pure market orders). */
  limitPrice?: number;
  /** Live reference price (mid / last / mark) to sanity-check limitPrice against. */
  referencePrice?: number;
}

export interface PostOrderPlacementPayload {
  /** Venue acknowledgement/result for an agent-issued order intent. */
  orderId: string;
  symbol: string;
  side: "buy" | "sell";
  status: string;
  filledQty: number;
  notionalUsd: number;
}

export interface SubagentStartPayload {
  /** Stable ID for the subagent run — joins SubagentStart/Stop pairs. */
  subagentId: string;
  /** Logical agent type — e.g. "executor", "researcher", "fork:btc-analysis". */
  subagentType: string;
  /** Parent agent's name, when known. */
  parentAgent?: string;
  /** Brief description of the task the subagent was spawned for. */
  task?: string;
  /** Wall-clock when the subagent was spawned. */
  startedAt: number;
}

export interface SubagentStopPayload {
  subagentId: string;
  subagentType: string;
  parentAgent?: string;
  /** Wall-clock when the subagent stopped. */
  stoppedAt: number;
  /** Outcome — caller decides which one fits. */
  status: "completed" | "failed" | "aborted" | "timeout";
  /** Wall-clock duration of the run (ms). */
  durationMs: number;
  /** Optional structured result the subagent returned. */
  result?: unknown;
  /** Failure reason when status is failed/aborted/timeout. */
  error?: string;
  /** Token usage if available — keep raw for downstream cost rollups. */
  tokensUsed?: { input?: number; output?: number; total?: number };
}

export type HookPayloadMap = {
  PreToolUse: PreToolUsePayload;
  PostToolUse: PostToolUsePayload;
  PreCompact: PreCompactPayload;
  PostCompact: PostCompactPayload;
  SessionStart: SessionStartPayload;
  Stop: StopPayload;
  PreApproval: PreApprovalPayload;
  PostApproval: PostApprovalPayload;
  PreOrderPlacement: PreOrderPlacementPayload;
  PostOrderPlacement: PostOrderPlacementPayload;
  SubagentStart: SubagentStartPayload;
  SubagentStop: SubagentStopPayload;
  UserPromptSubmit: UserPromptSubmitPayload;
  SessionEnd: SessionEndPayload;
};

export type HookHandler<P extends HookPoint> = (
  payload: HookPayloadMap[P],
) => Promise<HookResult> | HookResult;

export interface HookDefinition<P extends HookPoint = HookPoint> {
  /** Unique hook name for logging / removal. */
  id: string;
  /** Hook point to attach to. */
  point: P;
  /** Handler function. */
  handler: HookHandler<P>;
  /** Execution priority (lower = runs first). Default 100. */
  priority?: number;
  /** Only fire for tools matching this glob (PreToolUse/PostToolUse only). */
  toolFilter?: string | RegExp;
  /** Source of the hook (for audit/debugging). */
  source?: "builtin" | "user" | "project" | "plugin";
  /**
   * Async-rewake mode (Claude Code v2.1.72+ pattern): the engine kicks off
   * this hook in parallel with other hooks at the same point, but still
   * awaits its result before the overall decision is returned. Unlike a
   * sync hook, a rewake hook runs concurrently. Both modes fail closed when a
   * handler throws and surface a "block" decision.
   *
   * Use for compliance / audit / external risk-check calls that take
   * hundreds of ms and don't depend on each other but DO need to gate
   * tool execution on failure.
   */
  asyncRewake?: boolean;
  /**
   * Short text shown in the UI / logged while this hook is executing.
   * Used to give the user feedback during slow hooks ("Verifying with
   * compliance API…"). Free-form, kept under ~80 chars in practice.
   */
  statusMessage?: string;
}
