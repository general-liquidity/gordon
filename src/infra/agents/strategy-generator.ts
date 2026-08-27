/**
 * Strategy Generator Agent
 *
 * AI-powered trading strategy generation from natural language descriptions.
 * Uses LLM to generate Strategy DSL JSON that can be validated, backtested,
 * and iteratively improved based on performance feedback.
 */

import { z } from "zod";
import type { LLMClient, Message, ModelConfig, LLMProvider } from "../ai/llm/index.ts";
import { providerRegistry } from "../runtime/providers/registry.ts";
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
import type { Exchange } from "../exchange/index.ts";
import { createModuleLogger } from "../logger/index.ts";
import { DSLStrategyAdapter } from "../../strategies/dsl/adapter.ts";
import { validateStrategyCode } from "../trading/ops/strategyCodeValidator.ts";
import { recordAttempt, dynamicDeflatedThreshold } from "../trading/ops/multipleTestingTracker.ts";
import { capacitySweep } from "../../backtest/analysis/marketImpact.ts";

const logger = createModuleLogger("strategy-generator");
export const BACKTEST_NOT_PERFORMED_WARNING =
  "Backtest not performed - exchange client unavailable";

/**
 * Resolve a model tier ("flagship" / "fast") to a provider + model against
 * whichever first-party provider the operator configured, so strategy
 * generation tracks the operator's model family instead of a hardcoded model.
 * Falls back to a first-party Anthropic model when no key is configured.
 */
function tierRoute(tier: "flagship" | "fast"): { provider: LLMProvider; model: string } {
  const fallback = tier === "fast" ? "anthropic/claude-haiku-4-5" : "anthropic/claude-opus-4-8";
  let spec: string;
  try {
    spec = tier === "fast" ? providerRegistry.getFastModel() : providerRegistry.getDefaultModel();
  } catch {
    spec = fallback;
  }
  const slash = spec.indexOf("/");
  if (slash === -1) return { provider: "anthropic", model: spec };
  return { provider: spec.slice(0, slash) as LLMProvider, model: spec.slice(slash + 1) };
}

/** Fast stable hash for use as a multiple-testing codeHash. */
function quickHashDsl(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(16).padStart(8, "0");
}

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
  /**
   * Average daily volume (in same units as intended order size) for
   * the symbol being backtested. When supplied, the generator computes
   * a capacity sweep alongside the backtest — answering "at what size
   * does this strategy stop working?" Optional.
   */
  adv?: number;
  /**
   * Estimated daily turnover as a fraction of position (0..1). Used
   * with `adv` for the capacity sweep. Default 0.2 (a fifth of the
   * position rebalanced per day on average).
   */
  turnoverPerDay?: number;
}

/** Why no backtest was produced for a generated strategy. */
export type BacktestAbsenceReason =
  /** No exchange client was configured, so a backtest was impossible. */
  | "no_exchange_client"
  /** A backtest was attempted and threw. */
  | "backtest_failed";

/**
 * Typed absent-backtest state. A generation result carries this INSTEAD of a
 * fabricated zero-metric result, so no consumer can mistake "never measured"
 * for "measured, and the numbers were zero". `maxDrawdown: 0` in particular is
 * the theoretical best value and would bias any drawdown-weighted pooling.
 */
export interface AbsentBacktest {
  reason: BacktestAbsenceReason;
  /** Error message when `reason` is "backtest_failed". */
  detail?: string;
}

/** Human-readable line for an absent backtest, for surfacing to the user. */
export function describeAbsentBacktest(absent: AbsentBacktest): string {
  return absent.reason === "no_exchange_client"
    ? BACKTEST_NOT_PERFORMED_WARNING
    : `Backtest failed: ${absent.detail ?? "unknown error"}`;
}

/**
 * Result of strategy generation
 */
export interface GeneratedStrategy {
  /** The generated strategy DSL */
  strategy: StrategyDSL;
  /** Backtest results, or null when no backtest was produced. */
  backtestResult: BacktestResult | null;
  /** Set when `backtestResult` is null: says WHY no backtest exists. */
  backtestAbsent: AbsentBacktest | null;
  /** Number of iterations used */
  iterations: number;
  /** Improvements made during iteration */
  improvements: string[];
  /** Whether the strategy met the performance thresholds */
  meetsThresholds: boolean;
  /**
   * Recovery steps taken silently during generation. Recovery is intentional
   * (an assistant should not hard-fail on a flaky LLM call), but the caller
   * and the user must be able to see that they did not get what they asked for.
   */
  degradations: GenerationDegradation[];
  /** Generation timestamp */
  generatedAt: string;
}

