/**
 * Shared types and utilities for Mastra agent tools
 */

import type { RequestContext } from "@mastra/core/request-context";
import type { z, ZodType } from "zod";

import type { GordonContext } from "../types.ts";
import type { BinanceClient } from "../../binance/index.ts";
import type { LLMClient } from "../../llm/index.ts";
import type { GordonConfig } from "../../../types/index.ts";

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

  return {
    binance: rc.get("binance") as BinanceClient | undefined,
    llm: rc.get("llm") as LLMClient | undefined,
    config: rc.get("config") as GordonConfig | undefined,
    userId: rc.get("userId") as string | undefined,
  } as GordonContext;
}

/**
 * Standard error responses
 */
export const errors = {
  noBinance: { error: "Binance client not connected. Please configure API keys." },
  noLLM: { error: "LLM client not connected." },
  noContext: { error: "Context not available." },
  notArmed: (action: string) => ({
    error: `System must be ARMED to ${action}. Use 'arm' command first.`,
  }),
  insufficientData: (symbol: string) => ({
    error: `Insufficient data for ${symbol}. Need at least 50 candles.`,
  }),
} as const;

/**
 * Helper to normalize trading pair symbols
 */
export function normalizeSymbol(symbol: string): string {
  return symbol.toUpperCase().endsWith("USDT")
    ? symbol.toUpperCase()
    : `${symbol.toUpperCase()}USDT`;
}

/**
 * Helper to check if system is armed
 */
export function isArmed(ctx: GordonContext): boolean {
  return ctx.config?.mode === "ARMED";
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

/**
 * Creates a validated executor wrapper for a tool.
 *
 * This is a higher-order function that wraps a tool's execute function
 * to automatically validate its output against the schema.
 *
 * @example
 * ```typescript
 * const outputSchema = z.object({ success: z.boolean() });
 *
 * execute: createValidatedExecutor(
 *   outputSchema,
 *   async (input) => ({ success: true }),
 *   { toolName: "my_tool" }
 * )
 * ```
 *
 * @param schema - Zod schema to validate against
 * @param executor - The original execute function
 * @param options - Validation options
 * @returns Wrapped executor that validates output
 */
export function createValidatedExecutor<TInput, TOutput>(
  schema: ZodType<TOutput>,
  executor: (input: TInput, context?: MastraExecutionContext) => Promise<TOutput>,
  options: ValidateToolOutputOptions = {}
): (input: TInput, context?: MastraExecutionContext) => Promise<TOutput> {
  return async (input: TInput, context?: MastraExecutionContext): Promise<TOutput> => {
    const result = await executor(input, context);
    return validateToolOutput(schema, result, options);
  };
}
