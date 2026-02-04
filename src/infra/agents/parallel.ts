/**
 * Parallel Execution Utilities for Gordon
 *
 * Provides parallel execution capabilities using Promise-based utilities
 * for running multiple operations concurrently.
 *
 * Key Features:
 * - runParallel: Execute multiple operations concurrently with concurrency control
 * - runParallelAgentCalls: Execute multiple agent operations concurrently
 * - runParallelCoinAnalysis: Analyze multiple coins in parallel
 * - runDeepParallelAnalysis: Run comprehensive deep analysis with all analyzers in parallel
 * - runMultiCoinParallelAnalysis: Analyze multiple coins with automatic result aggregation
 *
 * Note: This module focuses on practical Promise.all() based parallelism
 * rather than Mastra workflow system to avoid complexity and maintain simplicity.
 */

import { createModuleLogger } from "../logger/index.ts";
import type { GordonContext } from "./types.ts";
import type {
  StreamWriter,
  StreamChunk,
  StreamingWorkflowOptions,
  ProgressData,
  ResultData,
  AnalysisChunk,
  StreamingResult,
} from "./streamWriter.ts";
import {
  createChunk,
  createProgressChunk,
  createResultChunk,
  createErrorChunk,
  createStartChunk,
  createEndChunk,
  createHeartbeatChunk,
  createStreamingPipeline,
} from "./streamWriter.ts";

const logger = createModuleLogger("parallel");

// ============================================================================
// Types
// ============================================================================

/**
 * Result of a parallel operation
 */
export interface ParallelResult<T> {
  success: boolean;
  results: T[];
  errors: Array<{ index: number; error: string }>;
  duration: number;
  stats: {
    total: number;
    succeeded: number;
    failed: number;
  };
}

/**
 * Options for parallel execution
 */
export interface ParallelOptions {
  /** Maximum concurrent operations (default: 5) */
  concurrency?: number;
  /** Timeout per operation in ms (default: 30000) */
  timeout?: number;
  /** Whether to continue on error (default: true) */
  continueOnError?: boolean;
  /** Optional label for logging */
  label?: string;
}

/**
 * Agent call specification for parallel execution
 */
export interface AgentCallSpec<TInput, TOutput> {
  /** Unique identifier for this call */
  id: string;
  /** The async function to execute */
  execute: (input: TInput, context: GordonContext) => Promise<TOutput>;
  /** Input data for the call */
  input: TInput;
}

/**
 * Result of a single agent call in parallel execution
 */
export interface AgentCallResult<TOutput> {
  id: string;
  success: boolean;
  data?: TOutput;
  error?: string;
  duration: number;
}

/**
 * Result of parallel Scanner + Analyst workflow
 */
export interface ParallelScanAnalyzeResult {
  scan: {
    success: boolean;
    opportunities?: Array<{
      symbol: string;
      price: number;
      confidence: number;
      bias: string;
    }>;
    error?: string;
  };
  analysis: {
    success: boolean;
    data?: Record<string, unknown>;
    error?: string;
  };
  combined: {
    topOpportunity?: string;
    consensusBias?: string;
    confidence?: number;
  };
}

/**
 * Result of deep parallel analysis
 */
export interface DeepParallelAnalysisResult {
  symbol: string;
  timestamp: string;
  results: {
    scan?: { success: boolean; data?: unknown; error?: string };
    technical?: { success: boolean; data?: unknown; error?: string };
    whale?: { success: boolean; data?: unknown; error?: string };
    orderbook?: { success: boolean; data?: unknown; error?: string };
  };
  consensus?: {
    bias: string;
    confidence: number;
    agreementScore: number;
  };
  duration: number;
}

/**
 * Result of multi-coin parallel analysis
 */
export interface MultiCoinParallelResult {
  timestamp: string;
  coins: Array<{
    symbol: string;
    success: boolean;
    analysis?: unknown;
    error?: string;
  }>;
  summary: {
    total: number;
    analyzed: number;
    failed: number;
    topOpportunities: Array<{
      symbol: string;
      confidence: number;
      bias: string;
    }>;
  };
  duration: number;
}

/**
 * Workflow step definition (simplified)
 */
export interface WorkflowStepDef<TInput, TOutput> {
  id: string;
  description?: string;
  execute: (input: TInput) => Promise<TOutput>;
}

// ============================================================================
// Parallel Execution Core
// ============================================================================

/**
 * Execute multiple operations in parallel with concurrency control.
 *
 * @example
 * ```typescript
 * const results = await runParallel(
 *   [
 *     () => analyzeSymbol("BTCUSDT"),
 *     () => analyzeSymbol("ETHUSDT"),
 *     () => analyzeSymbol("SOLUSDT"),
 *   ],
 *   { concurrency: 3, label: "multi-coin-analysis" }
 * );
 * ```
 */
