/**
 * Strategy Generator Agent
 *
 * AI-powered trading strategy generation from natural language descriptions.
 * Uses LLM to generate Strategy DSL JSON that can be validated, backtested,
 * and iteratively improved based on performance feedback.
 */

import { z } from "zod";
import type { LLMClient, Message, ModelConfig } from "../llm/index.ts";
import {
  type StrategyDSL,
  StrategyDSLSchema,
  validateStrategyDSL,
  EXAMPLE_RSI_BOUNCE_DSL,
  EXAMPLE_MACD_CROSSOVER_DSL,
} from "../../strategies/dsl/schema.ts";
import type { BacktestResult, BacktestMetrics } from "../../backtest/types.ts";
import { runBacktest } from "../../backtest/engine.ts";
import { fetchHistoricalData } from "../../backtest/data/historical.ts";
import type { BinanceClient } from "../binance/index.ts";
import { createModuleLogger } from "../logger/index.ts";
import { DSLStrategyAdapter } from "../../strategies/dsl/adapter.ts";

const logger = createModuleLogger("strategy-generator");

// ============================================================================
// Types
// ============================================================================

/**
 * Options for strategy generation
 */
export interface GenerationOptions {
  /** Risk level preference */
  riskLevel: "low" | "medium" | "high";
  /** Preferred timeframes */
  timeframes: string[];
  /** Days of historical data for backtesting */
  backtestDays: number;
  /** Trading symbol for backtesting */
  symbol: string;
  /** Minimum Sharpe ratio threshold (default: 0.5) */
  minSharpe?: number;
  /** Maximum iterations for improvement (default: 3) */
  maxIterations?: number;
  /** Minimum win rate threshold */
  minWinRate?: number;
  /** Maximum drawdown threshold */
  maxDrawdown?: number;
}

/**
 * Result of strategy generation
 */
export interface GeneratedStrategy {
  /** The generated strategy DSL */
  strategy: StrategyDSL;
  /** Backtest results */
  backtestResult: BacktestResult;
  /** Number of iterations used */
  iterations: number;
  /** Improvements made during iteration */
  improvements: string[];
  /** Whether the strategy met the performance thresholds */
  meetsThresholds: boolean;
  /** Generation timestamp */
  generatedAt: string;
}

/**
 * Parsed intent from user prompt
 */
interface ParsedIntent {
  /** Strategy type/style */
  style: string;
  /** Main indicators to use */
  indicators: string[];
  /** Entry conditions described */
  entryLogic: string;
  /** Exit conditions described */
  exitLogic: string;
  /** Risk profile */
  riskProfile: "conservative" | "moderate" | "aggressive";
  /** Market conditions suited for */
  marketConditions: string[];
}

// ============================================================================
// Strategy Generator Agent
// ============================================================================

/**
 * AI-powered strategy generator that creates trading strategies
 * from natural language descriptions.
 */
export class StrategyGeneratorAgent {
  private llm: LLMClient;
  private binance?: BinanceClient;

  constructor(llm: LLMClient, binance?: BinanceClient) {
    this.llm = llm;
    this.binance = binance;
  }

  /**
   * Set the Binance client for backtesting
   */
  setBinanceClient(binance: BinanceClient): void {
    this.binance = binance;
  }

