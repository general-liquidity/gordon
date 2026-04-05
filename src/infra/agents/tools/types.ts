/**
 * Shared types and utilities for Mastra agent tools
 */

import type { RequestContext } from "@mastra/core/request-context";
import type { z, ZodType } from "zod";

import type { GordonContext } from "../types.ts";
import type { ActionTaskScope, CredentialProfile } from "../../actions/types.ts";
import type { BinanceClient } from "../../binance/index.ts";
import type { Exchange } from "../../exchange/index.ts";
import type { BrokerAdapter } from "../../broker/index.ts";
import type { LLMClient } from "../../llm/index.ts";
import type { AgentRailsRegistry } from "../../rails/index.ts";
import type { GordonConfig } from "../../../types/index.ts";
import { normalizeCryptoSymbol } from "../../domain/markets/instruments.ts";
import {
  createErrorContext,
  formatErrorWithContext,
  type ErrorContext,
  type RecoveryStep,
} from "../../../utils/errorContext.ts";

// Re-export for convenience
export type { GordonContext };

/**
 * Mastra tool execution context type
 */
export interface MastraExecutionContext {
  requestContext?: RequestContext;
  tracingContext?: unknown;
  abortSignal?: AbortSignal;
}

/**
 * Extract GordonContext from Mastra's execution context
 * This bridges Mastra's RequestContext to our GordonContext type
 */
export function getGordonContext(execContext?: MastraExecutionContext): GordonContext | null {
  const rc = execContext?.requestContext;
  if (!rc) return null;

  // Get exchange (new abstract interface) or fall back to binance
  const exchange = rc.get("exchange") as Exchange | undefined;
  const binance = rc.get("binance") as BinanceClient | undefined;
  const broker = rc.get("broker") as BrokerAdapter | undefined;
  const agentRails = rc.get("agentRails") as AgentRailsRegistry | undefined;

  return {
    binance: binance,
    exchange: exchange ?? null,
    broker: broker ?? null,
    agentRails: agentRails ?? null,
    llm: rc.get("llm") as LLMClient | undefined,
    config: rc.get("config") as GordonConfig | undefined,
    portfolioValue: (rc.get("portfolioValue") as number | undefined) ?? 0,
    availableCash: (rc.get("availableCash") as number | undefined) ?? 0,
    userId: rc.get("userId") as string | undefined,
    threadId: rc.get("threadId") as string | undefined,
    requestedActionId: rc.get("requestedActionId") as string | undefined,
    requestedTaskScope: rc.get("requestedTaskScope") as ActionTaskScope | undefined,
    credentialProfile: rc.get("credentialProfile") as CredentialProfile | undefined,
    runtime: rc.get("runtime") as GordonContext["runtime"],
  } as GordonContext;
}

/**
 * Standard error responses
 */
export const errors = {
  /** @deprecated Use noExchange instead */
  noBinance: { error: "No active trading venue is connected. Please configure credentials." },
  noExchange: { error: "No active trading venue is connected. Please configure credentials." },
  noLLM: { error: "LLM client not connected." },
  noContext: { error: "Context not available." },
  notArmed: (action: string) => ({
    error: `permissionMode must not be 'strict' to ${action}. Use /auto or /ask.`,
  }),
  insufficientData: (symbol: string) => ({
    error: `Insufficient data for ${symbol}. Need at least 50 candles.`,
  }),
} as const;

/**
 * Helper to normalize trading pair symbols
 */
export function normalizeSymbol(symbol: string): string {
  return normalizeCryptoSymbol(symbol);
}

/**
 * Helper to check if system is armed
 */
export function isArmed(ctx: GordonContext): boolean {
  return ctx.config?.permissionMode !== "strict";
}

// ============================================================================
// Tool Output Validation
// ============================================================================

/**
 * Options for tool output validation behavior
 */
export interface ValidateToolOutputOptions {
  /** How to handle validation errors: 'throw' raises error, 'warn' logs and returns as-is */
  errorStrategy?: "throw" | "warn";
  /** Tool name for better error messages */
  toolName?: string;
}

/**
 * Result of tool output validation
 */
export interface ValidationResult<T> {
  success: boolean;
  data: T;
  errors?: string[];
}

/**
 * Validates tool output against a Zod schema.
 *
 * Use this to ensure tool outputs conform to their declared outputSchema,
 * preventing downstream errors from malformed data.
 *
 * @example
 * ```typescript
 * const outputSchema = z.object({ success: z.boolean(), value: z.number() });
 *
 * execute: async (input) => {
 *   const result = await doSomething(input);
 *   return validateToolOutput(outputSchema, result);
 * }
 * ```
 *
 * @param schema - Zod schema to validate against
 * @param result - The tool output to validate
 * @param options - Validation options
 * @returns The validated result (parsed by Zod for type coercion)
 * @throws Error if validation fails and errorStrategy is 'throw'
 */