export async function runParallel<T>(
  operations: Array<() => Promise<T>>,
  options: ParallelOptions = {}
): Promise<ParallelResult<T>> {
  const {
    concurrency = 5,
    timeout = 30000,
    continueOnError = true,
    label = "parallel-operation",
  } = options;

  const startTime = Date.now();
  logger.info(`Starting parallel execution: ${label}`, {
    totalOperations: operations.length,
    concurrency,
  });

  const results: T[] = [];
  const errors: Array<{ index: number; error: string }> = [];

  // Process in batches based on concurrency
  for (let i = 0; i < operations.length; i += concurrency) {
    const batch = operations.slice(i, i + concurrency);
    const batchStartIndex = i;

    const batchPromises = batch.map(async (operation, batchIndex) => {
      const globalIndex = batchStartIndex + batchIndex;

      try {
        // Create a promise that races between the operation and timeout
        const result = await Promise.race([
          operation(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`Operation timed out after ${timeout}ms`)), timeout)
          ),
        ]);

        return { success: true, data: result, index: globalIndex };
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        logger.warn(`Parallel operation failed at index ${globalIndex}`, { error: errorMessage });

        if (!continueOnError) {
          throw err;
        }

        return { success: false, error: errorMessage, index: globalIndex };
      }
    });

    const batchResults = await Promise.all(batchPromises);

    for (const result of batchResults) {
      if (result.success && result.data !== undefined) {
        results.push(result.data);
      } else if (!result.success) {
        errors.push({ index: result.index, error: result.error || "Unknown error" });
      }
    }
  }

  const duration = Date.now() - startTime;

  logger.info(`Parallel execution complete: ${label}`, {
    succeeded: results.length,
    failed: errors.length,
    duration,
  });

  return {
    success: errors.length === 0,
    results,
    errors,
    duration,
    stats: {
      total: operations.length,
      succeeded: results.length,
      failed: errors.length,
    },
  };
}

/**
 * Execute multiple named agent calls in parallel.
 *
 * @example
 * ```typescript
 * const results = await runParallelAgentCalls([
 *   { id: "scanner", execute: scanMarket, input: { topN: 50 } },
 *   { id: "analyst", execute: analyzeTopCoin, input: { symbol: "BTC" } },
 * ], context);
 * ```
 */
export async function runParallelAgentCalls<TInput, TOutput>(
  calls: Array<AgentCallSpec<TInput, TOutput>>,
  context: GordonContext,
  options: ParallelOptions = {}
): Promise<Record<string, AgentCallResult<TOutput>>> {
  const startTime = Date.now();
  const { label = "agent-calls" } = options;

  logger.info(`Starting parallel agent calls: ${label}`, {
    callIds: calls.map((c) => c.id),
  });

  const operations = calls.map((call) => async () => {
    const callStart = Date.now();

    try {
      const result = await call.execute(call.input, context);
      return {
        id: call.id,
        success: true,
        data: result,
        duration: Date.now() - callStart,
      } as AgentCallResult<TOutput>;
    } catch (err) {
      return {
        id: call.id,
        success: false,
        error: err instanceof Error ? err.message : String(err),
        duration: Date.now() - callStart,
      } as AgentCallResult<TOutput>;
    }
  });

  const parallelResult = await runParallel(operations, { ...options, label });

  // Convert array results to record keyed by id
  const resultMap: Record<string, AgentCallResult<TOutput>> = {};

  for (const result of parallelResult.results) {
    resultMap[result.id] = result;
  }

  logger.info(`Parallel agent calls complete: ${label}`, {
    duration: Date.now() - startTime,
    succeeded: Object.values(resultMap).filter((r) => r.success).length,
  });

  return resultMap;
}

// ============================================================================
// Pre-built Parallel Operations
// ============================================================================

/**
 * Analyze multiple coins in parallel.
 *
 * @example
 * ```typescript
 * const results = await runParallelCoinAnalysis(
 *   ["BTCUSDT", "ETHUSDT", "SOLUSDT"],
 *   analyzeFunction,
 *   context
 * );
 * ```
 */
export async function runParallelCoinAnalysis<T>(
  symbols: string[],
  analyzeFunction: (symbol: string, context: GordonContext) => Promise<T>,
  context: GordonContext,
  options: ParallelOptions = {}
): Promise<ParallelResult<{ symbol: string; analysis: T }>> {
  const operations = symbols.map((symbol) => async () => {
    const analysis = await analyzeFunction(symbol, context);
    return { symbol, analysis };
  });

  return runParallel(operations, {
    ...options,
    label: options.label || `coin-analysis-${symbols.length}`,
  });
}

/**
 * Run multiple timeframe analyses in parallel for a single symbol.
 */
export async function runParallelTimeframeAnalysis<T>(
  symbol: string,
  timeframes: string[],
  analyzeFunction: (symbol: string, timeframe: string, context: GordonContext) => Promise<T>,
  context: GordonContext,
  options: ParallelOptions = {}
): Promise<ParallelResult<{ timeframe: string; analysis: T }>> {
  const operations = timeframes.map((timeframe) => async () => {
    const analysis = await analyzeFunction(symbol, timeframe, context);
    return { timeframe, analysis };
  });

  return runParallel(operations, {
    ...options,
    label: options.label || `timeframe-analysis-${symbol}`,
  });
}

// ============================================================================
// Deep Analysis Parallel Workflow
// ============================================================================

/**
 * Run comprehensive deep analysis using parallel execution.
 *
 * This is a practical alternative to complex workflows, using Promise.all()
 * for maximum parallelism when analyzing a single symbol.
 *
 * @example
 * ```typescript
 * const result = await runDeepParallelAnalysis(
 *   "BTCUSDT",
 *   {
 *     technical: technicalAnalysisFn,
 *     whale: whaleAnalysisFn,
 *     orderbook: orderbookAnalysisFn,
 *   },
 *   context
 * );
 * ```
 */
