/**
 * Retry Policy — typed classification of error → retry decision.
 *
 * Inspired by Aider's `ExInfo(retry: bool, description: str)` pattern:
 * each known error class is mapped to a structured decision rather
 * than a single `isRetryable` boolean. The richer classification lets
 * callers:
 *   - distinguish overloaded (back off long) from rate-limited (back
 *     off short) from network blip (retry quickly)
 *   - log a stable classification tag for telemetry
 *   - avoid retrying genuinely terminal errors (auth / bad request /
 *     quota_exceeded) that look transient by status code alone
 *
 * Gordon's existing `LLMError.isRetryable` (`src/infra/ai/llm/client.ts:53`)
 * keeps working — this module is additive. Sites that want richer
 * decisions opt in by calling `classifyError(err)` instead.
 */

export type RetryClassification =
  | "rate_limit" // 429 — model usage rate limit, retry with short backoff
  | "overloaded" // 529 / specific provider strings — retry with longer backoff
  | "server_error" // 500 / 502 / 503 — provider transient
  | "timeout" // upstream / our timeout — retry quickly
  | "network" // fetch failure / DNS / connection reset
  | "auth" // 401 / 403 — terminal, don't retry
  | "bad_request" // 400 / 422 — terminal, don't retry
  | "quota_exceeded" // hard quota cap — terminal until window resets
  | "context_window" // prompt too long — terminal, caller must compact
  | "content_filter" // safety / moderation block — terminal
  | "unknown"; // unclassified — caller decides default

export interface RetryDecision {
  /** Whether the caller should retry. */
  shouldRetry: boolean;
  /** Stable tag for logs / metrics. */
  classification: RetryClassification;
  /** Recommended initial delay (ms) before the next attempt. Caller still
   *  applies its own attempt-count backoff schedule on top. */
  recommendedDelayMs: number;
  /** Human-readable reason — surface to logs / debug UI. */
  reason: string;
  /** True when no further attempts will succeed regardless of delay. */
  terminal: boolean;
}

// Constants are intentionally exported so test harnesses can reference
// them without copy-pasting and call sites can override per-provider.
export const RETRY_CONSTANTS = {
  /** Default initial delay for transient classes. */
  baseDelayMs: 1_000,
  /** Cap on backoff delay regardless of class. */
  maxDelayMs: 60_000,
  /** Default attempts before giving up. */
  maxAttempts: 4,
} as const;

/** Per-classification recommended initial delay (ms). */
const DELAY_BY_CLASS: Record<RetryClassification, number> = {
  rate_limit: 2_000, // tight backoff — usually clears within a few seconds
  overloaded: 5_000, // provider is stressed; give it longer
  server_error: 1_500, // transient provider blip
  timeout: 500, // probably a tail-latency event
  network: 750, // DNS/connection blip
  auth: 0, // terminal — delay irrelevant
  bad_request: 0,
  quota_exceeded: 0, // terminal — would require human action
  context_window: 0, // terminal — caller must reshape prompt
  content_filter: 0,
  unknown: 1_000, // moderate default
};

const TERMINAL_CLASSES = new Set<RetryClassification>([
  "auth",
  "bad_request",
  "quota_exceeded",
  "context_window",
  "content_filter",
]);

function buildDecision(classification: RetryClassification, reason: string): RetryDecision {
  const terminal = TERMINAL_CLASSES.has(classification);
  return {
    shouldRetry: !terminal,
    classification,
    recommendedDelayMs: DELAY_BY_CLASS[classification],
    reason,
    terminal,
  };
}

/**
 * Map an HTTP status + provider error type to a retry decision.
 * Used directly in the LLM client when a non-2xx response comes back.
 */
