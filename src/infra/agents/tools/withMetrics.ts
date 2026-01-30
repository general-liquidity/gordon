/**
 * Tool Metrics Wrapper
 *
 * Wraps Mastra tools to automatically record metrics for each tool call.
 * This provides observability into tool usage patterns, success rates,
 * and helps identify problematic tools.
 */

import { recordToolCall } from "../../observability/metrics.ts";

/**
 * Wraps a single tool to record metrics on each execution.
 *
 * Records:
 * - Tool name
 * - Success/failure status
 *
 * Uses type assertion to preserve the original tool type while wrapping
 * the execute function with metrics recording.
 *
 * @param tool - The Mastra tool to wrap
 * @returns A new tool with metrics recording
 */
export function withToolMetrics<T extends { id: string; execute?: unknown }>(tool: T): T {
  // If no execute function, return as-is
  if (typeof tool.execute !== "function") {
    return tool;
  }

  const originalExecute = tool.execute as (...args: unknown[]) => Promise<unknown>;

  // Create a wrapped execute function that records metrics
  const wrappedExecute = async (...args: unknown[]): Promise<unknown> => {
    try {
      const result = await originalExecute.apply(tool, args);

      // Check if result indicates an error (tools often return { error: string })
      const isError = result &&
        typeof result === "object" &&
        result !== null &&
        "error" in result &&
        typeof (result as Record<string, unknown>).error === "string";

      recordToolCall(tool.id, !isError);

      return result;
    } catch (err) {
      recordToolCall(tool.id, false);
      throw err;
    }
  };

  // Return a new tool with the wrapped execute function
  // Use Object.create to preserve prototype chain
  const wrapped = Object.create(Object.getPrototypeOf(tool));
  Object.assign(wrapped, tool);
  wrapped.execute = wrappedExecute;

  return wrapped as T;
}

/**
 * Wraps all tools in an object to record metrics on each execution.
 *
 * @param tools - Object containing tools keyed by their ID
 * @returns Object with same structure but wrapped tools
 *
 * @example
 * ```typescript
 * import { marketTools } from "./market.ts";
 * import { withToolsMetrics } from "./withMetrics.ts";
 *
 * // Wrap all market tools with metrics
 * const instrumentedMarketTools = withToolsMetrics(marketTools);
 * ```
 */
export function withToolsMetrics<T extends Record<string, { id: string; execute?: unknown }>>(
  tools: T
): T {
  const wrapped = {} as Record<string, unknown>;

  for (const [key, tool] of Object.entries(tools)) {
    wrapped[key] = withToolMetrics(tool);
  }

  return wrapped as T;
}
