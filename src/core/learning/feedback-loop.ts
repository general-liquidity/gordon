/**
 * Feedback Loop
 *
 * Automated post-trade learning. When a trade closes:
 * 1. Fetches historical candles covering the trade period
 * 2. Runs counterfactual analysis
 * 3. Stores insights
 * 4. Detects recurring patterns across trades
 * 5. Feeds patterns to the mutation system for playbook evolution
 */

import type { Exchange } from "../../infra/exchange/types.ts";
import type { Trade } from "../../types/index.ts";
import { CounterfactualAnalyzer } from "./counterfactual-analyzer.ts";
import { saveReport, getRecurringInsights } from "./insight-store.ts";
import { createModuleLogger } from "../../infra/logger/index.ts";
import { logEvent } from "../../infra/storage/events.ts";
import { GenomeManager } from "../genome/manager.ts";
import { saveSuggestion } from "../genome/store.ts";
import type { Mutation } from "../genome/types.ts";
import { v4 as uuidv4 } from "uuid";

const logger = createModuleLogger("feedback-loop");

export class FeedbackLoop {
  private static instance: FeedbackLoop;

  private analyzer: CounterfactualAnalyzer;

  private constructor() {
    this.analyzer = new CounterfactualAnalyzer();
  }

  static getInstance(): FeedbackLoop {
    if (!FeedbackLoop.instance) {
      FeedbackLoop.instance = new FeedbackLoop();
    }
    return FeedbackLoop.instance;
  }

  /**
   * Called when a trade closes (from reconciliation).
   * Runs counterfactual analysis and stores insights.
   *
   * Fire-and-forget — does not throw. Errors are logged.
   */
  async onTradeClosed(trade: Trade, exchange: Exchange): Promise<void> {
    try {
      if (trade.entries.length === 0 || trade.exits.length === 0) {
        logger.debug("Skipping counterfactual analysis — no entries/exits", {
          tradeId: trade.id,
        });
        return;
      }

      // Determine the time range for candle fetch
      const entryTime = new Date(trade.entries[0]!.filledAt).getTime();
      const exitTime = new Date(trade.exits[trade.exits.length - 1]!.filledAt).getTime();
      const durationMs = exitTime - entryTime;

      // Fetch candles with buffer (2x the trade duration before and after)
      const bufferMs = Math.max(durationMs, 60 * 60 * 1000); // min 1 hour buffer
      const startTime = entryTime - bufferMs;
      const totalCandles = Math.ceil((durationMs + 2 * bufferMs) / (60 * 60 * 1000)); // 1h candles

      const candles = await exchange.getCandles(
        trade.symbol,
        "1h",
        Math.min(500, Math.max(50, totalCandles)),
      );

      if (candles.length < 10) {
        logger.debug("Insufficient candle data for counterfactual analysis", {
          tradeId: trade.id,
          candleCount: candles.length,
        });
        return;
      }

      // Run analysis
      const report = this.analyzer.analyzeTrade(trade, candles);

      // Store results
      saveReport(report);

      // Log event
      logEvent({
        type: "SYSTEM",
        data: {
          action: "COUNTERFACTUAL_ANALYSIS_COMPLETE",
          tradeId: trade.id,
          symbol: trade.symbol,
          actualPnl: report.actualPnl,
          bestAlternativePnl: report.bestAlternativePnl,
          improvementPercent: report.improvementPercent,
          insightCount: report.insights.length,
        },
        tradeId: trade.id,
        planId: trade.planId,
      });

      // Check for recurring patterns
      if (trade.planId) {
        this.checkRecurringPatterns(trade);
      }

      logger.info("Feedback loop processed trade", {
        tradeId: trade.id,
        insights: report.insights.length,
        improvementPercent: report.improvementPercent.toFixed(1),
      });
    } catch (error) {
      logger.warn("Feedback loop failed for trade", {
        tradeId: trade.id,
        error: (error as Error).message,
      });
    }
  }

  /**
   * Manually trigger analysis for a specific trade.
   */
  async analyzeTrade(tradeId: string, trade: Trade, exchange: Exchange): Promise<void> {
    await this.onTradeClosed(trade, exchange);
  }

  /**
   * Check for recurring patterns and feed them to the genome mutation system.
   */
  private checkRecurringPatterns(trade: Trade): void {
    try {
      const playbookName = trade.planId ? `plan_${trade.planId.slice(0, 8)}` : undefined;
      if (!playbookName) return;

      const recurring = getRecurringInsights(playbookName, 3);

      if (recurring.length > 0) {
        logger.info("Recurring patterns detected", {
          playbook: playbookName,
          patterns: recurring.map((r) => `${r.category}: ${r.direction} (${r.occurrences}x)`),
        });

        logEvent({
          type: "SYSTEM",
          data: {
            action: "RECURRING_PATTERNS_DETECTED",
            playbook: playbookName,
            patterns: recurring,
          },
        });

        // Feed patterns to the genome mutation system as suggestions
        try {
          const gm = GenomeManager.getInstance();
          const genome = gm.getBestGenome(playbookName);
          if (!genome) return;

          const mutations: Mutation[] = [];
          for (const insight of recurring) {
            if (insight.category === "stop_loss" && insight.direction === "decrease") {
              mutations.push({
                mutation_id: uuidv4(),
                field_path: "exit.stop_loss.value",
                parameter_name: "Stop loss percentage",
                from_value: 0,
                to_value: insight.avgOptimalValue,
                mutation_type: "nudge",
                reason: `Recurring pattern: tighter SL (${insight.occurrences}x, avg pnl delta: ${insight.avgPnlDelta.toFixed(2)})`,
                suggested_by: "FeedbackLoop",
                created_at: new Date().toISOString(),
              });
            } else if (insight.category === "take_profit" && insight.direction === "increase") {
              mutations.push({
                mutation_id: uuidv4(),
                field_path: "exit.take_profit.0.level",
                parameter_name: "Take profit level",
                from_value: 0,
                to_value: insight.avgOptimalValue,
                mutation_type: "nudge",
                reason: `Recurring pattern: wider TP (${insight.occurrences}x, avg pnl delta: ${insight.avgPnlDelta.toFixed(2)})`,
                suggested_by: "FeedbackLoop",
                created_at: new Date().toISOString(),
              });
            }
          }

          if (mutations.length > 0) {
            saveSuggestion({
              suggestion_id: uuidv4(),
              genome_id: genome.genome_id,
              suggested_by: "FeedbackLoop",
              reason: `Recurring patterns from ${recurring.length} categories`,
              mutations,
              confidence: Math.min(0.95, recurring.reduce((s, r) => s + r.occurrences, 0) / 20),
              status: "pending",
              created_at: new Date().toISOString(),
            });
            logger.info("Fed recurring patterns to genome system", {
              genome: genome.genome_id,
              mutations: mutations.length,
            });
          }
        } catch (genomeErr) {
          logger.debug("Could not feed patterns to genome system", {
            error: (genomeErr as Error).message,
          });
        }
      }
    } catch (error) {
      logger.debug("Could not check recurring patterns", {
        error: (error as Error).message,
      });
    }
  }
}
