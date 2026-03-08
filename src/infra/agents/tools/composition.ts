/**
 * Tool Composition & Chaining Utilities
 *
 * Provides utilities for composing and chaining tool results:
 * - Sequential: Run tools in order, passing results forward
 * - Parallel: Run tools concurrently, combine results
 * - Conditional: Run tool B only if tool A succeeds
 *
 * This enables building complex analysis pipelines from atomic tools.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { getGordonContext, normalizeSymbol, type MastraExecutionContext } from "./types.ts";

// ============================================================================
// Types
// ============================================================================

/**
 * Result wrapper indicating success or failure
 */
export interface ToolResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * A step in a tool chain
 */
export interface ToolChainStep<TInput, TOutput> {
  /** Tool name/id to execute */
  tool: string;
  /** Transform input before passing to tool */
  transform?: (input: TInput) => unknown;
  /** Transform output before passing to next step */
  outputTransform?: (output: unknown) => TOutput;
}

/**
 * A chain of tools to execute sequentially
 */
export interface ToolChain<TInput, TOutput> {
  steps: ToolChainStep<unknown, unknown>[];
  execute: (input: TInput, context: MastraExecutionContext) => Promise<ToolResult<TOutput>>;
}

/**
 * Tool executor function type
 */
export type ToolExecutor = (
  toolId: string,
  input: unknown,
  context: MastraExecutionContext
) => Promise<unknown>;

// ============================================================================
// Tool Registry
// ============================================================================

/**
 * Generic tool type that may have an execute function
 */
interface MastraTool {
  id: string;
  execute?: (input: unknown, context: MastraExecutionContext) => Promise<unknown>;
}

// Lazy-loaded tool registry to avoid circular imports
let toolRegistry: Record<string, MastraTool> | null = null;

async function getToolRegistry(): Promise<Record<string, MastraTool>> {
  if (toolRegistry) return toolRegistry;

  // Import tools dynamically to avoid circular dependencies
  const { indicatorTools } = await import("./indicators.ts");
  const { marketAnalysisTools } = await import("./market-analysis.ts");
  const { orderbookTools } = await import("./orderbook.ts");

  toolRegistry = {
    ...indicatorTools,
    ...marketAnalysisTools,
    ...orderbookTools,
  } as Record<string, MastraTool>;

  return toolRegistry;
}

/**
 * Execute a tool by ID with given input and context
 */
export async function executeTool<T = unknown>(
  toolId: string,
  input: unknown,
  context: MastraExecutionContext
): Promise<T> {
  const registry = await getToolRegistry();
  const tool = registry[toolId];

  if (!tool) {
    return { error: `Tool not found: ${toolId}` } as T;
  }

  if (!tool.execute) {
    return { error: `Tool '${toolId}' does not have an execute function` } as T;
  }

  return tool.execute(input, context) as Promise<T>;
}

// ============================================================================
// Sequential Chaining
// ============================================================================

/**
 * Create a sequential tool chain that passes results from one tool to the next.
 *
 * @example
 * ```typescript
 * const chain = createToolChain([
 *   { tool: "get_technical_signals", transform: (s: string) => ({ symbol: s, interval: "4h" }) },
 *   { tool: "get_rsi", transform: (prev) => ({ symbol: prev.symbol, period: 14 }) },
 * ]);
 *
 * const result = await chain.execute("BTCUSDT", context);
 * ```
 */
export function createToolChain<TInput, TOutput>(
  steps: ToolChainStep<unknown, unknown>[]
): ToolChain<TInput, TOutput> {
  return {
    steps,
    execute: async (input: TInput, context: MastraExecutionContext): Promise<ToolResult<TOutput>> => {
      let currentValue: unknown = input;

      for (const step of steps) {
        const toolInput = step.transform ? step.transform(currentValue) : currentValue;

        const result = await executeTool(step.tool, toolInput, context);

        // Check for error in result
        if (isErrorResult(result)) {
          return { success: false, error: getErrorMessage(result) };
        }

        currentValue = step.outputTransform ? step.outputTransform(result) : result;
      }

      return { success: true, data: currentValue as TOutput };
    },
  };
}