export async function runDeepParallelAnalysis(
  symbol: string,
  analyzers: {
    scan?: (context: GordonContext) => Promise<unknown>;
    technical?: (symbol: string, context: GordonContext) => Promise<unknown>;
    whale?: (symbol: string, context: GordonContext) => Promise<unknown>;
    orderbook?: (symbol: string, context: GordonContext) => Promise<unknown>;
  },
  context: GordonContext
): Promise<DeepParallelAnalysisResult> {
  const startTime = Date.now();
  const normalizedSymbol = symbol.toUpperCase().endsWith("USDT")
    ? symbol.toUpperCase()
    : `${symbol.toUpperCase()}USDT`;

  logger.info(`Starting deep parallel analysis for ${normalizedSymbol}`);

  // Build array of promises to run in parallel
  const promises: Array<{ key: string; promise: Promise<unknown> }> = [];

  if (analyzers.scan) {
    promises.push({
      key: "scan",
      promise: analyzers.scan(context).catch((err) => ({
        error: err instanceof Error ? err.message : String(err),
      })),
    });
  }

  if (analyzers.technical) {
    promises.push({
      key: "technical",
      promise: analyzers.technical(normalizedSymbol, context).catch((err) => ({
        error: err instanceof Error ? err.message : String(err),
      })),
    });
  }

  if (analyzers.whale) {
    promises.push({
      key: "whale",
      promise: analyzers.whale(normalizedSymbol, context).catch((err) => ({
        error: err instanceof Error ? err.message : String(err),
      })),
    });
  }

  if (analyzers.orderbook) {
    promises.push({
      key: "orderbook",
      promise: analyzers.orderbook(normalizedSymbol, context).catch((err) => ({
        error: err instanceof Error ? err.message : String(err),
      })),
    });
  }

  // Execute all in parallel
  const resolvedResults = await Promise.all(promises.map((p) => p.promise));

  // Map results back to keys
  const results: DeepParallelAnalysisResult["results"] = {};

  for (let i = 0; i < promises.length; i++) {
    const { key } = promises[i]!;
    const result = resolvedResults[i];

    const hasError = result && typeof result === "object" && "error" in result;

    results[key as keyof typeof results] = {
      success: !hasError,
      data: hasError ? undefined : result,
      error: hasError ? (result as { error: string }).error : undefined,
    };
  }

  // Calculate consensus from results
  const consensus = calculateConsensus(results);

  const duration = Date.now() - startTime;

  logger.info(`Deep parallel analysis complete for ${normalizedSymbol}`, {
    duration,
    analyzersRun: promises.length,
    succeeded: Object.values(results).filter((r) => r?.success).length,
  });

  return {
    symbol: normalizedSymbol,
    timestamp: new Date().toISOString(),
    results,
    consensus,
    duration,
  };
}

/**
 * Calculate consensus bias from multiple analysis results.
 */
function calculateConsensus(
  results: DeepParallelAnalysisResult["results"]
): DeepParallelAnalysisResult["consensus"] | undefined {
  const biases: string[] = [];
  const confidences: number[] = [];

  // Extract biases from each result
  if (results.scan?.success && results.scan.data) {
    const scanData = results.scan.data as { opportunities?: Array<{ bias: string }> };
    if (scanData.opportunities && scanData.opportunities.length > 0) {
      const dominantBias = scanData.opportunities[0]?.bias;
      if (dominantBias) biases.push(dominantBias);
    }
  }

  if (results.technical?.success && results.technical.data) {
    const techData = results.technical.data as { bias?: string; score?: number };
    if (techData.bias) {
      biases.push(techData.bias);
      if (techData.score !== undefined) {
        confidences.push(techData.score);
      }
    }
  }

  if (results.whale?.success && results.whale.data) {
    const whaleData = results.whale.data as { bias?: string; strength?: number };
    if (whaleData.bias) {
      biases.push(whaleData.bias);
      if (whaleData.strength !== undefined) {
        confidences.push(whaleData.strength);
      }
    }
  }

  if (biases.length === 0) {
    return undefined;
  }

  // Count bias occurrences
  const biasCounts: Record<string, number> = {};
  for (const bias of biases) {
    biasCounts[bias] = (biasCounts[bias] || 0) + 1;
  }

  // Find dominant bias
  let dominantBias = "neutral";
  let maxCount = 0;
  for (const [bias, count] of Object.entries(biasCounts)) {
    if (count > maxCount) {
      maxCount = count;
      dominantBias = bias;
    }
  }

  // Calculate agreement score (what % agree on dominant bias)
  const agreementScore = (maxCount / biases.length) * 100;

  // Average confidence
  const avgConfidence =
    confidences.length > 0
      ? confidences.reduce((sum, c) => sum + c, 0) / confidences.length
      : 50;

  return {
    bias: dominantBias,
    confidence: avgConfidence,
    agreementScore,
  };
}

// ============================================================================
// Multi-Coin Parallel Workflow
// ============================================================================

/**
 * Analyze multiple coins in parallel with automatic result aggregation.
 *
 * Ideal for comparing opportunities across the market.
 *
 * @example
 * ```typescript
 * const result = await runMultiCoinParallelAnalysis(
 *   ["BTCUSDT", "ETHUSDT", "SOLUSDT", "AVAXUSDT"],
 *   analyzeFunction,
 *   context,
 *   { concurrency: 3 }
 * );
 *
 * console.log(result.summary.topOpportunities);
 * ```
 */
