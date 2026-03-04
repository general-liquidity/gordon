/**
 * Gordon SDK Error Hierarchy
 *
 * Maps gateway error codes to typed SDK exceptions, providing structured
 * error handling for external developers building on Gordon primitives.
 *
 * Error flow: gateway IPC response -> GatewayIPCResponse.error -> GordonSDKError subclass
 */

import type { GatewayErrorCode } from "../gateway/protocol/errors.ts";

// ============================================================================
// Base Error
// ============================================================================

/**
 * Base error class for all Gordon SDK errors.
 *
 * Every SDK error carries the original gateway error code (when available),
 * whether the operation can be retried, and optional structured details.
 *
 * @example
 * ```typescript
 * try {
 *   await client.scan();
 * } catch (err) {
 *   if (err instanceof GordonSDKError) {
 *     console.error(`[${err.code}] ${err.message}`);
 *     if (err.retryable) {
 *       // safe to retry after backoff
 *     }
 *   }
 * }
 * ```
 */
export class GordonSDKError extends Error {
  /** Gateway error code that triggered this error, if available. */
  readonly code: GatewayErrorCode | "SDK_ERROR";
  /** Whether the caller can safely retry the operation. */
  readonly retryable: boolean;
  /** Structured details from the gateway for diagnostics. */
  readonly details?: Record<string, unknown>;

  constructor(
    message: string,
    code: GatewayErrorCode | "SDK_ERROR" = "SDK_ERROR",
    retryable = false,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "GordonSDKError";
    this.code = code;
    this.retryable = retryable;
    this.details = details;
  }
}

// ============================================================================
// Connection Errors
// ============================================================================

/**
 * Raised when the SDK cannot reach the Gordon daemon over IPC.
 *
 * Common causes:
 * - Daemon is not running (`gordon daemon start`)
 * - Socket path is misconfigured
 * - Network / permission issue on the Unix domain socket or named pipe
 */
export class ConnectionError extends GordonSDKError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, "SDK_ERROR", true, details);
    this.name = "ConnectionError";
  }
}

// ============================================================================
// Authentication Errors
// ============================================================================

/**
 * Raised when the daemon rejects the supplied auth token or the token
 * lacks the required capability for the command being issued.
 */
export class AuthenticationError extends GordonSDKError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, "AUTH_REQUIRED", false, details);
    this.name = "AuthenticationError";
  }
}

// ============================================================================
// Queue / Backpressure Errors
// ============================================================================

/**
 * Raised when the gateway command queue is full for the current session.
 *
 * This is a transient condition -- retrying after a short delay is safe.
 */
export class QueueBackpressureError extends GordonSDKError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, "QUEUE_BACKPRESSURE", true, details);
    this.name = "QueueBackpressureError";
  }
}

// ============================================================================
// Risk Errors
// ============================================================================

/**
 * Raised when a command is blocked by the risk kernel or circuit breakers.
 *
 * This is NOT retryable in general -- the market conditions or position state
 * must change before the operation can succeed.
 */
export class RiskBlockedError extends GordonSDKError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, "RISK_BLOCKED", false, details);
    this.name = "RiskBlockedError";
  }
}

// ============================================================================
// Timeout Errors
// ============================================================================

/**
 * Raised when an IPC request to the daemon exceeds the configured timeout.
 *
 * Retryable, but consider increasing `timeoutMs` in SDKConfig if this recurs.
 */
export class TimeoutError extends GordonSDKError {
  /** How long the SDK waited (ms) before giving up. */
  readonly timeoutMs: number;

  constructor(message: string, timeoutMs: number, details?: Record<string, unknown>) {
    super(message, "SDK_ERROR", true, details);
    this.name = "TimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

// ============================================================================
// Validation Errors
// ============================================================================

/**
 * Raised when client-side Zod validation rejects the input before it
 * reaches the gateway, or when the gateway returns VALIDATION_ERROR.
 */
export class ValidationError extends GordonSDKError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, "VALIDATION_ERROR", false, details);
    this.name = "ValidationError";
  }
}

// ============================================================================
// Idempotency Conflict
// ============================================================================

/**
 * Raised when a command with the same idempotency key was already processed
 * with different parameters.
 */
export class IdempotencyConflictError extends GordonSDKError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, "IDEMPOTENCY_CONFLICT", false, details);
    this.name = "IdempotencyConflictError";
  }
}

// ============================================================================
// Circuit Breaker Errors
// ============================================================================

/**
 * Raised when a gateway circuit breaker is open, indicating repeated
 * downstream failures. Retry after the breaker half-opens.
 */
export class CircuitBreakerOpenError extends GordonSDKError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, "CIRCUIT_BREAKER_OPEN", true, details);
    this.name = "CircuitBreakerOpenError";
  }
}

// ============================================================================
// Handoff Budget Errors
// ============================================================================

/**
 * Raised when an agent handoff exceeds its allocated budget constraints.
 */
export class HandoffBudgetExceededError extends GordonSDKError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, "HANDOFF_BUDGET_EXCEEDED", false, details);
    this.name = "HandoffBudgetExceededError";
  }
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Map a raw gateway IPC error response into the appropriate SDK error subclass.
 *
 * @param error - The error payload from the GatewayIPCResponse
 * @returns A typed GordonSDKError subclass instance
 */
export function createSDKErrorFromGateway(error: {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  retryable?: boolean;
}): GordonSDKError {
  const code = error.code as GatewayErrorCode;
  const details = error.details;

  switch (code) {
    case "AUTH_REQUIRED":
    case "AUTH_INVALID":
      return new AuthenticationError(error.message, details);

    case "QUEUE_BACKPRESSURE":
      return new QueueBackpressureError(error.message, details);

    case "RISK_BLOCKED":
      return new RiskBlockedError(error.message, details);

    case "CIRCUIT_BREAKER_OPEN":
      return new CircuitBreakerOpenError(error.message, details);

    case "HANDOFF_BUDGET_EXCEEDED":
      return new HandoffBudgetExceededError(error.message, details);

    case "VALIDATION_ERROR":
      return new ValidationError(error.message, details);

    case "IDEMPOTENCY_CONFLICT":
      return new IdempotencyConflictError(error.message, details);

    case "REPLAY_DETECTED":
      return new GordonSDKError(error.message, code, false, details);

    case "COMMAND_NOT_SUPPORTED":
      return new GordonSDKError(error.message, code, false, details);

    case "INTERNAL_ERROR":
      return new GordonSDKError(error.message, code, true, details);

    default:
      return new GordonSDKError(
        error.message,
        "SDK_ERROR",
        error.retryable ?? false,
        details,
      );
  }
}

/**
 * Type guard to check if an unknown error is a GordonSDKError.
 */
export function isGordonSDKError(err: unknown): err is GordonSDKError {
  return err instanceof GordonSDKError;
}

/**
 * Type guard to check if a GordonSDKError is retryable.
 */
export function isRetryableError(err: unknown): boolean {
  return isGordonSDKError(err) && err.retryable;
}
