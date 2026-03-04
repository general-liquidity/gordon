/**
 * Parallel Analysis Tools (Mastra Format)
 *
 * Tools that leverage parallel execution for comprehensive market analysis.
 * These tools run multiple operations concurrently for faster results.
 *
 * Features:
 * - Parallel multi-coin analysis
 * - Combined scanner + analyst parallel workflow
 * - Multi-timeframe parallel analysis
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import {
  runParallel,
  runDeepParallelAnalysis,
  runMultiCoinParallelAnalysis,
  runParallelTimeframeAnalysis,
  createScanAnalyzeWorkflow,
  type ParallelOptions,
} from "../parallel.ts";
import { getGordonContext, validateToolOutput, type MastraExecutionContext } from "./types.ts";
import { scan } from "../../../core/scanner.ts";
import { analyze } from "../../../core/analyzer.ts";

// ============================================================================
// Error Messages
// ============================================================================

const errors = {
  noExchange: { error: "Exchange client not connected. Please run setup or add an exchange." },
};

// ============================================================================
// Output Schemas
// ============================================================================

const parallelScanAnalyzeOutputSchema = z.object({
  timestamp: z.string(),
  duration: z.number(),
  scan: z.object({
    success: z.boolean(),
    coinsScanned: z.number().optional(),
    opportunitiesFound: z.number().optional(),
    topOpportunities: z.array(z.object({
      symbol: z.string(),
      price: z.number(),
      confidence: z.number(),
      bias: z.string(),
    })).optional(),
    error: z.string().optional(),
  }),
  analysis: z.object({
    success: z.boolean(),
    symbol: z.string().optional(),
    bias: z.string().optional(),
    confidence: z.number().optional(),
    error: z.string().optional(),
  }),
  combined: z.object({
    recommendedAction: z.string(),
    topPick: z.string().optional(),
    consensusBias: z.string().optional(),
    overallConfidence: z.number().optional(),
  }),
});

const parallelMultiCoinOutputSchema = z.object({
  timestamp: z.string(),
  duration: z.number(),
  summary: z.object({
    total: z.number(),
    analyzed: z.number(),
    failed: z.number(),
  }),
  topOpportunities: z.array(z.object({
    symbol: z.string(),
    confidence: z.number(),
    bias: z.string(),
    price: z.number().optional(),
    change24h: z.number().optional(),
  })),
  allResults: z.array(z.object({
    symbol: z.string(),
    success: z.boolean(),
    bias: z.string().optional(),
    confidence: z.number().optional(),
    error: z.string().optional(),
  })),
});

const parallelDeepAnalysisOutputSchema = z.object({
  symbol: z.string(),
  timestamp: z.string(),
  duration: z.number(),
  results: z.object({
    technical: z.object({
      success: z.boolean(),
      bias: z.string().optional(),
      score: z.number().optional(),
      rsi: z.number().optional(),
      trend: z.string().optional(),
      error: z.string().optional(),
    }).optional(),
    whale: z.object({
      success: z.boolean(),
      bias: z.string().optional(),
      strength: z.number().optional(),
      interpretation: z.string().optional(),
      error: z.string().optional(),
    }).optional(),
    orderbook: z.object({
      success: z.boolean(),
      imbalance: z.string().optional(),
      bidAskRatio: z.number().optional(),
      error: z.string().optional(),
    }).optional(),
  }),
  consensus: z.object({
    bias: z.string(),
    confidence: z.number(),
    agreementScore: z.number(),
    summary: z.string(),
  }).optional(),
});

const parallelTimeframeOutputSchema = z.object({
  symbol: z.string(),
  timestamp: z.string(),
  duration: z.number(),
  timeframes: z.array(z.object({
    timeframe: z.string(),
    success: z.boolean(),
    bias: z.string().optional(),
    trend: z.string().optional(),
    rsi: z.number().optional(),
    error: z.string().optional(),
  })),
  multiTimeframeConsensus: z.object({
    dominantTrend: z.string(),
    dominantBias: z.string(),
    agreementPercent: z.number(),
    recommendation: z.string(),
  }),
});

// ============================================================================
// Parallel Scan + Analyze Tool
// ============================================================================

/**
 * Run market scan and coin analysis in parallel.
 * This is the flagship parallel tool - combines Scanner and Analyst work.
 */