export function classifyHttpStatus(status: number, errorType?: string): RetryDecision {
  // Provider-string overrides come first — sometimes the status is 200
  // but the body carries an error_type, and sometimes 503 hides an
  // overloaded condition the provider wants us to back off on.
  const lowerType = (errorType ?? "").toLowerCase();

  if (lowerType.includes("overloaded") || lowerType === "overloaded_error") {
    return buildDecision("overloaded", `provider overloaded (HTTP ${status})`);
  }
  if (
    lowerType.includes("context_length") ||
    lowerType.includes("context_window") ||
    lowerType.includes("prompt_too_long")
  ) {
    return buildDecision("context_window", `prompt exceeds context window`);
  }
  if (
    lowerType.includes("content_filter") ||
    lowerType.includes("content_policy") ||
    lowerType.includes("moderation")
  ) {
    return buildDecision("content_filter", `blocked by content moderation`);
  }
  if (
    lowerType.includes("quota") ||
    lowerType.includes("billing") ||
    lowerType.includes("insufficient_quota")
  ) {
    return buildDecision("quota_exceeded", `account quota exhausted`);
  }

  if (status === 429) {
    return buildDecision("rate_limit", `HTTP 429 — rate-limited by provider`);
  }
  if (status === 408) {
    return buildDecision("timeout", `HTTP 408 — request timeout`);
  }
  if (status === 401 || status === 403) {
    return buildDecision("auth", `HTTP ${status} — authentication / authorization failure`);
  }
  if (status === 400 || status === 422) {
    return buildDecision("bad_request", `HTTP ${status} — malformed request`);
  }
  if (status === 529) {
    return buildDecision("overloaded", `HTTP 529 — provider overloaded`);
  }
  if (status >= 500 && status < 600) {
    return buildDecision("server_error", `HTTP ${status} — provider transient`);
  }
  return buildDecision("unknown", `HTTP ${status} — unclassified`);
}

/**
 * Map an arbitrary thrown error to a retry decision. Falls through to
 * status-based classification when the error carries one; otherwise
 * does best-effort string matching for network / timeout signals.
 */
export function classifyError(error: unknown): RetryDecision {
  if (error == null) {
    return buildDecision("unknown", "no error object provided");
  }

  // Carry-status errors (LLMError has .statusCode and .errorType)
  if (typeof error === "object" && error !== null) {
    const obj = error as {
      statusCode?: unknown;
      errorType?: unknown;
      name?: unknown;
      message?: unknown;
    };
    if (typeof obj.statusCode === "number") {
      const errorType = typeof obj.errorType === "string" ? obj.errorType : undefined;
      return classifyHttpStatus(obj.statusCode, errorType);
    }

    // Native node fetch failure surfaces as TypeError("fetch failed")
    if (
      obj.name === "TypeError" &&
      typeof obj.message === "string" &&
      obj.message.includes("fetch failed")
    ) {
      return buildDecision("network", `fetch failed — likely connection / DNS issue`);
    }

    // AbortError → timeout
    if (obj.name === "AbortError") {
      return buildDecision("timeout", `request aborted (likely timeout)`);
    }
  }

  const msg = error instanceof Error ? error.message : String(error);
  const lower = msg.toLowerCase();
  if (lower.includes("timeout") || lower.includes("timed out")) {
    return buildDecision("timeout", msg);
  }
  if (
    lower.includes("econnreset") ||
    lower.includes("enotfound") ||
    lower.includes("etimedout") ||
    lower.includes("network")
  ) {
    return buildDecision("network", msg);
  }
  if (lower.includes("overload")) {
    return buildDecision("overloaded", msg);
  }

  return buildDecision("unknown", msg.slice(0, 200));
}

/**
 * Compute the actual delay for an attempt given the decision and the
 * current attempt count. Combines the per-class recommendation with
 * exponential backoff (factor 2) and a small jitter, capped at
 * RETRY_CONSTANTS.maxDelayMs. Caller picks attempt seed.
 *
 *   attempt=0 → recommendedDelayMs * (1 + jitter)
 *   attempt=1 → recommendedDelayMs * 2 * (1 + jitter)
 *   attempt=2 → recommendedDelayMs * 4 * (1 + jitter)
 */
export function backoffDelayMs(
  decision: RetryDecision,
  attempt: number,
  jitter: number = Math.random() * 0.2,
): number {
  const base = decision.recommendedDelayMs;
  const factor = 2 ** Math.max(0, attempt);
  const raw = base * factor * (1 + Math.max(0, Math.min(1, jitter)));
  return Math.min(RETRY_CONSTANTS.maxDelayMs, Math.round(raw));
}