  /**
   * Generate a strategy from a natural language prompt.
   *
   * The process:
   * 1. Parse user intent from the prompt
   * 2. Generate initial strategy DSL using LLM
   * 3. Validate against StrategyDSLSchema
   * 4. Run backtest
   * 5. If metrics below threshold, iterate with feedback
   * 6. Return final strategy with results
   */
  async generateFromPrompt(
    prompt: string,
    options: GenerationOptions
  ): Promise<GeneratedStrategy> {
    const {
      minSharpe = 0.5,
      maxIterations = 3,
      minWinRate = 40,
      maxDrawdown = 30,
    } = options;

    logger.info("Starting strategy generation", { prompt: prompt.slice(0, 100) });

    // Step 1: Parse user intent
    const intent = await this.parseIntent(prompt, options);
    logger.info("Parsed intent", { style: intent.style, indicators: intent.indicators });

    // Step 2: Generate initial strategy
    let strategy = await this.generateDSL(intent, options);
    let iterations = 1;
    const improvements: string[] = [];

    // Step 3: Validate and backtest loop
    let backtestResult: BacktestResult | null = null;

    while (iterations <= maxIterations) {
      // Validate the strategy
      const validation = validateStrategyDSL(strategy);
      if (!validation.success) {
        logger.warn("Strategy validation failed, regenerating", {
          errors: validation.errors,
        });
        strategy = await this.fixValidationErrors(strategy, validation.errors ?? []);
        continue;
      }

      // Run backtest if we have Binance client
      if (this.binance) {
        try {
          backtestResult = await this.runStrategyBacktest(strategy, options);

          const metrics = backtestResult.metrics;
          const meetsThresholds =
            metrics.sharpeRatio >= minSharpe &&
            metrics.winRate >= minWinRate &&
            metrics.maxDrawdown <= maxDrawdown;

          if (meetsThresholds || iterations >= maxIterations) {
            logger.info("Strategy generation complete", {
              iterations,
              sharpe: metrics.sharpeRatio,
              winRate: metrics.winRate,
              drawdown: metrics.maxDrawdown,
            });
            break;
          }

          // Iterate to improve
          const feedback = this.generateFeedback(metrics, {
            minSharpe,
            minWinRate,
            maxDrawdown,
          });
          improvements.push(feedback);

          logger.info("Iterating to improve strategy", { iteration: iterations, feedback });

          const improved = await this.iterateStrategy(
            strategy,
            backtestResult,
            feedback,
            options
          );
          strategy = improved.strategy;
          iterations++;
        } catch (error) {
          logger.error("Backtest failed", {
            error: error instanceof Error ? error.message : "Unknown error",
          });
          break;
        }
      } else {
        // No Binance client, skip backtesting
        logger.warn("No Binance client available, skipping backtest");
        break;
      }
    }

    // Create mock backtest result if none available
    if (!backtestResult) {
      backtestResult = this.createMockBacktestResult(strategy, options);
    }

    return {
      strategy,
      backtestResult,
      iterations,
      improvements,
      meetsThresholds: backtestResult
        ? backtestResult.metrics.sharpeRatio >= minSharpe &&
          backtestResult.metrics.winRate >= minWinRate &&
          backtestResult.metrics.maxDrawdown <= maxDrawdown
        : false,
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Iterate on an existing strategy based on feedback.
   */
  async iterateStrategy(
    strategy: StrategyDSL,
    backtestResult: BacktestResult,
    feedback: string,
    options: GenerationOptions
  ): Promise<GeneratedStrategy> {
    const messages: Message[] = [
      {
        role: "system",
        content: this.getIterationSystemPrompt(),
      },
      {
        role: "user",
        content: `
Current Strategy:
${JSON.stringify(strategy, null, 2)}

Backtest Results:
- Total Return: ${backtestResult.metrics.totalReturn.toFixed(2)}%
- Sharpe Ratio: ${backtestResult.metrics.sharpeRatio.toFixed(2)}
- Win Rate: ${backtestResult.metrics.winRate.toFixed(2)}%
- Max Drawdown: ${backtestResult.metrics.maxDrawdown.toFixed(2)}%
- Total Trades: ${backtestResult.metrics.totalTrades}

Feedback for Improvement:
${feedback}

Risk Level Target: ${options.riskLevel}
Timeframes: ${options.timeframes.join(", ")}

Please improve the strategy based on this feedback. Return ONLY valid JSON matching the StrategyDSL schema.
`,
      },
    ];

    try {
      const response = await this.llm.chatWithJSON<StrategyDSL>(
        messages,
        StrategyDSLSchema,
        this.getModelConfig()
      );

      // Update metadata
      response.metadata = {
        ...response.metadata,
        generatedAt: new Date().toISOString(),
        generatedFrom: `Iteration based on feedback: ${feedback}`,
      };

      return {
        strategy: response,
        backtestResult,
        iterations: 1,
        improvements: [feedback],
        meetsThresholds: false,
        generatedAt: new Date().toISOString(),
      };
    } catch (error) {
      logger.error("Strategy iteration failed", {
        error: error instanceof Error ? error.message : "Unknown",
      });
      throw error;
    }
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Parse user intent from natural language prompt
   */
  private async parseIntent(
    prompt: string,
    options: GenerationOptions
  ): Promise<ParsedIntent> {
    const intentSchema = z.object({
      style: z.string(),
      indicators: z.array(z.string()),
      entryLogic: z.string(),
      exitLogic: z.string(),
      riskProfile: z.enum(["conservative", "moderate", "aggressive"]),
      marketConditions: z.array(z.string()),
    });

    const messages: Message[] = [
      {
        role: "system",
        content: `You are a trading strategy analyst. Parse the user's strategy description into structured components.

Respond with JSON containing:
- style: Strategy type (e.g., "trend-following", "mean-reversion", "momentum", "breakout")
- indicators: Array of indicator names to use (e.g., ["rsi", "macd", "sma", "bollinger"])
- entryLogic: Description of when to enter positions
- exitLogic: Description of when to exit positions
- riskProfile: "conservative", "moderate", or "aggressive"
- marketConditions: What market conditions this strategy suits

User's risk preference: ${options.riskLevel}
Timeframes: ${options.timeframes.join(", ")}`,
      },
      {
        role: "user",
        content: prompt,
      },
    ];

    try {
      return await this.llm.chatWithJSON(messages, intentSchema, {
        provider: "dedalus",
        model: "openai/gpt-5-mini",
        temperature: 0.3,
        maxTokens: 1000,
      });
    } catch (error) {
      logger.warn("Intent parsing failed, using defaults", {
        error: error instanceof Error ? error.message : "Unknown",
      });
      // Return reasonable defaults
      return {
        style: "trend-following",
        indicators: ["rsi", "macd", "sma"],
        entryLogic: prompt,
        exitLogic: "ATR-based stop loss with multiple take profits",
        riskProfile:
          options.riskLevel === "low"
            ? "conservative"
            : options.riskLevel === "high"
            ? "aggressive"
            : "moderate",
        marketConditions: ["trending markets"],
      };
    }
  }

  /**
   * Generate Strategy DSL from parsed intent
   */
  private async generateDSL(
    intent: ParsedIntent,
    options: GenerationOptions
  ): Promise<StrategyDSL> {
    const messages: Message[] = [
      {
        role: "system",
        content: this.getSystemPrompt(),
      },
      {
        role: "user",
        content: `
Generate a trading strategy with the following requirements:

Strategy Style: ${intent.style}
Indicators to Use: ${intent.indicators.join(", ")}
Entry Logic: ${intent.entryLogic}
Exit Logic: ${intent.exitLogic}
Risk Profile: ${intent.riskProfile}
Market Conditions: ${intent.marketConditions.join(", ")}

Risk Level: ${options.riskLevel}
Timeframes: ${options.timeframes.join(", ")}

Create a complete strategy DSL that:
1. Uses the specified indicators appropriately
2. Has clear entry conditions based on the entry logic
3. Has proper risk management with stop loss and take profits
4. Matches the risk profile and risk level specified

Return ONLY valid JSON matching the StrategyDSL schema.
`,
      },
    ];

    try {
      const strategy = await this.llm.chatWithJSON<StrategyDSL>(
        messages,
        StrategyDSLSchema,
        this.getModelConfig()
      );

      // Ensure metadata is set
      strategy.metadata = {
        ...strategy.metadata,
        generatedAt: new Date().toISOString(),
        generatedFrom: `AI generated from: ${intent.style} strategy with ${intent.indicators.join(", ")}`,
        tags: [intent.style, options.riskLevel, ...intent.marketConditions],
      };

      return strategy;
    } catch (error) {
      logger.error("DSL generation failed", {
        error: error instanceof Error ? error.message : "Unknown",
      });
      // Return a template strategy as fallback
      return this.createFallbackStrategy(intent, options);
    }
  }

  /**
   * Fix validation errors in a strategy
   */
  private async fixValidationErrors(
    strategy: StrategyDSL,
    errors: string[]
  ): Promise<StrategyDSL> {
    const messages: Message[] = [
      {
        role: "system",
        content: `You are a trading strategy validator. Fix the following strategy DSL to match the required schema.

Schema requirements:
- id: lowercase letters, numbers, underscores only, starts with letter
- name: max 100 characters
- description: max 500 characters
- tier: "1" or "2"
- riskLevel: "low", "medium", or "high"
- timeframes: non-empty array of strings
- entryRules.long: non-empty array of signal rules
- exitRules.stopLoss: required with type and value
- exitRules.takeProfit: non-empty array with target and percent
- requiredIndicators: non-empty array

Return ONLY the fixed JSON.`,
      },
      {
        role: "user",
        content: `
Strategy with errors:
${JSON.stringify(strategy, null, 2)}

Validation errors:
${errors.join("\n")}

Fix these errors and return valid JSON.
`,
      },
    ];

    try {
      return await this.llm.chatWithJSON<StrategyDSL>(
        messages,
        StrategyDSLSchema,
        this.getModelConfig()
      );
    } catch {
      // Return the original with minimal fixes
      return {
        ...strategy,
        id: strategy.id || `strategy_${Date.now()}`,
        tier: strategy.tier || "1",
        version: strategy.version || "1.0.0",
      };
    }
  }

  /**
   * Run backtest for a strategy
   */
  private async runStrategyBacktest(
    strategy: StrategyDSL,
    options: GenerationOptions
  ): Promise<BacktestResult> {
    if (!this.binance) {
      throw new Error("Binance client not available for backtesting");
    }

    // Fetch historical data
    const timeframe = options.timeframes[0] || "4h";
    const ohlcData = await fetchHistoricalData(
      this.binance,
      options.symbol,
      timeframe,
      options.backtestDays
    );

    if (ohlcData.length < 100) {
      throw new Error(`Insufficient data: got ${ohlcData.length} candles, need at least 100`);
    }

    // Create strategy adapter
    const adapter = new DSLStrategyAdapter(strategy);

    // Run backtest
    const engineResult = runBacktest(adapter, ohlcData, {
      initialCapital: 10000,
      commissionRate: 0.001,
    });

    // Convert to BacktestResult format
    return {
      id: `bt_${Date.now()}`,
      strategyName: strategy.name,
      config: {
        strategyId: strategy.id,
        symbol: options.symbol,
        timeframe,
        days: options.backtestDays,
        initialCapital: 10000,
        positionSizePercent: 10,
        compounding: false,
        feePercent: 0.1,
        slippagePercent: 0.05,
      },
      metrics: engineResult.metrics,
      trades: engineResult.trades.map((t) => ({
        id: t.id,
        entryTime: new Date(t.entryTime).toISOString(),
        exitTime: new Date(t.exitTime).toISOString(),
        entryPrice: t.entryPrice,
        exitPrice: t.exitPrice,
        quantity: t.quantity,
        positionValue: t.entryPrice * t.quantity,
        side: t.side,
        pnl: t.netPnL,
        pnlPercent: t.returnPct,
        fees: t.commission,
        exitReason: t.exitReason.includes("STOP") ? "STOP" : "SIGNAL",
      })),
      equityCurve: engineResult.equityCurve.map((p) => ({
        timestamp: p.timestamp,
        equity: p.equity,
      })),
      drawdownCurve: engineResult.equityCurve.map((p) => ({
        timestamp: p.timestamp,
        drawdown: p.drawdownPct,
      })),
      startDate: new Date(engineResult.startDate).toISOString(),
      endDate: new Date(engineResult.endDate).toISOString(),
      executionTime: 0,
      createdAt: new Date().toISOString(),
      warnings: [],
    };
  }

  /**
   * Generate feedback message based on metrics
   */
  private generateFeedback(
    metrics: BacktestMetrics,
    thresholds: { minSharpe: number; minWinRate: number; maxDrawdown: number }
  ): string {
    const issues: string[] = [];

    if (metrics.sharpeRatio < thresholds.minSharpe) {
      issues.push(
        `Sharpe ratio (${metrics.sharpeRatio.toFixed(2)}) is below target (${thresholds.minSharpe}). ` +
          "Consider tightening entry conditions or improving risk-reward ratio."
      );
    }

    if (metrics.winRate < thresholds.minWinRate) {
      issues.push(
        `Win rate (${metrics.winRate.toFixed(1)}%) is below target (${thresholds.minWinRate}%). ` +
          "Consider adding confirmation signals or adjusting entry timing."
      );
    }

    if (metrics.maxDrawdown > thresholds.maxDrawdown) {
      issues.push(
        `Max drawdown (${metrics.maxDrawdown.toFixed(1)}%) exceeds limit (${thresholds.maxDrawdown}%). ` +
          "Consider tighter stop losses or reducing position sizes."
      );
    }

    if (metrics.totalTrades < 10) {
      issues.push(
        `Only ${metrics.totalTrades} trades in backtest period. ` +
          "Consider relaxing entry conditions to generate more signals."
      );
    }

    if (metrics.profitFactor < 1.5) {
      issues.push(
        `Profit factor (${metrics.profitFactor.toFixed(2)}) is low. ` +
          "Consider improving take profit levels or tightening stop loss."
      );
    }

    return issues.join("\n\n");
  }

  /**
   * Create a fallback strategy template
   */
  private createFallbackStrategy(
    intent: ParsedIntent,
    options: GenerationOptions
  ): StrategyDSL {
    // Start with an appropriate template based on style
    const template =
      intent.style.includes("momentum") || intent.style.includes("crossover")
        ? EXAMPLE_MACD_CROSSOVER_DSL
        : EXAMPLE_RSI_BOUNCE_DSL;

    return {
      ...template,
      id: `generated_${Date.now()}`,
      name: `Generated ${intent.style} Strategy`,
      description: intent.entryLogic.slice(0, 500),
      riskLevel: options.riskLevel,
      timeframes: options.timeframes,
      metadata: {
        generatedAt: new Date().toISOString(),
        generatedFrom: `Fallback from: ${intent.style}`,
        tags: [intent.style, options.riskLevel],
      },
    };
  }

  /**
   * Create a mock backtest result when backtesting is unavailable
   */
  private createMockBacktestResult(
    strategy: StrategyDSL,
    options: GenerationOptions
  ): BacktestResult {
    return {
      id: `mock_bt_${Date.now()}`,
      strategyName: strategy.name,
      config: {
        strategyId: strategy.id,
        symbol: options.symbol,
        timeframe: options.timeframes[0] || "4h",
        days: options.backtestDays,
        initialCapital: 10000,
        positionSizePercent: 10,
        compounding: false,
        feePercent: 0.1,
        slippagePercent: 0.05,
      },
      metrics: {
        totalReturn: 0,
        annualizedReturn: 0,
        cagr: 0,
        maxDrawdown: 0,
        sharpeRatio: 0,
        sortinoRatio: 0,
        volatility: 0,
        calmarRatio: 0,
        totalTrades: 0,
        winningTrades: 0,
        losingTrades: 0,
        winRate: 0,
        profitFactor: 0,
        averageTrade: 0,
        averageWin: 0,
        averageLoss: 0,
        expectancy: 0,
        maxConsecutiveWins: 0,
        maxConsecutiveLosses: 0,
        initialValue: 10000,
        finalValue: 10000,
        totalPnl: 0,
        netProfit: 0,
        totalFees: 0,
        avgTradeDuration: 0,
        maxDrawdownDuration: 0,
      },
      trades: [],
      equityCurve: [],
      drawdownCurve: [],
      startDate: new Date().toISOString(),
      endDate: new Date().toISOString(),
      executionTime: 0,
      createdAt: new Date().toISOString(),
      warnings: ["Backtest not performed - Binance client unavailable"],
    };
  }

  /**
   * Get model configuration for strategy generation
   */
  private getModelConfig(): ModelConfig {
    return {
      provider: "dedalus",
      model: "openai/gpt-5.2",
      temperature: 0.4,
      maxTokens: 4000,
    };
  }

  /**
   * Get system prompt for strategy generation
   */
  private getSystemPrompt(): string {
    return `You are an expert algorithmic trading strategy designer. Your task is to create trading strategies in a specific JSON format called Strategy DSL.

## Strategy DSL Schema

The strategy must have this structure:
{
  "id": "lowercase_with_underscores",
  "name": "Human Readable Name",
  "description": "Strategy description (max 500 chars)",
  "version": "1.0.0",
  "tier": "1" or "2",
  "riskLevel": "low" | "medium" | "high",
  "timeframes": ["4h", "1d"],
  "entryRules": {
    "long": [{ "name": "Rule Name", "conditions": [...], "operator": "AND", "weight": 1 }],
    "short": [...] // optional
  },
  "exitRules": {
    "stopLoss": { "type": "atr" | "percent" | "support" | "fixed", "value": number, "multiplier": number },
    "takeProfit": [{ "target": number, "percent": 0.5 }],
    "trailingStop": { "enabled": boolean, "activation": number, "distance": number }
  },
  "filters": { "minVolume": number, "trendFilter": "up" | "down" | "any" },
  "requiredIndicators": ["rsi14", "macdLine", "sma50"]
}

## Condition Types

Indicator conditions:
{ "type": "indicator", "indicator": "rsi" | "macd" | "sma" | "ema" | "bollinger" | "atr" | "vwap" | "stochastic" | "adx" | "volume", "params": { "period": 14 }, "comparison": "gt" | "lt" | "gte" | "lte" | "eq" | "cross_above" | "cross_below", "value": 30 or "signal" }

Price conditions:
{ "type": "price", "condition": "near_support" | "near_resistance" | "breakout_above" | "breakout_below" | "in_range", "threshold": 3 }

Pattern conditions:
{ "type": "pattern", "pattern": "engulfing" | "doji" | "hammer" | "shooting_star", "direction": "bullish" | "bearish" | "any" }

## Examples

RSI Oversold Strategy:
${JSON.stringify(EXAMPLE_RSI_BOUNCE_DSL, null, 2)}

MACD Crossover Strategy:
${JSON.stringify(EXAMPLE_MACD_CROSSOVER_DSL, null, 2)}

## Guidelines

1. Use multiple confirming conditions for higher quality signals
2. Always include proper risk management with stop loss and take profits
3. Match entry conditions to the stated risk level
4. Include relevant indicator names in requiredIndicators
5. Use appropriate weights for signal rules (0-1)
6. Consider market conditions in filters

Return ONLY valid JSON. No explanation, no markdown formatting, just the JSON object.`;
  }

  /**
   * Get system prompt for iteration
   */
  private getIterationSystemPrompt(): string {
    return `You are an expert trading strategy optimizer. Your task is to improve an existing strategy based on backtest feedback.

When improving strategies:
1. If Sharpe ratio is low: Tighten entry conditions, improve risk-reward ratio
2. If win rate is low: Add confirmation signals, adjust entry timing
3. If drawdown is high: Tighten stop losses, consider trailing stops
4. If few trades: Relax entry conditions slightly
5. If profit factor is low: Adjust take profit levels

Guidelines:
- Make incremental improvements, don't completely redesign
- Keep the core strategy logic intact
- Focus on the specific feedback provided
- Maintain valid JSON structure

Return ONLY the improved strategy as valid JSON. No explanation, no markdown.`;
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a strategy generator agent
 */
export function createStrategyGenerator(
  llm: LLMClient,
  binance?: BinanceClient
): StrategyGeneratorAgent {
  return new StrategyGeneratorAgent(llm, binance);
}
