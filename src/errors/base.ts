/**
 * Base Error Classes
 * Unified error handling for Gordon
 */

/**
 * Base error class for all Gordon errors
 */
export class GordonError extends Error {
  public readonly code: string;
  public readonly timestamp: string;
  public readonly context?: Record<string, unknown>;

  constructor(
    message: string,
    code: string,
    context?: Record<string, unknown>
  ) {
    super(message);
    this.name = "GordonError";
    this.code = code;
    this.timestamp = new Date().toISOString();
    this.context = context;

    // Maintains proper stack trace for where error was thrown
    Error.captureStackTrace?.(this, this.constructor);
  }

  /**
   * Convert to JSON for logging/serialization
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      timestamp: this.timestamp,
      context: this.context,
      stack: this.stack,
    };
  }

  /**
   * Create a user-friendly message
   */
  toUserMessage(): string {
    return this.message;
  }
}

/**
 * Error for configuration issues
 */
export class ConfigurationError extends GordonError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, "CONFIG_ERROR", context);
    this.name = "ConfigurationError";
  }
}

/**
 * Error for validation failures
 */
export class ValidationError extends GordonError {
  public readonly field?: string;

  constructor(
    message: string,
    field?: string,
    context?: Record<string, unknown>
  ) {
    super(message, "VALIDATION_ERROR", { ...context, field });
    this.name = "ValidationError";
    this.field = field;
  }
}

/**
 * Error for when a resource is not found
 */
export class NotFoundError extends GordonError {
  public readonly resourceType: string;
  public readonly resourceId: string;

  constructor(resourceType: string, resourceId: string) {
    super(
      `${resourceType} not found: ${resourceId}`,
      "NOT_FOUND",
      { resourceType, resourceId }
    );
    this.name = "NotFoundError";
    this.resourceType = resourceType;
    this.resourceId = resourceId;
  }
}

/**
 * Error for unauthorized operations
 */
export class UnauthorizedError extends GordonError {
  constructor(message: string = "Unauthorized operation", context?: Record<string, unknown>) {
    super(message, "UNAUTHORIZED", context);
    this.name = "UnauthorizedError";
  }
}

/**
 * Error for operations that are not allowed in current state
 */
export class InvalidStateError extends GordonError {
  public readonly currentState: string;
  public readonly requiredState?: string;

  constructor(
    message: string,
    currentState: string,
    requiredState?: string,
    context?: Record<string, unknown>
  ) {
    super(message, "INVALID_STATE", { ...context, currentState, requiredState });
    this.name = "InvalidStateError";
    this.currentState = currentState;
    this.requiredState = requiredState;
  }
}

/**
 * Check if an error is a GordonError
 */
export function isGordonError(error: unknown): error is GordonError {
  return error instanceof GordonError;
}

/**
 * Wrap unknown errors in a GordonError
 */
export function wrapError(error: unknown, defaultMessage: string = "An unexpected error occurred"): GordonError {
  if (isGordonError(error)) {
    return error;
  }

  if (error instanceof Error) {
    return new GordonError(error.message, "UNKNOWN_ERROR", {
      originalName: error.name,
      originalStack: error.stack,
    });
  }

  return new GordonError(defaultMessage, "UNKNOWN_ERROR", {
    originalError: String(error),
  });
}