/**
 * Run a tool chain with error handling
 */
export async function runChain<TInput, TOutput>(
  chain: ToolChain<TInput, TOutput>,
  input: TInput,
  context: MastraExecutionContext
): Promise<ToolResult<TOutput>> {
  return chain.execute(input, context);
}

// ============================================================================
// Parallel Execution
// ============================================================================

/**
 * Tool specification for parallel execution
 */
export interface ParallelToolSpec {
  tool: string;
  input: unknown;
}

/**
 * Run multiple tools in parallel and combine their results.
 *
 * @example
 * ```typescript
 * const results = await runParallel({
 *   signals: { tool: "get_technical_signals", input: { symbol: "BTCUSDT", interval: "4h" } },
 *   rsi: { tool: "get_rsi", input: { symbol: "BTCUSDT", period: 14 } },
 *   whales: { tool: "analyze_whale_orders", input: { symbol: "BTCUSDT" } },
 * }, context);
 * ```
 */
export async function runParallel<T extends Record<string, unknown>>(
  tools: { [K in keyof T]: ParallelToolSpec },
  context: MastraExecutionContext
): Promise<ToolResult<T>> {
  const keys = Object.keys(tools) as (keyof T)[];
  const specs = Object.values(tools) as ParallelToolSpec[];

  const results = await Promise.all(
    specs.map(async (spec) => {
      const result = await executeTool(spec.tool, spec.input, context);
      return { result, hasError: isErrorResult(result) };
    })
  );

  // Check for any errors
  const errors: string[] = [];
  const data = {} as T;

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]!;
    const { result, hasError } = results[i]!;

    if (hasError) {
      errors.push(`${String(key)}: ${getErrorMessage(result)}`);
    } else {
      data[key] = result as T[keyof T];
    }
  }

  if (errors.length > 0) {
    // Return partial success with errors noted
    return {
      success: errors.length < keys.length, // Partial success if at least one succeeded
      data: Object.keys(data).length > 0 ? data : undefined,
      error: errors.join("; "),
    };
  }

  return { success: true, data };
}

// ============================================================================
// Conditional Execution
// ============================================================================

/**
 * Condition function type
 */
export type ConditionFn<T> = (result: T) => boolean;

/**
 * Run tool B only if tool A succeeds and passes the condition.
 *
 * @example
 * ```typescript
 * const result = await runConditional(
 *   { tool: "get_technical_signals", input: { symbol: "BTCUSDT" } },
 *   { tool: "analyze_whale_orders", input: { symbol: "BTCUSDT" } },
 *   (signals) => signals.score > 50, // Only analyze whales if bullish
 *   context
 * );
 * ```
 */
export async function runConditional<TA, TB>(
  toolA: ParallelToolSpec,
  toolB: ParallelToolSpec,
  condition: ConditionFn<TA>,
  context: MastraExecutionContext
): Promise<ToolResult<{ first: TA; second?: TB; conditionMet: boolean }>> {
  const resultA = await executeTool<TA>(toolA.tool, toolA.input, context);

  if (isErrorResult(resultA)) {
    return { success: false, error: getErrorMessage(resultA) };
  }

  const conditionMet = condition(resultA);

  if (!conditionMet) {
    return {
      success: true,
      data: { first: resultA, conditionMet: false },
    };
  }

  const resultB = await executeTool<TB>(toolB.tool, toolB.input, context);

  if (isErrorResult(resultB)) {
    // Return first result with error note
    return {
      success: true,
      data: { first: resultA, conditionMet: true },
      error: `Second tool failed: ${getErrorMessage(resultB)}`,
    };
  }

  return {
    success: true,
    data: { first: resultA, second: resultB, conditionMet: true },
  };
}