export async function runMultiCoinParallelAnalysis(
  symbols: string[],
  analyzeFunction: (
    symbol: string,
    context: GordonContext
  ) => Promise<{ bias?: string; setupConfidence?: number; [key: string]: unknown }>,
  context: GordonContext,
  options: ParallelOptions = {}
): Promise<MultiCoinParallelResult> {
  const startTime = Date.now();

  logger.info(`Starting multi-coin parallel analysis`, {
    coinCount: symbols.length,
    concurrency: options.concurrency || 5,
  });

  const operations = symbols.map((symbol) => async () => {
    const normalizedSymbol = symbol.toUpperCase().endsWith("USDT")
      ? symbol.toUpperCase()
      : `${symbol.toUpperCase()}USDT`;

    try {
      const analysis = await analyzeFunction(normalizedSymbol, context);
      return { symbol: normalizedSymbol, success: true, analysis };
    } catch (err) {
      return {
        symbol: normalizedSymbol,
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });

  const parallelResult = await runParallel(operations, {
    ...options,
    label: options.label || `multi-coin-analysis-${symbols.length}`,
  });

  // Extract and rank opportunities
  const opportunities: Array<{ symbol: string; confidence: number; bias: string }> = [];

  for (const result of parallelResult.results) {
    if (result.success && result.analysis) {
      const analysis = result.analysis as { bias?: string; setupConfidence?: number };
      if (analysis.bias && analysis.setupConfidence !== undefined) {
        opportunities.push({
          symbol: result.symbol,
          confidence: analysis.setupConfidence,
          bias: analysis.bias,
        });
      }
    }
  }

  // Sort by confidence descending
  opportunities.sort((a, b) => b.confidence - a.confidence);

  const duration = Date.now() - startTime;

  logger.info(`Multi-coin parallel analysis complete`, {
    total: symbols.length,
    analyzed: parallelResult.stats.succeeded,
    topOpportunities: opportunities.slice(0, 3).map((o) => o.symbol),
    duration,
  });

  return {
    timestamp: new Date().toISOString(),
    coins: parallelResult.results,
    summary: {
      total: symbols.length,
      analyzed: parallelResult.stats.succeeded,
      failed: parallelResult.stats.failed,
      topOpportunities: opportunities.slice(0, 5),
    },
    duration,
  };
}

// ============================================================================
// Workflow Step Helper (Simplified)
// ============================================================================

/**
 * Create a simple workflow step (non-Mastra version for simplicity).
 * This is a lightweight alternative that doesn't require Mastra's complex type system.
 */
export function createWorkflowStep<TInput, TOutput>(
  def: WorkflowStepDef<TInput, TOutput>
): WorkflowStepDef<TInput, TOutput> {
  return def;
}

/**
 * Create a scan + analyze parallel workflow function.
 * Returns a function that runs both operations in parallel and combines results.
 */
export function createScanAnalyzeWorkflow(
  scanFunction: (context: GordonContext) => Promise<unknown>,
  analyzeFunction: (symbol: string, context: GordonContext) => Promise<unknown>,
  context: GordonContext
): (symbol: string) => Promise<ParallelScanAnalyzeResult> {
  return async (symbol: string): Promise<ParallelScanAnalyzeResult> => {
    const normalizedSymbol = symbol.toUpperCase().endsWith("USDT")
      ? symbol.toUpperCase()
      : `${symbol.toUpperCase()}USDT`;

    // Run scan and analyze in parallel
    const [scanResult, analyzeResult] = await Promise.all([
      scanFunction(context).catch((err) => ({
        error: err instanceof Error ? err.message : String(err),
      })),
      analyzeFunction(normalizedSymbol, context).catch((err) => ({
        error: err instanceof Error ? err.message : String(err),
      })),
    ]);

    // Process scan results
    const scanHasError = scanResult && typeof scanResult === "object" && "error" in scanResult;
    const scanOutput: ParallelScanAnalyzeResult["scan"] = scanHasError
      ? { success: false, error: (scanResult as { error: string }).error }
      : {
          success: true,
          opportunities: extractOpportunities(scanResult),
        };

    // Process analysis results
    const analyzeHasError = analyzeResult && typeof analyzeResult === "object" && "error" in analyzeResult;
    const analysisOutput: ParallelScanAnalyzeResult["analysis"] = analyzeHasError
      ? { success: false, error: (analyzeResult as { error: string }).error }
      : {
          success: true,
          data: analyzeResult as Record<string, unknown>,
        };

    // Generate combined result
    const combined: ParallelScanAnalyzeResult["combined"] = {};

    if (scanOutput.success && scanOutput.opportunities && scanOutput.opportunities.length > 0) {
      combined.topOpportunity = scanOutput.opportunities[0]?.symbol;
    }

    if (analysisOutput.success && analysisOutput.data) {
      const analysisData = analysisOutput.data as { bias?: string; setupConfidence?: number };
      combined.consensusBias = analysisData.bias;
      combined.confidence = analysisData.setupConfidence;
    }

    return {
      scan: scanOutput,
      analysis: analysisOutput,
      combined,
    };
  };
}

/**
 * Helper to extract opportunities from scan result
 */
function extractOpportunities(
  scanResult: unknown
): Array<{ symbol: string; price: number; confidence: number; bias: string }> | undefined {
  if (!scanResult || typeof scanResult !== "object") return undefined;

  const result = scanResult as {
    coins?: Array<{
      symbol: string;
      price: number;
      setupConfidence: number;
      bias: string;
      setupDetected?: boolean;
    }>;
    opportunities?: Array<{
      symbol: string;
      price: number;
      setupConfidence: number;
      bias: string;
    }>;
  };

  // Try coins array first (raw scan result)
  if (result.coins) {
    return result.coins
      .filter((c) => c.setupDetected)
      .slice(0, 5)
      .map((c) => ({
        symbol: c.symbol,
        price: c.price,
        confidence: c.setupConfidence,
        bias: c.bias,
      }));
  }

  // Try opportunities array (processed result)
  if (result.opportunities) {
    return result.opportunities.slice(0, 5).map((o) => ({
      symbol: o.symbol,
      price: o.price,
      confidence: o.setupConfidence,
      bias: o.bias,
    }));
  }

  return undefined;
}

// ============================================================================
// Streaming Workflow Support (Mastra pipeTo Pattern)
// ============================================================================

/**
 * Streaming workflow result
 */
export interface StreamingWorkflowResult<T> {
  /** Stream that can be piped to a writer */
  pipeTo: (writer: StreamWriter<T>) => Promise<StreamingResult<T>>;
  /** Async iterator for consuming stream directly */
  [Symbol.asyncIterator]: () => AsyncIterator<T>;
}

/**
 * Options for streaming parallel analysis
 */
export interface StreamingParallelOptions extends ParallelOptions {
  /** Enable progress reporting */
  enableProgress?: boolean;
  /** Enable heartbeat for long operations */
  enableHeartbeat?: boolean;
  /** Heartbeat interval in ms */
  heartbeatInterval?: number;
}

/**
 * Create a streaming workflow that supports pipeTo(writer) pattern.
 *
 * This is the main entry point for Mastra-style workflow streaming.
 * The returned object can be piped to any StreamWriter implementation.
 *
 * @example
 * ```typescript
 * const workflow = createStreamingWorkflow(async function* () {
 *   yield { type: "progress", step: "Scanning", current: 0, total: 5 };
 *   const result = await scan();
 *   yield { type: "result", data: result };
 * });
 *
 * // Pipe to a custom writer
 * await workflow.pipeTo(myWebSocketWriter);
 * ```
 */
export function createStreamingWorkflow<T>(
  generator: () => AsyncGenerator<T, void, unknown>,
  options?: StreamingWorkflowOptions
): StreamingWorkflowResult<T> {
  const source = generator();
  return createStreamingPipeline(source, options);
}

/**
 * Stream parallel analysis results for a single symbol.
 *
 * This function executes multiple analyzers in parallel and streams
 * progress and results to the provided writer in real-time.
 *
 * @example
 * ```typescript
 * const writer = createConsoleWriter();
 * await streamParallelAnalysis("BTCUSDT", writer, {
 *   technical: technicalAnalysisFn,
 *   whale: whaleAnalysisFn,
 *   orderbook: orderbookAnalysisFn,
 * }, context);
 * ```
 */
export async function streamParallelAnalysis(
  symbol: string,
  writer: StreamWriter<AnalysisChunk | ProgressData>,
  analyzers: {
    scan?: (context: GordonContext) => Promise<unknown>;
    technical?: (symbol: string, context: GordonContext) => Promise<unknown>;
    whale?: (symbol: string, context: GordonContext) => Promise<unknown>;
    orderbook?: (symbol: string, context: GordonContext) => Promise<unknown>;
  },
  context: GordonContext,
  options?: StreamingParallelOptions
): Promise<StreamingResult<DeepParallelAnalysisResult>> {
  const startTime = Date.now();
  const normalizedSymbol = symbol.toUpperCase().endsWith("USDT")
    ? symbol.toUpperCase()
    : `${symbol.toUpperCase()}USDT`;

  logger.info(`Starting streaming parallel analysis for ${normalizedSymbol}`);

  // Count total analyzers
  const analyzerKeys = Object.keys(analyzers).filter(
    (k) => analyzers[k as keyof typeof analyzers] !== undefined
  );
  const total = analyzerKeys.length;
  let completed = 0;
  let errors = 0;
  let chunksWritten = 0;

  try {
    // Write start chunk
    await writer.write(createStartChunk(`parallel-analysis-${normalizedSymbol}`, total) as unknown as StreamChunk<AnalysisChunk | ProgressData>);
    chunksWritten++;

    // Write initial progress
    if (options?.enableProgress !== false) {
      await writer.write(createProgressChunk({
        step: "Starting analysis",
        current: 0,
        total,
        percent: 0,
        status: "running",
      }, normalizedSymbol) as unknown as StreamChunk<AnalysisChunk | ProgressData>);
      chunksWritten++;
    }

    // Setup heartbeat if enabled
    let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
    if (options?.enableHeartbeat) {
      const interval = options.heartbeatInterval || 5000;
      heartbeatInterval = setInterval(async () => {
        try {
          await writer.write(createHeartbeatChunk(normalizedSymbol) as unknown as StreamChunk<AnalysisChunk | ProgressData>);
        } catch {
          // Ignore heartbeat errors
        }
      }, interval);
    }

    // Build promises for parallel execution
    const results: DeepParallelAnalysisResult["results"] = {};
    const promises: Array<{ key: string; promise: Promise<void> }> = [];

    const createAnalyzerPromise = (
      key: keyof typeof analyzers,
      executeFn: () => Promise<unknown>
    ) => {
      return async () => {
        const analyzerStart = Date.now();

        try {
          const result = await executeFn();
          const duration = Date.now() - analyzerStart;

          results[key] = {
            success: true,
            data: result,
          };

          // Stream result
          const analysisChunk: AnalysisChunk = {
            symbol: normalizedSymbol,
            success: true,
            analysis: result as AnalysisChunk["analysis"],
            duration,
          };

          await writer.write(createChunk("result", analysisChunk, {
            source: `${normalizedSymbol}-${key}`,
          }) as unknown as StreamChunk<AnalysisChunk | ProgressData>);
          chunksWritten++;

          completed++;

          // Stream progress update
          if (options?.enableProgress !== false) {
            await writer.write(createProgressChunk({
              step: `Completed ${key} analysis`,
              current: completed,
              total,
              percent: Math.round((completed / total) * 100),
              status: completed === total ? "completed" : "running",
            }, normalizedSymbol) as unknown as StreamChunk<AnalysisChunk | ProgressData>);
            chunksWritten++;
          }
        } catch (err) {
          const duration = Date.now() - analyzerStart;
          const errorMessage = err instanceof Error ? err.message : String(err);

          results[key] = {
            success: false,
            error: errorMessage,
          };

          // Stream error
          await writer.write(createErrorChunk(
            err instanceof Error ? err : new Error(errorMessage),
            `${normalizedSymbol}-${key}`
          ) as unknown as StreamChunk<AnalysisChunk | ProgressData>);
          chunksWritten++;
          errors++;

          completed++;

          // Stream progress update even on error
          if (options?.enableProgress !== false) {
            await writer.write(createProgressChunk({
              step: `Failed ${key} analysis`,
              current: completed,
              total,
              percent: Math.round((completed / total) * 100),
              status: completed === total ? "completed" : "running",
            }, normalizedSymbol) as unknown as StreamChunk<AnalysisChunk | ProgressData>);
            chunksWritten++;
          }
        }
      };
    };

    // Build promises for each analyzer
    if (analyzers.scan) {
      promises.push({
        key: "scan",
        promise: createAnalyzerPromise("scan", () => analyzers.scan!(context))(),
      });
    }

    if (analyzers.technical) {
      promises.push({
        key: "technical",
        promise: createAnalyzerPromise("technical", () => analyzers.technical!(normalizedSymbol, context))(),
      });
    }

    if (analyzers.whale) {
      promises.push({
        key: "whale",
        promise: createAnalyzerPromise("whale", () => analyzers.whale!(normalizedSymbol, context))(),
      });
    }

    if (analyzers.orderbook) {
      promises.push({
        key: "orderbook",
        promise: createAnalyzerPromise("orderbook", () => analyzers.orderbook!(normalizedSymbol, context))(),
      });
    }

    // Execute all in parallel
    await Promise.all(promises.map((p) => p.promise));

    // Clear heartbeat
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
    }

    // Calculate consensus
    const consensus = calculateConsensus(results);
    const duration = Date.now() - startTime;

    const finalResult: DeepParallelAnalysisResult = {
      symbol: normalizedSymbol,
      timestamp: new Date().toISOString(),
      results,
      consensus,
      duration,
    };

    // Write end chunk with summary
    await writer.write(createEndChunk(`parallel-analysis-${normalizedSymbol}`, {
      symbol: normalizedSymbol,
      duration,
      succeeded: Object.values(results).filter((r) => r?.success).length,
      failed: Object.values(results).filter((r) => !r?.success).length,
      consensus,
    }) as unknown as StreamChunk<AnalysisChunk | ProgressData>);
    chunksWritten++;

    await writer.close();

    logger.info(`Streaming parallel analysis complete for ${normalizedSymbol}`, {
      duration,
      chunksWritten,
      errors,
    });

    return {
      chunksWritten,
      errors,
      duration,
      summary: finalResult,
    };
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    logger.error(`Streaming parallel analysis failed for ${normalizedSymbol}`, error);

    await writer.write(createErrorChunk(error, normalizedSymbol) as unknown as StreamChunk<AnalysisChunk | ProgressData>);

    if (writer.abort) {
      await writer.abort(error);
    } else {
      await writer.close();
    }

    return {
      chunksWritten: chunksWritten + 1,
      errors: errors + 1,
      duration: Date.now() - startTime,
    };
  }
}

/**
 * Stream multi-coin analysis results as they complete.
 *
 * This function analyzes multiple coins in parallel and streams
 * results to the writer as each coin analysis completes.
 *
 * @example
 * ```typescript
 * const writer = createArrayWriter<AnalysisChunk>();
 * await streamMultiCoinAnalysis(
 *   ["BTCUSDT", "ETHUSDT", "SOLUSDT"],
 *   writer,
 *   analyzeFunction,
 *   context
 * );
 * console.log(writer.getResults());
 * ```
 */
export async function streamMultiCoinAnalysis(
  symbols: string[],
  writer: StreamWriter<AnalysisChunk | ProgressData>,
  analyzeFunction: (
    symbol: string,
    context: GordonContext
  ) => Promise<{ bias?: string; setupConfidence?: number; [key: string]: unknown }>,
  context: GordonContext,
  options?: StreamingParallelOptions
): Promise<StreamingResult<MultiCoinParallelResult>> {
  const startTime = Date.now();
  const { concurrency = 5 } = options || {};

  logger.info(`Starting streaming multi-coin analysis`, {
    coinCount: symbols.length,
    concurrency,
  });

  const total = symbols.length;
  let completed = 0;
  let succeeded = 0;
  let errors = 0;
  let chunksWritten = 0;

  const results: MultiCoinParallelResult["coins"] = [];
  const opportunities: Array<{ symbol: string; confidence: number; bias: string }> = [];

  try {
    // Write start chunk
    await writer.write(createStartChunk(`multi-coin-analysis`, total) as unknown as StreamChunk<AnalysisChunk | ProgressData>);
    chunksWritten++;

    // Write initial progress
    if (options?.enableProgress !== false) {
      await writer.write(createProgressChunk({
        step: "Starting multi-coin analysis",
        current: 0,
        total,
        percent: 0,
        status: "running",
      }, "multi-coin") as unknown as StreamChunk<AnalysisChunk | ProgressData>);
      chunksWritten++;
    }

    // Setup heartbeat if enabled
    let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
    if (options?.enableHeartbeat) {
      const interval = options.heartbeatInterval || 5000;
      heartbeatInterval = setInterval(async () => {
        try {
          await writer.write(createHeartbeatChunk("multi-coin") as unknown as StreamChunk<AnalysisChunk | ProgressData>);
        } catch {
          // Ignore heartbeat errors
        }
      }, interval);
    }

    // Process symbols in batches based on concurrency
    for (let i = 0; i < symbols.length; i += concurrency) {
      const batch = symbols.slice(i, i + concurrency);

      const batchPromises = batch.map(async (symbol) => {
        const normalizedSymbol = symbol.toUpperCase().endsWith("USDT")
          ? symbol.toUpperCase()
          : `${symbol.toUpperCase()}USDT`;

        const analyzeStart = Date.now();

        try {
          const analysis = await analyzeFunction(normalizedSymbol, context);
          const duration = Date.now() - analyzeStart;

          // Store result
          results.push({
            symbol: normalizedSymbol,
            success: true,
            analysis,
          });

          // Track opportunity
          if (analysis.bias && analysis.setupConfidence !== undefined) {
            opportunities.push({
              symbol: normalizedSymbol,
              confidence: analysis.setupConfidence,
              bias: analysis.bias,
            });
          }

          // Stream result
          const analysisChunk: AnalysisChunk = {
            symbol: normalizedSymbol,
            success: true,
            analysis: {
              bias: analysis.bias,
              setupConfidence: analysis.setupConfidence,
              ...analysis,
            },
            duration,
          };

          await writer.write(createChunk("result", analysisChunk, {
            source: normalizedSymbol,
          }) as unknown as StreamChunk<AnalysisChunk | ProgressData>);
          chunksWritten++;
          succeeded++;
        } catch (err) {
          const duration = Date.now() - analyzeStart;
          const errorMessage = err instanceof Error ? err.message : String(err);

          // Store error result
          results.push({
            symbol: normalizedSymbol,
            success: false,
            error: errorMessage,
          });

          // Stream error
          const analysisChunk: AnalysisChunk = {
            symbol: normalizedSymbol,
            success: false,
            error: errorMessage,
            duration,
          };

          await writer.write(createChunk("result", analysisChunk, {
            source: normalizedSymbol,
          }) as unknown as StreamChunk<AnalysisChunk | ProgressData>);
          chunksWritten++;
          errors++;
        }

        completed++;

        // Stream progress update
        if (options?.enableProgress !== false) {
          await writer.write(createProgressChunk({
            step: `Analyzed ${completed}/${total} coins`,
            current: completed,
            total,
            percent: Math.round((completed / total) * 100),
            status: completed === total ? "completed" : "running",
          }, "multi-coin") as unknown as StreamChunk<AnalysisChunk | ProgressData>);
          chunksWritten++;
        }
      });

      await Promise.all(batchPromises);
    }

    // Clear heartbeat
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
    }

    // Sort opportunities by confidence
    opportunities.sort((a, b) => b.confidence - a.confidence);

    const duration = Date.now() - startTime;

    const finalResult: MultiCoinParallelResult = {
      timestamp: new Date().toISOString(),
      coins: results,
      summary: {
        total: symbols.length,
        analyzed: succeeded,
        failed: errors,
        topOpportunities: opportunities.slice(0, 5),
      },
      duration,
    };

    // Write end chunk with summary
    await writer.write(createEndChunk("multi-coin-analysis", {
      total: symbols.length,
      analyzed: succeeded,
      failed: errors,
      topOpportunities: opportunities.slice(0, 3).map((o) => o.symbol),
      duration,
    }) as unknown as StreamChunk<AnalysisChunk | ProgressData>);
    chunksWritten++;

    await writer.close();

    logger.info(`Streaming multi-coin analysis complete`, {
      total: symbols.length,
      analyzed: succeeded,
      failed: errors,
      duration,
      chunksWritten,
    });

    return {
      chunksWritten,
      errors,
      duration,
      summary: finalResult,
    };
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    logger.error("Streaming multi-coin analysis failed", error);

    await writer.write(createErrorChunk(error, "multi-coin") as unknown as StreamChunk<AnalysisChunk | ProgressData>);

    if (writer.abort) {
      await writer.abort(error);
    } else {
      await writer.close();
    }

    return {
      chunksWritten: chunksWritten + 1,
      errors: errors + 1,
      duration: Date.now() - startTime,
    };
  }
}