export function validateToolOutput<T>(
  schema: ZodType<T>,
  result: unknown,
  options: ValidateToolOutputOptions = {}
): T {
  const { errorStrategy = "throw", toolName } = options;
  const prefix = toolName ? `Tool '${toolName}'` : "Tool";

  const parseResult = schema.safeParse(result);

  if (parseResult.success) {
    return parseResult.data;
  }

  const errorMessages = parseResult.error.issues.map(
    (issue) => `${issue.path.join(".")}: ${issue.message}`
  );
  const errorSummary = errorMessages.join("; ");

  if (errorStrategy === "warn") {
    console.warn(`${prefix} output validation failed: ${errorSummary}`);
    return result as T;
  }

  throw new Error(`${prefix} output validation failed: ${errorSummary}`);
}

// ============================================================================
// Tool Error Context Helpers
// ============================================================================

/**
 * Error response with enhanced context for tool outputs
 */
export interface ToolErrorResponse {
  /** Simple error message for backward compatibility */
  error: string;
  /** Structured error context for enhanced display */
  errorContext?: ErrorContext;
  /** Error code if available */
  errorCode?: string;
}

/**
 * Create a tool error response with enhanced context
 *
 * Use this when catching errors in tool execute functions to provide
 * detailed error context and recovery suggestions.
 *
 * @example
 * ```typescript
 * execute: async ({ symbol }) => {
 *   try {
 *     return await analyze(binance, symbol);
 *   } catch (error) {
 *     return createToolErrorResponse(
 *       error as Error,
 *       "analyze_coin",
 *       { symbol, timeframe: "15m" }
 *     );
 *   }
 * }
 * ```
 *
 * @param error - The error that occurred
 * @param operation - The tool/operation name
 * @param context - Additional context about what was being done
 * @returns ToolErrorResponse with structured context
 */
export function createToolErrorResponse(
  error: Error,
  operation: string,
  context?: Record<string, unknown>
): ToolErrorResponse {
  const errorCtx = createErrorContext(error, operation, context);

  return {
    error: errorCtx.reason,
    errorContext: errorCtx,
    errorCode: errorCtx.errorCode,
  };
}

/**
 * Format a ToolErrorResponse as a string for display
 * Useful when returning errors through text-based interfaces
 */
export function formatToolError(response: ToolErrorResponse): string {
  if (response.errorContext) {
    return formatErrorWithContext(response.errorContext);
  }
  return response.error;
}

/**
 * Wrap a tool executor with error context handling
 *
 * This higher-order function catches errors from the executor and
 * converts them to ToolErrorResponse format with full context.
 *
 * @example
 * ```typescript
 * execute: withErrorContext(
 *   "analyze_coin",
 *   async ({ symbol }, ctx) => {
 *     // Normal tool execution
 *     const result = await analyze(symbol);
 *     return { success: true, data: result };
 *   }
 * )
 * ```
 *
 * @param operation - The tool/operation name for error context
 * @param executor - The tool's execute function
 * @returns Wrapped executor that catches and enriches errors
 */
export function withErrorContext<TInput extends Record<string, unknown>, TOutput>(
  operation: string,
  executor: (input: TInput, context?: MastraExecutionContext) => Promise<TOutput>
): (input: TInput, context?: MastraExecutionContext) => Promise<TOutput | ToolErrorResponse> {
  return async (
    input: TInput,
    context?: MastraExecutionContext
  ): Promise<TOutput | ToolErrorResponse> => {
    try {
      return await executor(input, context);
    } catch (error) {
      return createToolErrorResponse(
        error instanceof Error ? error : new Error(String(error)),
        operation,
        input as Record<string, unknown>
      );
    }
  };
}

/**
 * Check if a result is a ToolErrorResponse
 */
export function isToolError(result: unknown): result is ToolErrorResponse {
  return (
    typeof result === "object" &&
    result !== null &&
    "error" in result &&
    typeof (result as ToolErrorResponse).error === "string"
  );
}

/**
 * Extract recovery steps from a ToolErrorResponse
 * Returns empty array if no context is available
 */
export function getRecoverySteps(response: ToolErrorResponse): RecoveryStep[] {
  return response.errorContext?.recoverySteps ?? [];
}

// ============================================================================
// Exchange Family Helpers
// ============================================================================

/**
 * Check if an exchange ID belongs to the Binance family (Global or US).
 * Use this for tools that rely on /api/v3 endpoints which work on both.
 * Do NOT use this for /sapi/* tools (earn, dust, wallet details) — those are Binance Global only.
 */
export function isBinanceFamily(id: string | undefined): boolean {
  return id === "binance" || id === "binance_us";
}

// Re-export error context types for convenience
export type { ErrorContext, RecoveryStep };