/**
 * Run a sequence of conditional steps, stopping if any condition fails.
 */
export async function runConditionalChain<T>(
  steps: Array<{
    spec: ParallelToolSpec;
    condition?: ConditionFn<unknown>;
  }>,
  context: MastraExecutionContext
): Promise<ToolResult<T[]>> {
  const results: unknown[] = [];

  for (const step of steps) {
    const result = await executeTool(step.spec.tool, step.spec.input, context);

    if (isErrorResult(result)) {
      return { success: false, error: getErrorMessage(result), data: results as T[] };
    }

    results.push(result);

    // Check condition for next step
    if (step.condition && !step.condition(result)) {
      break;
    }
  }

  return { success: true, data: results as T[] };
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Check if a result indicates an error
 */
function isErrorResult(result: unknown): boolean {
  if (!result || typeof result !== "object") return false;
  return "error" in result && typeof (result as Record<string, unknown>).error === "string";
}

/**
 * Extract error message from a result
 */
function getErrorMessage(result: unknown): string {
  if (!result || typeof result !== "object") return "Unknown error";
  const error = (result as Record<string, unknown>).error;
  return typeof error === "string" ? error : "Unknown error";
}

/**
 * Calculate a combined score from multiple analysis results.
 * Weights can be adjusted based on signal reliability.
 */
export function calculateCombinedScore(
  signals: { score?: number; bias?: string } | null,
  rsi: { rsi?: string; signal?: string } | null,
  whales: { strength?: number; bias?: string } | null
): number {
  let score = 50; // Neutral baseline
  let factors = 0;

  // Technical signals contribution (weight: 40%)
  if (signals?.score !== undefined) {
    score += (signals.score / 100) * 40;
    factors++;
  }

  // RSI contribution (weight: 25%)
  if (rsi?.rsi) {
    const rsiValue = parseFloat(rsi.rsi);
    if (!isNaN(rsiValue)) {
      // RSI 30 = +25, RSI 50 = 0, RSI 70 = -25
      const rsiContribution = ((50 - rsiValue) / 50) * 25;
      score += rsiContribution;
      factors++;
    }
  }

  // Whale analysis contribution (weight: 35%)
  if (whales?.strength !== undefined && whales?.bias) {
    const whaleScore = whales.bias === "bullish" ? whales.strength : whales.bias === "bearish" ? -whales.strength : 0;
    score += (whaleScore / 100) * 35;
    factors++;
  }

  // Normalize if we have fewer factors
  if (factors > 0 && factors < 3) {
    const adjustment = (score - 50) * (3 / factors);
    score = 50 + adjustment;
  }

  return Math.max(0, Math.min(100, score));
}

// ============================================================================
// Pre-built Analysis Chains
// ============================================================================

/**
 * Pre-built chain for comprehensive technical analysis
 */
export const technicalAnalysisChain = createToolChain<string, unknown>([
  {
    tool: "get_technical_signals",
    transform: (input: unknown) => ({ symbol: String(input), interval: "4h" }),
  },
]);

/**
 * Pre-built chain for market structure analysis
 */
export const marketStructureChain = createToolChain<string, unknown>([
  {
    tool: "detect_consolidation",
    transform: (input: unknown) => ({ symbol: String(input), timeframe: "4h" }),
  },
]);

// ============================================================================
// Full Analysis Tool
// ============================================================================

/**
 * Full analysis result schema
 */
const fullAnalysisOutputSchema = z.object({
  symbol: z.string(),
  timestamp: z.string(),
  signals: z.object({
    symbol: z.string(),
    rsi: z.string().optional(),
    rsiSignal: z.string().optional(),
    trend: z.string().optional(),
    macd: z.string().optional(),
    priceVsEma200: z.string().optional(),
    bollingerPosition: z.string().optional(),
    bias: z.string().optional(),
    score: z.number().optional(),
    error: z.string().optional(),
  }).nullable(),
  rsi: z.object({
    symbol: z.string(),
    rsi: z.string().optional(),
    signal: z.string().optional(),
    action: z.string().optional(),
    interpretation: z.string().optional(),
    error: z.string().optional(),
  }).nullable(),
  whales: z.object({
    symbol: z.string(),
    bias: z.string().optional(),
    strength: z.number().optional(),
    whaleBidsValue: z.number().optional(),
    whaleAsksValue: z.number().optional(),
    interpretation: z.string().optional(),
    error: z.string().optional(),
  }).nullable(),
  orderbook: z.object({
    symbol: z.string(),
    spread: z.object({
      value: z.string(),
      percent: z.string(),
      bestBid: z.number(),
      bestAsk: z.number(),
    }).optional(),
    liquidity: z.object({
      bidDepth: z.string(),
      askDepth: z.string(),
      ratio: z.string(),
      imbalance: z.string(),
    }).optional(),
    error: z.string().optional(),
  }).nullable(),
  combinedScore: z.number(),
  consensus: z.enum(["STRONG_BULLISH", "BULLISH", "NEUTRAL", "BEARISH", "STRONG_BEARISH"]),
  confidence: z.number(),
  summary: z.string(),
  errors: z.array(z.string()).optional(),
});

/**
 * Run full analysis on a symbol combining multiple tools in parallel.
 * This is the core composition helper used by the run_full_analysis tool.
 */
export async function runFullAnalysis(
  symbol: string,
  context: MastraExecutionContext
): Promise<z.infer<typeof fullAnalysisOutputSchema>> {
  const normalizedSymbol = normalizeSymbol(symbol);

  // Run all analyses in parallel
  const [signalsResult, rsiResult, whalesResult, orderbookResult] = await Promise.all([
    executeTool("get_technical_signals", { symbol: normalizedSymbol, interval: "4h" }, context)
      .catch((err) => ({ error: err.message })),
    executeTool("get_rsi", { symbol: normalizedSymbol, interval: "4h", period: 14 }, context)
      .catch((err) => ({ error: err.message })),
    executeTool("analyze_whale_orders", { symbol: normalizedSymbol }, context)
      .catch((err) => ({ error: err.message })),
    executeTool("get_order_book", { symbol: normalizedSymbol, limit: 20 }, context)
      .catch((err) => ({ error: err.message })),
  ]);

  // Extract results with type safety
  const signals = !isErrorResult(signalsResult)
    ? (signalsResult as Record<string, unknown>)
    : null;
  const rsi = !isErrorResult(rsiResult)
    ? (rsiResult as Record<string, unknown>)
    : null;
  const whales = !isErrorResult(whalesResult)
    ? (whalesResult as Record<string, unknown>)
    : null;
  const orderbook = !isErrorResult(orderbookResult)
    ? (orderbookResult as Record<string, unknown>)
    : null;

  // Collect errors
  const errors: string[] = [];
  if (isErrorResult(signalsResult)) errors.push(`signals: ${getErrorMessage(signalsResult)}`);
  if (isErrorResult(rsiResult)) errors.push(`rsi: ${getErrorMessage(rsiResult)}`);
  if (isErrorResult(whalesResult)) errors.push(`whales: ${getErrorMessage(whalesResult)}`);
  if (isErrorResult(orderbookResult)) errors.push(`orderbook: ${getErrorMessage(orderbookResult)}`);

  // Calculate combined score
  const combinedScore = calculateCombinedScore(
    signals as { score?: number; bias?: string } | null,
    rsi as { rsi?: string; signal?: string } | null,
    whales as { strength?: number; bias?: string } | null
  );

  // Determine consensus and confidence
  let consensus: "STRONG_BULLISH" | "BULLISH" | "NEUTRAL" | "BEARISH" | "STRONG_BEARISH";
  if (combinedScore >= 75) {
    consensus = "STRONG_BULLISH";
  } else if (combinedScore >= 60) {
    consensus = "BULLISH";
  } else if (combinedScore >= 40) {
    consensus = "NEUTRAL";
  } else if (combinedScore >= 25) {
    consensus = "BEARISH";
  } else {
    consensus = "STRONG_BEARISH";
  }

  // Calculate confidence based on data availability and agreement
  const dataPoints = [signals, rsi, whales, orderbook].filter(Boolean).length;
  const baseConfidence = (dataPoints / 4) * 100;

  // Adjust confidence based on signal agreement
  const biases = [
    signals?.bias,
    rsi?.signal === "oversold" ? "bullish" : rsi?.signal === "overbought" ? "bearish" : "neutral",
    whales?.bias,
  ].filter(Boolean) as string[];

  const bullishCount = biases.filter((b) => b === "bullish").length;
  const bearishCount = biases.filter((b) => b === "bearish").length;
  const agreementBonus = (Math.max(bullishCount, bearishCount) / biases.length) * 20;

  const confidence = Math.min(100, baseConfidence + agreementBonus);

  // Generate summary
  let summary = `${normalizedSymbol} Analysis: `;

  if (signals?.score !== undefined) {
    summary += `Technical score ${signals.score}/100 (${signals.bias}). `;
  }

  if (rsi?.rsi) {
    summary += `RSI ${rsi.rsi} (${rsi.signal}). `;
  }

  if (whales?.bias) {
    summary += `Whale activity ${whales.bias} (strength: ${whales.strength}%). `;
  }

  if (orderbook?.liquidity) {
    const liquidity = orderbook.liquidity as Record<string, string>;
    summary += `Order book ${liquidity.imbalance}. `;
  }

  summary += `Combined score: ${combinedScore.toFixed(0)}/100 - ${consensus}.`;

  return {
    symbol: normalizedSymbol,
    timestamp: new Date().toISOString(),
    signals: signals as z.infer<typeof fullAnalysisOutputSchema>["signals"],
    rsi: rsi as z.infer<typeof fullAnalysisOutputSchema>["rsi"],
    whales: whales as z.infer<typeof fullAnalysisOutputSchema>["whales"],
    orderbook: orderbook as z.infer<typeof fullAnalysisOutputSchema>["orderbook"],
    combinedScore,
    consensus,
    confidence,
    summary,
    errors: errors.length > 0 ? errors : undefined,
  };
}

// ============================================================================
// Full Analysis Tool (Mastra Format)
// ============================================================================

export const runFullAnalysisTool = createTool({
  id: "run_full_analysis",
  description:
    "Run comprehensive analysis on a symbol combining technical signals, RSI, whale activity, " +
    "and orderbook analysis in parallel. Returns a combined score and consensus. " +
    "Use when user asks for 'full analysis', 'complete analysis', 'everything about BTC', " +
    "'comprehensive view', or wants to make a trading decision.",
  inputSchema: z.object({
    symbol: z.string().describe("Trading pair (e.g., 'BTCUSDT', 'BTC', 'ETHUSDT')"),
  }),
  outputSchema: fullAnalysisOutputSchema,
  execute: async ({ symbol }, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.exchange) {
      return {
        symbol,
        timestamp: new Date().toISOString(),
        signals: null,
        rsi: null,
        whales: null,
        orderbook: null,
        combinedScore: 50,
        consensus: "NEUTRAL" as const,
        confidence: 0,
        summary: "Unable to run analysis: Exchange client not connected.",
        errors: ["Exchange client not connected. Please configure API keys."],
      };
    }

    return runFullAnalysis(symbol, execContext);
  },
});

// ============================================================================
// Exports
// ============================================================================

/**
 * Composition tools exported as an object for Mastra Agent
 */
export const compositionTools = {
  run_full_analysis: runFullAnalysisTool,
};