/**
 * Create a streaming workflow generator for deep parallel analysis.
 *
 * Returns an async generator that yields progress and result chunks
 * as the analysis proceeds. Can be piped to any StreamWriter.
 *
 * @example
 * ```typescript
 * const workflow = createStreamingDeepAnalysis("BTCUSDT", analyzers, context);
 * await workflow.pipeTo(myWriter);
 * ```
 */
export function createStreamingDeepAnalysis(
  symbol: string,
  analyzers: {
    scan?: (context: GordonContext) => Promise<unknown>;
    technical?: (symbol: string, context: GordonContext) => Promise<unknown>;
    whale?: (symbol: string, context: GordonContext) => Promise<unknown>;
    orderbook?: (symbol: string, context: GordonContext) => Promise<unknown>;
  },
  context: GordonContext,
  options?: StreamingWorkflowOptions
): StreamingWorkflowResult<AnalysisChunk | ProgressData> {
  const normalizedSymbol = symbol.toUpperCase().endsWith("USDT")
    ? symbol.toUpperCase()
    : `${symbol.toUpperCase()}USDT`;

  async function* generator(): AsyncGenerator<AnalysisChunk | ProgressData, void, unknown> {
    const analyzerKeys = Object.keys(analyzers).filter(
      (k) => analyzers[k as keyof typeof analyzers] !== undefined
    );
    const total = analyzerKeys.length;
    let completed = 0;

    // Yield initial progress
    yield {
      step: "Starting deep analysis",
      current: 0,
      total,
      percent: 0,
      status: "running" as const,
    };

    // Execute analyzers sequentially (for generator pattern)
    // For parallel execution, use streamParallelAnalysis instead
    for (const key of analyzerKeys) {
      const analyzerStart = Date.now();

      try {
        let result: unknown;

        if (key === "scan" && analyzers.scan) {
          result = await analyzers.scan(context);
        } else if (key === "technical" && analyzers.technical) {
          result = await analyzers.technical(normalizedSymbol, context);
        } else if (key === "whale" && analyzers.whale) {
          result = await analyzers.whale(normalizedSymbol, context);
        } else if (key === "orderbook" && analyzers.orderbook) {
          result = await analyzers.orderbook(normalizedSymbol, context);
        }

        const duration = Date.now() - analyzerStart;

        // Yield result
        yield {
          symbol: normalizedSymbol,
          success: true,
          analysis: result as AnalysisChunk["analysis"],
          duration,
        };

        completed++;

        // Yield progress
        yield {
          step: `Completed ${key} analysis`,
          current: completed,
          total,
          percent: Math.round((completed / total) * 100),
          status: completed === total ? "completed" as const : "running" as const,
        };
      } catch (err) {
        const duration = Date.now() - analyzerStart;
        const errorMessage = err instanceof Error ? err.message : String(err);

        // Yield error result
        yield {
          symbol: normalizedSymbol,
          success: false,
          error: errorMessage,
          duration,
        };

        completed++;

        // Yield progress even on error
        yield {
          step: `Failed ${key} analysis`,
          current: completed,
          total,
          percent: Math.round((completed / total) * 100),
          status: completed === total ? "completed" as const : "running" as const,
        };
      }
    }
  }

  return createStreamingWorkflow(generator, {
    ...options,
    metadata: {
      source: normalizedSymbol,
      ...options?.metadata,
    },
  });
}