export const parallelScanAnalyzeTool = createTool({
  id: "parallel_scan_analyze",
  description:
    "Run market scanning and coin analysis in parallel for comprehensive market view. " +
    "Executes Scanner (finds opportunities) and Analyst (deep analysis) concurrently. " +
    "Use for commands like '/parallel BTC' or when user wants both scan and analysis.",
  inputSchema: z.object({
    symbol: z.string().default("BTCUSDT").describe("Primary coin to analyze (e.g., 'BTCUSDT')"),
    topN: z.number().min(10).max(100).default(30).describe("Number of coins to scan"),
    timeframes: z.array(z.string()).default(["1h", "4h"]).describe("Ordered timeframe preference. The scan leg uses the first timeframe only; the deep analysis leg uses the full list."),
  }),
  outputSchema: parallelScanAnalyzeOutputSchema,
  execute: async ({ symbol, topN, timeframes }, execContext: MastraExecutionContext) => {
    const startTime = Date.now();
    const ctx = getGordonContext(execContext);

    if (!ctx?.exchange) {
      return validateToolOutput(parallelScanAnalyzeOutputSchema, {
        timestamp: new Date().toISOString(),
        duration: 0,
        scan: { success: false, error: errors.noExchange.error },
        analysis: { success: false, error: errors.noExchange.error },
        combined: { recommendedAction: "Connect an exchange first" },
      }, { toolName: "parallel_scan_analyze" });
    }

    // Normalize symbol
    const normalizedSymbol = symbol.toUpperCase().endsWith("USDT")
      ? symbol.toUpperCase()
      : `${symbol.toUpperCase()}USDT`;

    // Run scan and analyze in parallel
    const [scanResult, analysisResult] = await Promise.all([
      scan(ctx.exchange, { topN, timeframes }).catch((err) => ({
        error: err instanceof Error ? err.message : String(err),
      })),
      analyze(ctx.exchange, normalizedSymbol, { timeframes }).catch((err) => ({
        error: err instanceof Error ? err.message : String(err),
      })),
    ]);

    const duration = Date.now() - startTime;

    // Process scan results
    const scanSuccess = !("error" in scanResult);
    let scanOutput: z.infer<typeof parallelScanAnalyzeOutputSchema>["scan"];

    if (scanSuccess) {
      const scanData = scanResult as Awaited<ReturnType<typeof scan>>;
      const opportunities = scanData.coins.filter((c) => c.setupDetected);
      scanOutput = {
        success: true,
        coinsScanned: scanData.coins.length,
        opportunitiesFound: opportunities.length,
        topOpportunities: opportunities.slice(0, 5).map((c) => ({
          symbol: c.symbol,
          price: c.price,
          confidence: c.setupConfidence,
          bias: c.bias,
        })),
      };
    } else {
      scanOutput = {
        success: false,
        error: (scanResult as { error: string }).error,
      };
    }

    // Process analysis results
    const analysisSuccess = !("error" in analysisResult);
    let analysisOutput: z.infer<typeof parallelScanAnalyzeOutputSchema>["analysis"];

    if (analysisSuccess) {
      const analysisData = analysisResult as Awaited<ReturnType<typeof analyze>>;
      analysisOutput = {
        success: true,
        symbol: analysisData.symbol,
        bias: analysisData.bias,
        confidence: analysisData.setupConfidence,
      };
    } else {
      analysisOutput = {
        success: false,
        error: (analysisResult as { error: string }).error,
      };
    }

    // Generate combined recommendation
    let recommendedAction = "Review results and make a decision";
    let topPick: string | undefined;
    let consensusBias: string | undefined;
    let overallConfidence: number | undefined;

    if (scanSuccess && analysisSuccess) {
      const opportunities = (scanResult as Awaited<ReturnType<typeof scan>>).coins.filter((c) => c.setupDetected);
      const analysis = analysisResult as Awaited<ReturnType<typeof analyze>>;

      if (opportunities.length > 0) {
        topPick = opportunities[0]?.symbol;
      }

      // Check if analyzed coin is in top opportunities
      const isAnalyzedCoinTop = opportunities.some((o) => o.symbol === normalizedSymbol);

      if (analysis.setupDetected && analysis.setupConfidence >= 0.6) {
        if (isAnalyzedCoinTop) {
          recommendedAction = `${normalizedSymbol} shows strong setup and is among top opportunities. Consider creating a plan.`;
          consensusBias = analysis.bias;
          overallConfidence = analysis.setupConfidence;
        } else {
          recommendedAction = `${normalizedSymbol} has a setup but check top opportunities: ${topPick || "none found"}`;
          consensusBias = analysis.bias;
          overallConfidence = analysis.setupConfidence * 0.8; // Slightly reduce confidence
        }
      } else if (opportunities.length > 0) {
        recommendedAction = `No strong setup for ${normalizedSymbol}. Consider top opportunity: ${topPick}`;
        consensusBias = opportunities[0]?.bias;
        overallConfidence = opportunities[0]?.setupConfidence;
      } else {
        recommendedAction = "No strong setups found. Wait for better opportunities.";
        consensusBias = "neutral";
        overallConfidence = 0;
      }
    }

    const output = {
      timestamp: new Date().toISOString(),
      duration,
      scan: scanOutput,
      analysis: analysisOutput,
      combined: {
        recommendedAction,
        topPick,
        consensusBias,
        overallConfidence,
      },
    };

    return validateToolOutput(parallelScanAnalyzeOutputSchema, output, {
      toolName: "parallel_scan_analyze",
    });
  },
});