/** What kind of recovery was applied when a generation step failed. */
export type GenerationDegradationKind =
  /** Intent parsing failed; hardcoded default intent fields were substituted. */
  | "intent_parse_defaulted"
  /** DSL generation failed; a template strategy was substituted for the LLM output. */
  | "dsl_generation_substituted"
  /** Schema-repair call failed; only minimal local field fixes were applied. */
  | "validation_repair_minimal";

export interface GenerationDegradation {
  kind: GenerationDegradationKind;
  /** What was substituted or defaulted, and why. */
  detail: string;
}

interface IterateStrategyOptions {
  /**
   * Whether to run a fresh backtest after strategy iteration.
   * Defaults to true.
   */
  reBacktest?: boolean;
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
  private exchange?: Exchange;

  constructor(llm: LLMClient, exchange?: Exchange) {
    this.llm = llm;
    this.exchange = exchange;
  }

  /**
   * Set the exchange client for backtesting
   */
  setExchangeClient(exchange: Exchange): void {
    this.exchange = exchange;
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
  async generateFromPrompt(prompt: string, options: GenerationOptions): Promise<GeneratedStrategy> {
    const { minSharpe = 0.5, maxIterations = 3, minWinRate = 40, maxDrawdown = 30 } = options;

    logger.info("Starting strategy generation", { prompt: prompt.slice(0, 100) });

    const degradations: GenerationDegradation[] = [];

    // Step 1: Parse user intent
    const intent = await this.parseIntent(prompt, options, degradations);
    logger.info("Parsed intent", { style: intent.style, indicators: intent.indicators });

    // Step 2: Generate initial strategy
    let strategy = await this.generateDSL(intent, options, degradations);
    let iterations = 1;
    const improvements: string[] = [];

    // Step 3: Validate and backtest loop
    let backtestResult: BacktestResult | null = null;
    let backtestAbsent: AbsentBacktest | null = null;

    const family = `${intent.style}/${options.symbol}`;

    while (iterations <= maxIterations) {
      // Validate the strategy
      const validation = validateStrategyDSL(strategy);
      if (!validation.success) {
        logger.warn("Strategy validation failed, regenerating", {
          errors: validation.errors,
        });
        // A candidate that fails validation still consumed a null trial, so
        // count it before regenerating, or the multiple-testing bar only ever
        // sees the survivors.
        this.recordGenerationTrial(family, strategy, {
          verdict: "errored",
          observedSharpe: 0,
          notes: `validation failed: ${(validation.errors ?? []).slice(0, 3).join("; ")}`,
        });
        strategy = await this.fixValidationErrors(strategy, validation.errors ?? [], degradations);
        continue;
      }

      // Q2: defensive anti-pattern scan over the DSL serialization.
      // Catches expression-string anti-patterns (e.g. "signal * returns" without
      // shift) that survive DSL schema validation but would still imply a
      // leakage-prone strategy. Warn-only — DSL schema is the primary gate.
      {
        const codeScan = validateStrategyCode(JSON.stringify(strategy));
        if (codeScan.violations.length > 0) {
          logger.warn("strategy DSL anti-pattern scan", {
            block: codeScan.countsBySeverity.block,
            warn: codeScan.countsBySeverity.warn,
            firstViolations: codeScan.violations.slice(0, 3).map((v) => v.rule.id),
          });
        }
      }

      // Run backtest if we have exchange client
      if (this.exchange) {
        try {
          backtestResult = await this.runStrategyBacktest(strategy, options);

          const metrics = backtestResult.metrics;
          const meetsThresholds =
            metrics.sharpeRatio >= minSharpe &&
            metrics.winRate >= minWinRate &&
            metrics.maxDrawdown <= maxDrawdown;

          // Q3: when ADV is supplied, compute a capacity sweep alongside
          // the backtest. Surfaces "this Sharpe holds at $X, not $Y".
          if (options.adv !== undefined && options.adv > 0) {
            try {
              const periodsPerYear = 252;
              const grossReturnAnn = metrics.sharpeRatio * (metrics.volatility ?? 0);
              const volFraction = (metrics.volatility ?? 0) / Math.sqrt(periodsPerYear);
              if (metrics.volatility && metrics.volatility > 0) {
                const curve = capacitySweep({
                  grossSharpe: metrics.sharpeRatio,
                  grossReturnAnn,
                  volAnn: metrics.volatility,
                  adv: options.adv,
                  vol: volFraction,
                  turnoverPerDay: options.turnoverPerDay ?? 0.2,
                });
                logger.info("capacity sweep", {
                  capacityAtMinSharpe: curve.capacityAtMinSharpe,
                  minSharpe: curve.minSharpe,
                  points: curve.points.length,
                });
              }
            } catch (e) {
              logger.warn("capacity sweep failed", {
                error: e instanceof Error ? e.message : String(e),
              });
            }
          }

          // Q4: log this iteration as a multiple-testing attempt and surface
          // the dynamic DSR verdict alongside the static thresholds.
          {
            this.recordGenerationTrial(family, strategy, {
              verdict: meetsThresholds ? "accepted" : "rejected",
              observedSharpe: metrics.sharpeRatio,
            });
            const dsr = dynamicDeflatedThreshold({
              family,
              observedSharpeAnnualized: metrics.sharpeRatio,
              periods: options.backtestDays,
            });
            logger.info("multi-test DSR", {
              family,
              trialCount: dsr.trialCount,
              dsrPValue: Number(dsr.dsrPValue.toFixed(4)),
              dynamicPasses: dsr.passes,
              staticPasses: meetsThresholds,
            });
          }

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

          const improved = await this.iterateStrategy(strategy, backtestResult, feedback, options, {
            reBacktest: false,
          });
          strategy = improved.strategy;
          backtestResult = improved.backtestResult;
          iterations++;
        } catch (error) {
          const detail = error instanceof Error ? error.message : "Unknown error";
          logger.error("Backtest failed", { error: detail });
          backtestResult = null;
          backtestAbsent = { reason: "backtest_failed", detail };
          this.recordGenerationTrial(family, strategy, {
            verdict: "errored",
            observedSharpe: 0,
            notes: `backtest failed: ${detail}`,
          });
          break;
        }
      } else {
        // No exchange client, skip backtesting
        logger.warn("No exchange client available, skipping backtest");
        backtestAbsent = { reason: "no_exchange_client" };
        this.recordGenerationTrial(family, strategy, {
          verdict: "errored",
          observedSharpe: 0,
          notes: BACKTEST_NOT_PERFORMED_WARNING,
        });
        break;
      }
    }

    return {
      strategy,
      backtestResult,
      backtestAbsent: backtestResult ? null : (backtestAbsent ?? { reason: "no_exchange_client" }),
      iterations,
      improvements,
      // An absent backtest is not evidence of anything, so it can never meet
      // a performance threshold.
      meetsThresholds: backtestResult
        ? backtestResult.metrics.sharpeRatio >= minSharpe &&
          backtestResult.metrics.winRate >= minWinRate &&
          backtestResult.metrics.maxDrawdown <= maxDrawdown
        : false,
      degradations,
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Record one emitted candidate as a multiple-testing trial. Every candidate
   * the generator emits consumes a null trial, including ones that fail
   * validation or fail to backtest. Counting only survivors understates the
   * search burden and makes the deflated-Sharpe bar too low.
   */
  private recordGenerationTrial(
    family: string,
    strategy: StrategyDSL,
    outcome: {
      verdict: "accepted" | "rejected" | "errored";
      observedSharpe: number;
      notes?: string;
    },
  ): void {
    recordAttempt({
      family,
      codeHash: quickHashDsl(JSON.stringify(strategy)),
      observedSharpe: outcome.observedSharpe,
      verdict: outcome.verdict,
      notes: outcome.notes,
    });
  }

  /**
   * Iterate on an existing strategy based on feedback.
   */
  async iterateStrategy(
    strategy: StrategyDSL,
    backtestResult: BacktestResult,
    feedback: string,
    options: GenerationOptions,
    iterateOptions: IterateStrategyOptions = {},
  ): Promise<GeneratedStrategy> {
    const { reBacktest = true } = iterateOptions;

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
        this.getModelConfig(),
      );

      // Update metadata
      response.metadata = {
        ...response.metadata,
        generatedAt: new Date().toISOString(),
        generatedFrom: `Iteration based on feedback: ${feedback}`,
      };

      let nextBacktestResult = backtestResult;
      if (reBacktest) {
        if (this.exchange) {
          try {
            nextBacktestResult = await this.runStrategyBacktest(response, options);
          } catch (error) {
            const message = error instanceof Error ? error.message : "Unknown error";
            logger.warn("Iteration backtest failed, preserving previous backtest result", {
              error: message,
            });
            nextBacktestResult = this.withBacktestWarning(
              backtestResult,
              `Iteration backtest failed: ${message}`,
            );
          }
        } else {
          nextBacktestResult = this.withBacktestWarning(
            backtestResult,
            BACKTEST_NOT_PERFORMED_WARNING,
          );
        }
      }

      return {
        strategy: response,
        backtestResult: nextBacktestResult,
        backtestAbsent: null,
        iterations: 1,
        improvements: [feedback],
        meetsThresholds: false,
        degradations: [],
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
    options: GenerationOptions,
    degradations: GenerationDegradation[],
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
        ...tierRoute("fast"),
        temperature: 0.3,
        maxTokens: 1000,
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Unknown";
      logger.warn("Intent parsing failed, using defaults", { error: detail });
      degradations.push({
        kind: "intent_parse_defaulted",
        detail: `Intent parsing failed (${detail}); defaulted style to "trend-following" with indicators rsi, macd, sma and an ATR-based exit.`,
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
    options: GenerationOptions,
    degradations: GenerationDegradation[],
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
        this.getModelConfig(),
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
      const detail = error instanceof Error ? error.message : "Unknown";
      logger.error("DSL generation failed", { error: detail });
      degradations.push({
        kind: "dsl_generation_substituted",
        detail: `DSL generation failed (${detail}); returned a built-in template strategy instead of one generated from the request.`,
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
    errors: string[],
    degradations: GenerationDegradation[],
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
        this.getModelConfig(),
      );
    } catch (error) {
      degradations.push({
        kind: "validation_repair_minimal",
        detail: `Schema-repair call failed (${
          error instanceof Error ? error.message : "Unknown"
        }); applied only local id/tier/version defaults against errors: ${errors.slice(0, 3).join("; ")}`,
      });
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
    options: GenerationOptions,
  ): Promise<BacktestResult> {
    if (!this.exchange) {
      throw new Error("Exchange client not available for backtesting");
    }

    // Fetch historical data
    const timeframe = options.timeframes[0] || "4h";
    const ohlcData = await fetchHistoricalData(
      this.exchange,
      options.symbol,
      timeframe,
      options.backtestDays,
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
    thresholds: { minSharpe: number; minWinRate: number; maxDrawdown: number },
  ): string {
    const issues: string[] = [];

    if (metrics.sharpeRatio < thresholds.minSharpe) {
      issues.push(
        `Sharpe ratio (${metrics.sharpeRatio.toFixed(2)}) is below target (${thresholds.minSharpe}). ` +
          "Consider tightening entry conditions or improving risk-reward ratio.",
      );
    }

    if (metrics.winRate < thresholds.minWinRate) {
      issues.push(
        `Win rate (${metrics.winRate.toFixed(1)}%) is below target (${thresholds.minWinRate}%). ` +
          "Consider adding confirmation signals or adjusting entry timing.",
      );
    }

    if (metrics.maxDrawdown > thresholds.maxDrawdown) {
      issues.push(
        `Max drawdown (${metrics.maxDrawdown.toFixed(1)}%) exceeds limit (${thresholds.maxDrawdown}%). ` +
          "Consider tighter stop losses or reducing position sizes.",
      );
    }

    if (metrics.totalTrades < 10) {
      issues.push(
        `Only ${metrics.totalTrades} trades in backtest period. ` +
          "Consider relaxing entry conditions to generate more signals.",
      );
    }

    if (metrics.profitFactor < 1.5) {
      issues.push(
        `Profit factor (${metrics.profitFactor.toFixed(2)}) is low. ` +
          "Consider improving take profit levels or tightening stop loss.",
      );
    }

    return issues.join("\n\n");
  }

  /**
   * Create a fallback strategy template
   */
  private createFallbackStrategy(intent: ParsedIntent, options: GenerationOptions): StrategyDSL {
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

  private withBacktestWarning(backtestResult: BacktestResult, warning: string): BacktestResult {
    if (backtestResult.warnings.includes(warning)) {
      return backtestResult;
    }

    return {
      ...backtestResult,
      warnings: [...backtestResult.warnings, warning],
    };
  }

  /**
   * Get model configuration for strategy generation
   */
  private getModelConfig(): ModelConfig {
    return {
      ...tierRoute("flagship"),
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
  exchange?: Exchange,
): StrategyGeneratorAgent {
  return new StrategyGeneratorAgent(llm, exchange);
}
