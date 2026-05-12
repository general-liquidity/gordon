/**
 * Tool Error Normalizer.
 *
 * Wraps tool execution so any thrown exception becomes a structured
 * `{ status: "error", code, message, details? }` value instead of
 * propagating up as a runtime exception. The model sees a consistent
 * shape on failure (rather than the framework's varying error
 * surfaces — Mastra wraps differently than raw fetch, which wraps
 * differently than zod-validation throws), and the orchestrator
 * loop can decide whether to retry or escalate based on `code`.
 *
 * Inspired by open-swe's `tool_error_handler.py:64-104`. Distinct
 * from Gordon's existing `runtimeRecovery.ts` (which decides agent-
 * level escalation tiers): this layer normalizes the *result shape*,
 * leaving the runtime decision to higher layers.
 *
 * Pure function — no mutation, no side effects.
 */

import { classifyError, type RetryClassification } from "../../ai/retryPolicy.ts";

export interface ToolErrorResult {
  status: "error";
  /** Stable error code — matches retryPolicy classifications + tool-specific tags. */
  code: ToolErrorCode;
  /** Short human-readable message for the model to read. */
  message: string;
  /** Optional structured payload (validation errors, retry-after, etc.). */
  details?: Record<string, unknown>;
  /** Whether the agent should retry or escalate. Mirrors RetryDecision. */
  retryable: boolean;
}

export type ToolErrorCode =
  | RetryClassification
  | "validation_failed"
  | "not_implemented"
  | "permission_denied"
  | "tool_disabled"
  | "execution_timeout"
  | "tool_aborted";

export interface NormalizeOptions {
  /** Tool name — surfaced in the error message for debugging. */
  toolName?: string;
  /** Override the classification when the caller knows better than auto-detection. */
  classificationOverride?: ToolErrorCode;
  /** Cap the message length to keep the LLM context bounded. Default 600 chars. */
  maxMessageChars?: number;
}

const DEFAULT_MAX_MESSAGE_CHARS = 600;

/** Truncate a message at a char cap with ellipsis. */
function truncate(s: string, cap: number): string {
  if (s.length <= cap) return s;
  return `${s.slice(0, cap - 1)}…`;
}

/**
 * Normalize an arbitrary thrown value into a structured ToolErrorResult.
 * Caller wraps tool execution in try/catch, hands the caught value
 * here. Never throws — always returns a result.
 */
export function normalizeToolError(
  error: unknown,
  options: NormalizeOptions = {},
): ToolErrorResult {
  const cap = options.maxMessageChars ?? DEFAULT_MAX_MESSAGE_CHARS;

  // Caller-asserted classification wins over auto-detect.
  if (options.classificationOverride) {
    const message = errorToMessage(error, options.toolName);
    return {
      status: "error",
      code: options.classificationOverride,
      message: truncate(message, cap),
      retryable: !TERMINAL_OVERRIDE_CODES.has(options.classificationOverride),
    };
  }

  // Validation errors — when zod / schema layers throw, they usually
  // carry an `issues` array we can pass through as structured details.
  const validationDetails = extractValidationDetails(error);
  if (validationDetails) {
    return {
      status: "error",
      code: "validation_failed",
      message: truncate(`Tool "${options.toolName ?? "unknown"}" validation failed: ${validationDetails.summary}`, cap),
      details: { issues: validationDetails.issues },
      retryable: false,
    };
  }

  // AbortError → tool_aborted (caller cancelled, don't auto-retry).
  if (isAbortError(error)) {
    return {
      status: "error",
      code: "tool_aborted",
      message: truncate(`Tool "${options.toolName ?? "unknown"}" aborted before completion.`, cap),
      retryable: false,
    };
  }

  // Fall through to retryPolicy's classification.
  const decision = classifyError(error);
  const message = errorToMessage(error, options.toolName);
  return {
    status: "error",
    code: decision.classification,
    message: truncate(message, cap),
    retryable: decision.shouldRetry,
  };
}

const TERMINAL_OVERRIDE_CODES = new Set<ToolErrorCode>([
  "validation_failed",
  "not_implemented",
  "permission_denied",
  "tool_disabled",
  "tool_aborted",
  "auth",
  "bad_request",
  "quota_exceeded",
  "context_window",
  "content_filter",
]);

function errorToMessage(error: unknown, toolName?: string): string {
  const prefix = toolName ? `Tool "${toolName}" failed: ` : "";
  if (error == null) return `${prefix}unknown error`;
  if (error instanceof Error) return `${prefix}${error.message || error.name}`;
  if (typeof error === "string") return `${prefix}${error}`;
  try {
    return `${prefix}${JSON.stringify(error)}`;
  } catch {
    return `${prefix}non-serializable error`;
  }
}

interface ValidationDetails {
  summary: string;
  issues: Array<{ path?: string; message: string }>;
}

/**
 * Best-effort extraction of zod-style validation issues from a thrown
 * error. Returns null when the error doesn't look like a validation
 * failure — caller then falls through to retry-classification.
 */
function extractValidationDetails(error: unknown): ValidationDetails | null {
  if (typeof error !== "object" || error === null) return null;
  const obj = error as { issues?: unknown; name?: unknown };
  if (!Array.isArray(obj.issues)) return null;

  const issues: Array<{ path?: string; message: string }> = [];
  for (const issue of obj.issues) {
    if (typeof issue !== "object" || issue === null) continue;
    const i = issue as { path?: unknown; message?: unknown };
    const path = Array.isArray(i.path) ? i.path.join(".") : undefined;
    const message = typeof i.message === "string" ? i.message : "validation issue";
    issues.push(path ? { path, message } : { message });
  }
  if (issues.length === 0) return null;

  const summary = issues
    .slice(0, 3)
    .map((i) => (i.path ? `${i.path}: ${i.message}` : i.message))
    .join("; ");
  return { summary, issues };
}

function isAbortError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const obj = error as { name?: unknown; code?: unknown };
  return obj.name === "AbortError" || obj.code === "ABORT_ERR";
}

// ============================================================================
// Wrapper helper — wrap any async tool execute()
// ============================================================================

/**
 * Wrap an async tool execute function so thrown exceptions become
 * structured ToolErrorResult values. Caller decides where to apply
 * this — typically on tools whose failure modes vary by provider
 * (network, rate-limit, schema mismatch). Wrapped tools no longer
 * throw on tool-level failures, so the orchestrator must check the
 * `status` field of the return value.
 */
export function wrapToolExecute<TArgs, TResult>(
  toolName: string,
  execute: (args: TArgs) => Promise<TResult>,
): (args: TArgs) => Promise<TResult | ToolErrorResult> {
  return async (args: TArgs) => {
    try {
      return await execute(args);
    } catch (err) {
      return normalizeToolError(err, { toolName });
    }
  };
}