// ============================================================================
// Parallel Multi-Coin Analysis Tool
// ============================================================================

/**
 * Analyze multiple coins in parallel for quick comparison.
 */
export const parallelMultiCoinTool = createTool({
  id: "parallel_multi_coin",
  description:
    "Analyze multiple coins in parallel to find the best opportunities. " +
    "Faster than sequential analysis. Use when comparing several coins at once. " +
    "Example: 'compare BTC ETH SOL AVAX' or 'analyze top 5 coins'.",
  inputSchema: z.object({
    symbols: z.array(z.string()).min(2).max(10).describe("List of symbols to analyze (e.g., ['BTC', 'ETH', 'SOL'])"),
    timeframes: z.array(z.string()).default(["4h"]).describe("Timeframes for analysis"),
    concurrency: z.number().min(1).max(5).default(3).describe("Max concurrent analyses"),
  }),
  outputSchema: parallelMultiCoinOutputSchema,
  execute: async ({ symbols, timeframes, concurrency }, execContext: MastraExecutionContext) => {
    const startTime = Date.now();
    const ctx = getGordonContext(execContext);

    if (!ctx?.exchange) {
      return validateToolOutput(parallelMultiCoinOutputSchema, {
        timestamp: new Date().toISOString(),
        duration: 0,
        summary: { total: symbols.length, analyzed: 0, failed: symbols.length },
        topOpportunities: [],
        allResults: symbols.map((s) => ({
          symbol: s.toUpperCase(),
          success: false,
          error: errors.noExchange.error,
        })),
      }, { toolName: "parallel_multi_coin" });
    }

    // Normalize symbols
    const normalizedSymbols = symbols.map((s) =>
      s.toUpperCase().endsWith("USDT") ? s.toUpperCase() : `${s.toUpperCase()}USDT`
    );

    // Create parallel operations
    const operations = normalizedSymbols.map((symbol) => async () => {
      try {
        const result = await analyze(ctx.exchange!, symbol, { timeframes });
        return {
          symbol,
          success: true,
          bias: result.bias,
          confidence: result.setupConfidence,
          price: result.price,
          change24h: result.change24h,
          setupDetected: result.setupDetected,
        };
      } catch (err) {
        return {
          symbol,
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    });

    // Run in parallel with concurrency control
    const parallelResult = await runParallel(operations, {
      concurrency,
      timeout: 30000,
      label: `multi-coin-${symbols.length}`,
    });

    const duration = Date.now() - startTime;

    // Extract successful results
    const successfulResults = parallelResult.results.filter((r) => r.success);

    // Find top opportunities (setup detected, sorted by confidence)
    const topOpportunities = successfulResults
      .filter((r) => r.setupDetected)
      .sort((a, b) => (b.confidence || 0) - (a.confidence || 0))
      .slice(0, 5)
      .map((r) => ({
        symbol: r.symbol,
        confidence: r.confidence || 0,
        bias: r.bias || "neutral",
        price: r.price,
        change24h: r.change24h,
      }));

    const output = {
      timestamp: new Date().toISOString(),
      duration,
      summary: {
        total: symbols.length,
        analyzed: parallelResult.stats.succeeded,
        failed: parallelResult.stats.failed,
      },
      topOpportunities,
      allResults: parallelResult.results.map((r) => ({
        symbol: r.symbol,
        success: r.success,
        bias: r.bias,
        confidence: r.confidence,
        error: r.error,
      })),
    };

    return validateToolOutput(parallelMultiCoinOutputSchema, output, {
      toolName: "parallel_multi_coin",
    });
  },
});

// ============================================================================
// Parallel Deep Analysis Tool
// ============================================================================

/**
 * Run comprehensive deep analysis with all analyzers in parallel.
 * Uses the existing runFullAnalysis from composition.ts which already implements
 * parallel execution.
 */
export const parallelDeepAnalysisTool = createTool({
  id: "parallel_deep_analysis",
  description:
    "Run all analysis types (technical, whale, orderbook) in parallel for a single coin. " +
    "Fastest way to get comprehensive view. Use for '/deep BTC' with parallel speedup. " +
    "Combines multiple data sources concurrently.",
  inputSchema: z.object({
    symbol: z.string().describe("Symbol to analyze (e.g., 'BTCUSDT', 'BTC')"),
  }),
  outputSchema: parallelDeepAnalysisOutputSchema,
  execute: async ({ symbol }, execContext: MastraExecutionContext) => {
    const startTime = Date.now();
    const ctx = getGordonContext(execContext);

    if (!ctx?.exchange) {
      return validateToolOutput(parallelDeepAnalysisOutputSchema, {
        symbol: symbol.toUpperCase(),
        timestamp: new Date().toISOString(),
        duration: 0,
        results: {
          technical: { success: false, error: errors.noExchange.error },
        },
      }, { toolName: "parallel_deep_analysis" });
    }

    // Normalize symbol
    const normalizedSymbol = symbol.toUpperCase().endsWith("USDT")
      ? symbol.toUpperCase()
      : `${symbol.toUpperCase()}USDT`;

    // Import and use the existing runFullAnalysis which already runs in parallel
    const { runFullAnalysis } = await import("./composition.ts");
    const fullAnalysisResult = await runFullAnalysis(normalizedSymbol, execContext);

    const duration = Date.now() - startTime;

    // Map the full analysis result to our schema
    const technicalOutput = {
      success: fullAnalysisResult.signals !== null,
      bias: fullAnalysisResult.signals?.bias,
      score: fullAnalysisResult.signals?.score,
      rsi: fullAnalysisResult.rsi?.rsi ? parseFloat(fullAnalysisResult.rsi.rsi) : undefined,
      trend: fullAnalysisResult.signals?.trend,
      error: fullAnalysisResult.signals === null ? "Technical analysis failed" : undefined,
    };

    const whaleOutput = {
      success: fullAnalysisResult.whales !== null,
      bias: fullAnalysisResult.whales?.bias,
      strength: fullAnalysisResult.whales?.strength,
      interpretation: fullAnalysisResult.whales?.interpretation,
      error: fullAnalysisResult.whales === null ? "Whale analysis failed" : undefined,
    };

    const orderbookOutput = {
      success: fullAnalysisResult.orderbook !== null,
      imbalance: fullAnalysisResult.orderbook?.liquidity?.imbalance,
      bidAskRatio: fullAnalysisResult.orderbook?.liquidity
        ? parseFloat(fullAnalysisResult.orderbook.liquidity.ratio)
        : undefined,
      error: fullAnalysisResult.orderbook === null ? "Orderbook analysis failed" : undefined,
    };

    // Build consensus from the full analysis
    const consensus = fullAnalysisResult.combinedScore !== undefined
      ? {
          bias: fullAnalysisResult.consensus,
          confidence: fullAnalysisResult.confidence,
          agreementScore: fullAnalysisResult.confidence, // Use confidence as agreement proxy
          summary: fullAnalysisResult.summary,
        }
      : undefined;

    const output = {
      symbol: normalizedSymbol,
      timestamp: new Date().toISOString(),
      duration,
      results: {
        technical: technicalOutput,
        whale: whaleOutput,
        orderbook: orderbookOutput,
      },
      consensus,
    };

    return validateToolOutput(parallelDeepAnalysisOutputSchema, output, {
      toolName: "parallel_deep_analysis",
    });
  },
});

// ============================================================================
// Parallel Multi-Timeframe Analysis Tool
// ============================================================================

/**
 * Analyze a single coin across multiple timeframes in parallel.
 */
export const parallelTimeframeTool = createTool({
  id: "parallel_timeframe",
  description:
    "Analyze a coin across multiple timeframes in parallel for multi-timeframe confluence. " +
    "Helps identify trends that align across different time horizons. " +
    "Use for 'analyze BTC across all timeframes' or multi-timeframe confirmation.",
  inputSchema: z.object({
    symbol: z.string().describe("Symbol to analyze (e.g., 'BTCUSDT', 'BTC')"),
    timeframes: z.array(z.string()).default(["15m", "1h", "4h", "1d"]).describe("Timeframes to analyze"),
  }),
  outputSchema: parallelTimeframeOutputSchema,
  execute: async ({ symbol, timeframes }, execContext: MastraExecutionContext) => {
    const startTime = Date.now();
    const ctx = getGordonContext(execContext);

    if (!ctx?.exchange) {
      return validateToolOutput(parallelTimeframeOutputSchema, {
        symbol: symbol.toUpperCase(),
        timestamp: new Date().toISOString(),
        duration: 0,
        timeframes: timeframes.map((tf) => ({
          timeframe: tf,
          success: false,
          error: errors.noExchange.error,
        })),
        multiTimeframeConsensus: {
          dominantTrend: "unknown",
          dominantBias: "neutral",
          agreementPercent: 0,
          recommendation: "Connect an exchange first",
        },
      }, { toolName: "parallel_timeframe" });
    }

    // Normalize symbol
    const normalizedSymbol = symbol.toUpperCase().endsWith("USDT")
      ? symbol.toUpperCase()
      : `${symbol.toUpperCase()}USDT`;

    // Create parallel operations for each timeframe
    const operations = timeframes.map((timeframe) => async () => {
      try {
        const result = await analyze(ctx.exchange!, normalizedSymbol, { timeframes: [timeframe] });
        return {
          timeframe,
          success: true,
          bias: result.bias,
          trend: result.trend,
          rsi: result.indicators.rsi,
        };
      } catch (err) {
        return {
          timeframe,
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    });

    // Run all timeframes in parallel
    const parallelResult = await runParallel(operations, {
      concurrency: 4,
      timeout: 30000,
      label: `timeframe-${normalizedSymbol}`,
    });

    const duration = Date.now() - startTime;

    // Calculate multi-timeframe consensus
    const successfulResults = parallelResult.results.filter((r) => r.success);

    // Count trends and biases
    const trendCounts: Record<string, number> = {};
    const biasCounts: Record<string, number> = {};

    for (const result of successfulResults) {
      if (result.trend) {
        trendCounts[result.trend] = (trendCounts[result.trend] || 0) + 1;
      }
      if (result.bias) {
        biasCounts[result.bias] = (biasCounts[result.bias] || 0) + 1;
      }
    }

    // Find dominant trend and bias
    let dominantTrend = "range";
    let maxTrendCount = 0;
    for (const [trend, count] of Object.entries(trendCounts)) {
      if (count > maxTrendCount) {
        maxTrendCount = count;
        dominantTrend = trend;
      }
    }

    let dominantBias = "neutral";
    let maxBiasCount = 0;
    for (const [bias, count] of Object.entries(biasCounts)) {
      if (count > maxBiasCount) {
        maxBiasCount = count;
        dominantBias = bias;
      }
    }

    // Calculate agreement percentage
    const agreementPercent = successfulResults.length > 0
      ? (Math.max(maxTrendCount, maxBiasCount) / successfulResults.length) * 100
      : 0;

    // Generate recommendation
    let recommendation: string;
    if (agreementPercent >= 75) {
      recommendation = `Strong multi-timeframe confluence: ${dominantTrend} trend with ${dominantBias} bias`;
    } else if (agreementPercent >= 50) {
      recommendation = `Moderate alignment across timeframes. Primary: ${dominantTrend}/${dominantBias}`;
    } else {
      recommendation = "Mixed signals across timeframes. Wait for better alignment.";
    }

    const output = {
      symbol: normalizedSymbol,
      timestamp: new Date().toISOString(),
      duration,
      timeframes: parallelResult.results,
      multiTimeframeConsensus: {
        dominantTrend,
        dominantBias,
        agreementPercent,
        recommendation,
      },
    };

    return validateToolOutput(parallelTimeframeOutputSchema, output, {
      toolName: "parallel_timeframe",
    });
  },
});

// ============================================================================
// Export Tools
// ============================================================================

/**
 * Parallel analysis tools exported as an object for Mastra Agent
 */
export const parallelAnalysisTools = {
  parallel_scan_analyze: parallelScanAnalyzeTool,
  parallel_multi_coin: parallelMultiCoinTool,
  parallel_deep_analysis: parallelDeepAnalysisTool,
  parallel_timeframe: parallelTimeframeTool,
};