/**
 * Create a streaming workflow generator for multi-coin analysis.
 *
 * Returns an async generator that yields analysis results as each
 * coin completes. Can be piped to any StreamWriter.
 *
 * @example
 * ```typescript
 * const workflow = createStreamingMultiCoinAnalysis(
 *   ["BTCUSDT", "ETHUSDT"],
 *   analyzeFunction,
 *   context
 * );
 * await workflow.pipeTo(myWriter);
 * ```
 */
export function createStreamingMultiCoinAnalysis(
  symbols: string[],
  analyzeFunction: (
    symbol: string,
    context: GordonContext
  ) => Promise<{ bias?: string; setupConfidence?: number; [key: string]: unknown }>,
  context: GordonContext,
  options?: StreamingWorkflowOptions
): StreamingWorkflowResult<AnalysisChunk | ProgressData> {
  const total = symbols.length;

  async function* generator(): AsyncGenerator<AnalysisChunk | ProgressData, void, unknown> {
    let completed = 0;

    // Yield initial progress
    yield {
      step: "Starting multi-coin analysis",
      current: 0,
      total,
      percent: 0,
      status: "running" as const,
    };

    for (const symbol of symbols) {
      const normalizedSymbol = symbol.toUpperCase().endsWith("USDT")
        ? symbol.toUpperCase()
        : `${symbol.toUpperCase()}USDT`;

      const analyzeStart = Date.now();

      try {
        const analysis = await analyzeFunction(normalizedSymbol, context);
        const duration = Date.now() - analyzeStart;

        // Yield result
        yield {
          symbol: normalizedSymbol,
          success: true,
          analysis: {
            bias: analysis.bias,
            setupConfidence: analysis.setupConfidence,
            ...analysis,
          },
          duration,
        };
      } catch (err) {
        const duration = Date.now() - analyzeStart;
        const errorMessage = err instanceof Error ? err.message : String(err);

        // Yield error result
        yield {
          symbol: normalizedSymbol,
          success: false,
          error: errorMessage,
          duration,
        };
      }

      completed++;

      // Yield progress
      yield {
        step: `Analyzed ${completed}/${total} coins`,
        current: completed,
        total,
        percent: Math.round((completed / total) * 100),
        status: completed === total ? "completed" as const : "running" as const,
      };
    }
  }

  return createStreamingWorkflow(generator, {
    ...options,
    metadata: {
      source: "multi-coin",
      ...options?.metadata,
    },
  });
}

// Re-export streaming utilities
export {
  type StreamWriter,
  type StreamChunk,
  type StreamingWorkflowOptions,
  type ProgressData,
  type ResultData,
  type AnalysisChunk,
  type StreamingResult,
  createChunk,
  createProgressChunk,
  createResultChunk,
  createErrorChunk,
  createStartChunk,
  createEndChunk,
  createHeartbeatChunk,
  createStreamingPipeline,
  createConsoleWriter,
  createArrayWriter,
  createCallbackWriter,
  createMultiplexWriter,
  createTransformWriter,
  ConsoleStreamWriter,
  ArrayStreamWriter,
  CallbackStreamWriter,
  MultiplexStreamWriter,
  TransformStreamWriter,
} from "./streamWriter.ts";
