/**
 * Trade Evaluator
 * Tracks trade recommendations and their outcomes to enable learning from results
 *
 * This module provides:
 * - Trade outcome tracking with full context
 * - Success metrics calculation per strategy and agent
 * - Historical performance data storage
 * - Integration with Mastra's eval system patterns
 */

import { z } from "zod";
import { getDatabase, withTransaction } from "../../storage/database.ts";
import { createModuleLogger } from "../../logger/index.ts";

const logger = createModuleLogger("trade-evaluator");

// ============================================================================
// Types and Schemas
// ============================================================================

/**
 * Trade outcome record schema
 */
export const TradeOutcomeSchema = z.object({
  id: z.string(),
  tradeId: z.string(),
  planId: z.string(),

  // Trade details
  symbol: z.string(),
  strategy: z.string(),
  direction: z.enum(["long", "short"]).default("long"),

  // Entry/Exit
  entryPrice: z.number(),
  targetPrice: z.number(),
  stopLossPrice: z.number(),
  exitPrice: z.number(),

  // Outcome
  outcome: z.enum(["win", "loss", "breakeven"]),
  profitLoss: z.number(),
  profitLossPercent: z.number(),
  riskRewardActual: z.number(),
  riskRewardPlanned: z.number(),

  // Context
  marketCondition: z.enum(["trending", "ranging", "volatile", "unknown"]).default("unknown"),
  timeframe: z.string().default("4h"),
  holdingPeriodHours: z.number(),

  // Attribution
  recommendedByAgent: z.string().optional(),
  confidenceAtEntry: z.number().optional(),

  // Timestamps
  entryTimestamp: z.string(),
  exitTimestamp: z.string(),
  recordedAt: z.string(),

  // Additional metadata
  notes: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

export type TradeOutcome = z.infer<typeof TradeOutcomeSchema>;

/**
 * Trade recommendation to track (before outcome is known)
 */
export const TradeRecommendationSchema = z.object({
  id: z.string(),
  planId: z.string(),
  symbol: z.string(),
  strategy: z.string(),
  direction: z.enum(["long", "short"]).default("long"),
  entryPrice: z.number(),
  targetPrice: z.number(),
  stopLossPrice: z.number(),
  riskRewardPlanned: z.number(),
  marketCondition: z.enum(["trending", "ranging", "volatile", "unknown"]).default("unknown"),
  timeframe: z.string().default("4h"),
  recommendedByAgent: z.string().optional(),
  confidenceAtEntry: z.number().optional(),
  createdAt: z.string(),
  status: z.enum(["pending", "active", "closed", "cancelled"]).default("pending"),
});

export type TradeRecommendation = z.infer<typeof TradeRecommendationSchema>;

/**
 * Strategy performance summary
 */
export interface StrategyPerformance {
  strategy: string;
  totalTrades: number;
  wins: number;
  losses: number;
  breakeven: number;
  winRate: number;
  avgProfitPercent: number;
  avgLossPercent: number;
  profitFactor: number;
  avgRiskRewardActual: number;
  avgRiskRewardPlanned: number;
  avgHoldingPeriodHours: number;
  bestTrade: { symbol: string; profitPercent: number } | null;
  worstTrade: { symbol: string; profitPercent: number } | null;
  recentTrend: "improving" | "declining" | "stable";
}

/**
 * Agent performance summary
 */
export interface AgentPerformance {
  agentName: string;
  totalRecommendations: number;
  wins: number;
  losses: number;
  breakeven: number;
  winRate: number;
  avgConfidence: number;
  confidenceAccuracy: number; // How well confidence predicts outcomes
  bestStrategies: string[];
  worstStrategies: string[];
}

// ============================================================================
// Database Initialization
// ============================================================================

/**
 * Initialize trade evaluation tables
 */
export function initTradeEvaluatorTables(): void {
  const db = getDatabase();

  // Trade recommendations table (tracks pending trades)
  db.run(`
    CREATE TABLE IF NOT EXISTS trade_recommendations (
      id TEXT PRIMARY KEY,
      planId TEXT NOT NULL,
      symbol TEXT NOT NULL,
      strategy TEXT NOT NULL,
      direction TEXT NOT NULL DEFAULT 'long',
      entryPrice REAL NOT NULL,
      targetPrice REAL NOT NULL,
      stopLossPrice REAL NOT NULL,
      riskRewardPlanned REAL NOT NULL,
      marketCondition TEXT DEFAULT 'unknown',
      timeframe TEXT DEFAULT '4h',
      recommendedByAgent TEXT,
      confidenceAtEntry REAL,
      createdAt TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
    )
  `);

  // Trade outcomes table (tracks completed trades)
  db.run(`
    CREATE TABLE IF NOT EXISTS trade_outcomes (
      id TEXT PRIMARY KEY,
      tradeId TEXT NOT NULL,
      planId TEXT NOT NULL,
      symbol TEXT NOT NULL,
      strategy TEXT NOT NULL,
      direction TEXT NOT NULL DEFAULT 'long',
      entryPrice REAL NOT NULL,
      targetPrice REAL NOT NULL,
      stopLossPrice REAL NOT NULL,
      exitPrice REAL NOT NULL,
      outcome TEXT NOT NULL,
      profitLoss REAL NOT NULL,
      profitLossPercent REAL NOT NULL,
      riskRewardActual REAL NOT NULL,
      riskRewardPlanned REAL NOT NULL,
      marketCondition TEXT DEFAULT 'unknown',
      timeframe TEXT DEFAULT '4h',
      holdingPeriodHours REAL NOT NULL,
      recommendedByAgent TEXT,
      confidenceAtEntry REAL,
      entryTimestamp TEXT NOT NULL,
      exitTimestamp TEXT NOT NULL,
      recordedAt TEXT NOT NULL,
      notes TEXT,
      tags TEXT
    )
  `);

  // Create indexes for common queries
  db.run("CREATE INDEX IF NOT EXISTS idx_trade_outcomes_strategy ON trade_outcomes(strategy)");
  db.run("CREATE INDEX IF NOT EXISTS idx_trade_outcomes_symbol ON trade_outcomes(symbol)");
  db.run("CREATE INDEX IF NOT EXISTS idx_trade_outcomes_outcome ON trade_outcomes(outcome)");
  db.run("CREATE INDEX IF NOT EXISTS idx_trade_outcomes_agent ON trade_outcomes(recommendedByAgent)");
  db.run("CREATE INDEX IF NOT EXISTS idx_trade_outcomes_recorded ON trade_outcomes(recordedAt)");
  db.run("CREATE INDEX IF NOT EXISTS idx_recommendations_status ON trade_recommendations(status)");
  db.run("CREATE INDEX IF NOT EXISTS idx_recommendations_plan ON trade_recommendations(planId)");

  logger.info("Trade evaluator tables initialized");
}

// ============================================================================
// Recommendation Tracking
// ============================================================================

/**
 * Generate a unique recommendation ID
 */
function generateRecommendationId(): string {
  const random = Math.random().toString(36).substring(2, 10);
  return `rec_${random}`;
}

/**
 * Generate a unique outcome ID
 */
function generateOutcomeId(): string {
  const random = Math.random().toString(36).substring(2, 10);
  return `out_${random}`;
}

/**
 * Track a new trade recommendation
 */
export function trackRecommendation(
  recommendation: Omit<TradeRecommendation, "id" | "createdAt" | "status">
): TradeRecommendation {
  const db = getDatabase();
  const id = generateRecommendationId();
  const createdAt = new Date().toISOString();

  const stmt = db.prepare(`
    INSERT INTO trade_recommendations (
      id, planId, symbol, strategy, direction, entryPrice, targetPrice,
      stopLossPrice, riskRewardPlanned, marketCondition, timeframe,
      recommendedByAgent, confidenceAtEntry, createdAt, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    id,
    recommendation.planId,
    recommendation.symbol,
    recommendation.strategy,
    recommendation.direction ?? "long",
    recommendation.entryPrice,
    recommendation.targetPrice,
    recommendation.stopLossPrice,
    recommendation.riskRewardPlanned,
    recommendation.marketCondition ?? "unknown",
    recommendation.timeframe ?? "4h",
    recommendation.recommendedByAgent ?? null,
    recommendation.confidenceAtEntry ?? null,
    createdAt,
    "pending"
  );

  const tracked: TradeRecommendation = {
    ...recommendation,
    id,
    createdAt,
    status: "pending",
    direction: recommendation.direction ?? "long",
    marketCondition: recommendation.marketCondition ?? "unknown",
    timeframe: recommendation.timeframe ?? "4h",
  };

  logger.info("Tracked recommendation", { id, symbol: recommendation.symbol, strategy: recommendation.strategy });
  return tracked;
}

/**
 * Update recommendation status
 */
export function updateRecommendationStatus(
  recommendationId: string,
  status: TradeRecommendation["status"]
): void {
  const db = getDatabase();
  const stmt = db.prepare("UPDATE trade_recommendations SET status = ? WHERE id = ?");
  stmt.run(status, recommendationId);
  logger.debug("Updated recommendation status", { id: recommendationId, status });
}

/**
 * Get recommendation by plan ID
 */
export function getRecommendationByPlanId(planId: string): TradeRecommendation | null {
  const db = getDatabase();
  const stmt = db.prepare("SELECT * FROM trade_recommendations WHERE planId = ?");
  const row = stmt.get(planId) as Record<string, unknown> | null;

  if (!row) return null;

  return {
    id: row.id as string,
    planId: row.planId as string,
    symbol: row.symbol as string,
    strategy: row.strategy as string,
    direction: (row.direction as "long" | "short") ?? "long",
    entryPrice: row.entryPrice as number,
    targetPrice: row.targetPrice as number,
    stopLossPrice: row.stopLossPrice as number,
    riskRewardPlanned: row.riskRewardPlanned as number,
    marketCondition: (row.marketCondition as TradeRecommendation["marketCondition"]) ?? "unknown",
    timeframe: (row.timeframe as string) ?? "4h",
    recommendedByAgent: row.recommendedByAgent as string | undefined,
    confidenceAtEntry: row.confidenceAtEntry as number | undefined,
    createdAt: row.createdAt as string,
    status: row.status as TradeRecommendation["status"],
  };
}

/**
 * Get active recommendations
 */
export function getActiveRecommendations(): TradeRecommendation[] {
  const db = getDatabase();
  const stmt = db.prepare("SELECT * FROM trade_recommendations WHERE status IN ('pending', 'active') ORDER BY createdAt DESC");
  const rows = stmt.all() as Record<string, unknown>[];

  return rows.map((row) => ({
    id: row.id as string,
    planId: row.planId as string,
    symbol: row.symbol as string,
    strategy: row.strategy as string,
    direction: (row.direction as "long" | "short") ?? "long",
    entryPrice: row.entryPrice as number,
    targetPrice: row.targetPrice as number,
    stopLossPrice: row.stopLossPrice as number,
    riskRewardPlanned: row.riskRewardPlanned as number,
    marketCondition: (row.marketCondition as TradeRecommendation["marketCondition"]) ?? "unknown",
    timeframe: (row.timeframe as string) ?? "4h",
    recommendedByAgent: row.recommendedByAgent as string | undefined,
    confidenceAtEntry: row.confidenceAtEntry as number | undefined,
    createdAt: row.createdAt as string,
    status: row.status as TradeRecommendation["status"],
  }));
}

// ============================================================================
// Outcome Recording
// ============================================================================

/**
 * Record a trade outcome
 */
export function recordTradeOutcome(
  outcome: Omit<TradeOutcome, "id" | "recordedAt">
): TradeOutcome {
  const db = getDatabase();
  const id = generateOutcomeId();
  const recordedAt = new Date().toISOString();

  const stmt = db.prepare(`
    INSERT INTO trade_outcomes (
      id, tradeId, planId, symbol, strategy, direction,
      entryPrice, targetPrice, stopLossPrice, exitPrice,
      outcome, profitLoss, profitLossPercent, riskRewardActual, riskRewardPlanned,
      marketCondition, timeframe, holdingPeriodHours,
      recommendedByAgent, confidenceAtEntry,
      entryTimestamp, exitTimestamp, recordedAt, notes, tags
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    id,
    outcome.tradeId,
    outcome.planId,
    outcome.symbol,
    outcome.strategy,
    outcome.direction ?? "long",
    outcome.entryPrice,
    outcome.targetPrice,
    outcome.stopLossPrice,
    outcome.exitPrice,
    outcome.outcome,
    outcome.profitLoss,
    outcome.profitLossPercent,
    outcome.riskRewardActual,
    outcome.riskRewardPlanned,
    outcome.marketCondition ?? "unknown",
    outcome.timeframe ?? "4h",
    outcome.holdingPeriodHours,
    outcome.recommendedByAgent ?? null,
    outcome.confidenceAtEntry ?? null,
    outcome.entryTimestamp,
    outcome.exitTimestamp,
    recordedAt,
    outcome.notes ?? null,
    outcome.tags ? JSON.stringify(outcome.tags) : null
  );

  // Update recommendation status if exists
  const recommendation = getRecommendationByPlanId(outcome.planId);
  if (recommendation) {
    updateRecommendationStatus(recommendation.id, "closed");
  }

  const recorded: TradeOutcome = {
    ...outcome,
    id,
    recordedAt,
    direction: outcome.direction ?? "long",
    marketCondition: outcome.marketCondition ?? "unknown",
    timeframe: outcome.timeframe ?? "4h",
  };

  logger.info("Recorded trade outcome", {
    id,
    symbol: outcome.symbol,
    strategy: outcome.strategy,
    outcome: outcome.outcome,
    profitLossPercent: outcome.profitLossPercent,
  });

  return recorded;
}

/**
 * Get all trade outcomes
 */
export function getTradeOutcomes(filter?: {
  strategy?: string;
  symbol?: string;
  outcome?: TradeOutcome["outcome"];
  agent?: string;
  limit?: number;
  sinceDate?: string;
}): TradeOutcome[] {
  const db = getDatabase();
  let query = "SELECT * FROM trade_outcomes WHERE 1=1";
  const params: unknown[] = [];

  if (filter?.strategy) {
    query += " AND strategy = ?";
    params.push(filter.strategy);
  }

  if (filter?.symbol) {
    query += " AND symbol = ?";
    params.push(filter.symbol);
  }

  if (filter?.outcome) {
    query += " AND outcome = ?";
    params.push(filter.outcome);
  }

  if (filter?.agent) {
    query += " AND recommendedByAgent = ?";
    params.push(filter.agent);
  }

  if (filter?.sinceDate) {
    query += " AND recordedAt >= ?";
    params.push(filter.sinceDate);
  }

  query += " ORDER BY recordedAt DESC";

  if (filter?.limit) {
    query += " LIMIT ?";
    params.push(filter.limit);
  }

  const stmt = db.prepare(query);
  const rows = (params.length > 0 ? stmt.all(...(params as (string | number)[])) : stmt.all()) as Record<string, unknown>[];

  return rows.map((row) => ({
    id: row.id as string,
    tradeId: row.tradeId as string,
    planId: row.planId as string,
    symbol: row.symbol as string,
    strategy: row.strategy as string,
    direction: (row.direction as "long" | "short") ?? "long",
    entryPrice: row.entryPrice as number,
    targetPrice: row.targetPrice as number,
    stopLossPrice: row.stopLossPrice as number,
    exitPrice: row.exitPrice as number,
    outcome: row.outcome as TradeOutcome["outcome"],
    profitLoss: row.profitLoss as number,
    profitLossPercent: row.profitLossPercent as number,
    riskRewardActual: row.riskRewardActual as number,
    riskRewardPlanned: row.riskRewardPlanned as number,
    marketCondition: (row.marketCondition as TradeOutcome["marketCondition"]) ?? "unknown",
    timeframe: (row.timeframe as string) ?? "4h",
    holdingPeriodHours: row.holdingPeriodHours as number,
    recommendedByAgent: row.recommendedByAgent as string | undefined,
    confidenceAtEntry: row.confidenceAtEntry as number | undefined,
    entryTimestamp: row.entryTimestamp as string,
    exitTimestamp: row.exitTimestamp as string,
    recordedAt: row.recordedAt as string,
    notes: row.notes as string | undefined,
    tags: row.tags ? JSON.parse(row.tags as string) : undefined,
  }));
}

// ============================================================================
// Performance Calculations
// ============================================================================

/**
 * Calculate performance metrics for a strategy
 */
export function getStrategyPerformance(strategy: string): StrategyPerformance {
  const outcomes = getTradeOutcomes({ strategy });

  if (outcomes.length === 0) {
    return {
      strategy,
      totalTrades: 0,
      wins: 0,
      losses: 0,
      breakeven: 0,
      winRate: 0,
      avgProfitPercent: 0,
      avgLossPercent: 0,
      profitFactor: 0,
      avgRiskRewardActual: 0,
      avgRiskRewardPlanned: 0,
      avgHoldingPeriodHours: 0,
      bestTrade: null,
      worstTrade: null,
      recentTrend: "stable",
    };
  }

  const wins = outcomes.filter((o) => o.outcome === "win");
  const losses = outcomes.filter((o) => o.outcome === "loss");
  const breakevens = outcomes.filter((o) => o.outcome === "breakeven");

  const totalProfit = wins.reduce((sum, o) => sum + o.profitLossPercent, 0);
  const totalLoss = Math.abs(losses.reduce((sum, o) => sum + o.profitLossPercent, 0));

  // Find best and worst trades
  const sortedByProfit = [...outcomes].sort((a, b) => b.profitLossPercent - a.profitLossPercent);
  const bestTrade = sortedByProfit[0];
  const worstTrade = sortedByProfit[sortedByProfit.length - 1];

  // Calculate recent trend (last 10 vs previous 10)
  let recentTrend: "improving" | "declining" | "stable" = "stable";
  if (outcomes.length >= 10) {
    const recent = outcomes.slice(0, 10);
    const previous = outcomes.slice(10, 20);
    if (previous.length >= 5) {
      const recentWinRate = recent.filter((o) => o.outcome === "win").length / recent.length;
      const previousWinRate = previous.filter((o) => o.outcome === "win").length / previous.length;
      if (recentWinRate > previousWinRate + 0.1) {
        recentTrend = "improving";
      } else if (recentWinRate < previousWinRate - 0.1) {
        recentTrend = "declining";
      }
    }
  }

  return {
    strategy,
    totalTrades: outcomes.length,
    wins: wins.length,
    losses: losses.length,
    breakeven: breakevens.length,
    winRate: outcomes.length > 0 ? wins.length / outcomes.length : 0,
    avgProfitPercent: wins.length > 0 ? totalProfit / wins.length : 0,
    avgLossPercent: losses.length > 0 ? totalLoss / losses.length : 0,
    profitFactor: totalLoss > 0 ? totalProfit / totalLoss : totalProfit > 0 ? Infinity : 0,
    avgRiskRewardActual:
      outcomes.length > 0
        ? outcomes.reduce((sum, o) => sum + o.riskRewardActual, 0) / outcomes.length
        : 0,
    avgRiskRewardPlanned:
      outcomes.length > 0
        ? outcomes.reduce((sum, o) => sum + o.riskRewardPlanned, 0) / outcomes.length
        : 0,
    avgHoldingPeriodHours:
      outcomes.length > 0
        ? outcomes.reduce((sum, o) => sum + o.holdingPeriodHours, 0) / outcomes.length
        : 0,
    bestTrade: bestTrade
      ? { symbol: bestTrade.symbol, profitPercent: bestTrade.profitLossPercent }
      : null,
    worstTrade: worstTrade
      ? { symbol: worstTrade.symbol, profitPercent: worstTrade.profitLossPercent }
      : null,
    recentTrend,
  };
}

/**
 * Calculate performance metrics for an agent
 */
export function getAgentPerformance(agentName: string): AgentPerformance {
  const outcomes = getTradeOutcomes({ agent: agentName });

  if (outcomes.length === 0) {
    return {
      agentName,
      totalRecommendations: 0,
      wins: 0,
      losses: 0,
      breakeven: 0,
      winRate: 0,
      avgConfidence: 0,
      confidenceAccuracy: 0,
      bestStrategies: [],
      worstStrategies: [],
    };
  }

  const wins = outcomes.filter((o) => o.outcome === "win");
  const losses = outcomes.filter((o) => o.outcome === "loss");
  const breakevens = outcomes.filter((o) => o.outcome === "breakeven");

  // Calculate average confidence
  const outcomesWithConfidence = outcomes.filter((o) => o.confidenceAtEntry !== undefined);
  const avgConfidence =
    outcomesWithConfidence.length > 0
      ? outcomesWithConfidence.reduce((sum, o) => sum + (o.confidenceAtEntry ?? 0), 0) /
        outcomesWithConfidence.length
      : 0;

  // Calculate confidence accuracy (do high confidence trades win more?)
  let confidenceAccuracy = 0;
  if (outcomesWithConfidence.length >= 5) {
    const highConfidence = outcomesWithConfidence.filter((o) => (o.confidenceAtEntry ?? 0) >= 0.7);
    const lowConfidence = outcomesWithConfidence.filter((o) => (o.confidenceAtEntry ?? 0) < 0.5);

    const highConfWinRate =
      highConfidence.length > 0
        ? highConfidence.filter((o) => o.outcome === "win").length / highConfidence.length
        : 0;
    const lowConfWinRate =
      lowConfidence.length > 0
        ? lowConfidence.filter((o) => o.outcome === "win").length / lowConfidence.length
        : 0;

    // Accuracy is higher when high confidence trades outperform low confidence
    confidenceAccuracy = Math.max(0, highConfWinRate - lowConfWinRate);
  }

  // Calculate strategy performance for this agent
  const strategyStats = new Map<string, { wins: number; total: number }>();
  for (const outcome of outcomes) {
    const stats = strategyStats.get(outcome.strategy) || { wins: 0, total: 0 };
    stats.total++;
    if (outcome.outcome === "win") stats.wins++;
    strategyStats.set(outcome.strategy, stats);
  }

  const strategyPerformances = Array.from(strategyStats.entries())
    .filter(([_, stats]) => stats.total >= 3) // Minimum 3 trades
    .map(([strategy, stats]) => ({
      strategy,
      winRate: stats.wins / stats.total,
    }))
    .sort((a, b) => b.winRate - a.winRate);

  const bestStrategies = strategyPerformances.slice(0, 3).map((s) => s.strategy);
  const worstStrategies = strategyPerformances.slice(-3).map((s) => s.strategy);

  return {
    agentName,
    totalRecommendations: outcomes.length,
    wins: wins.length,
    losses: losses.length,
    breakeven: breakevens.length,
    winRate: outcomes.length > 0 ? wins.length / outcomes.length : 0,
    avgConfidence,
    confidenceAccuracy,
    bestStrategies,
    worstStrategies,
  };
}

/**
 * Get all strategy performances
 */
export function getAllStrategyPerformances(): StrategyPerformance[] {
  const db = getDatabase();
  const stmt = db.prepare("SELECT DISTINCT strategy FROM trade_outcomes");
  const rows = stmt.all() as { strategy: string }[];

  return rows.map((row) => getStrategyPerformance(row.strategy));
}

/**
 * Get recent trade summary for context injection
 */
export function getRecentTradeSummary(
  limit: number = 20
): {
  totalTrades: number;
  winRate: number;
  bestSetups: string[];
  cautiousSetups: string[];
  recentPatterns: string[];
} {
  const outcomes = getTradeOutcomes({ limit });

  if (outcomes.length === 0) {
    return {
      totalTrades: 0,
      winRate: 0,
      bestSetups: [],
      cautiousSetups: [],
      recentPatterns: [],
    };
  }

  const winRate = outcomes.filter((o) => o.outcome === "win").length / outcomes.length;

  // Group by strategy
  const strategyStats = new Map<string, { wins: number; losses: number }>();
  for (const outcome of outcomes) {
    const stats = strategyStats.get(outcome.strategy) || { wins: 0, losses: 0 };
    if (outcome.outcome === "win") stats.wins++;
    else if (outcome.outcome === "loss") stats.losses++;
    strategyStats.set(outcome.strategy, stats);
  }

  // Find best and cautious setups
  const strategyWinRates = Array.from(strategyStats.entries())
    .filter(([_, stats]) => stats.wins + stats.losses >= 2)
    .map(([strategy, stats]) => ({
      strategy,
      winRate: stats.wins / (stats.wins + stats.losses),
      total: stats.wins + stats.losses,
    }))
    .sort((a, b) => b.winRate - a.winRate);

  const bestSetups = strategyWinRates
    .filter((s) => s.winRate >= 0.6)
    .slice(0, 3)
    .map((s) => `${s.strategy} (${Math.round(s.winRate * 100)}% win rate)`);

  const cautiousSetups = strategyWinRates
    .filter((s) => s.winRate < 0.4)
    .slice(0, 3)
    .map((s) => `${s.strategy} (${Math.round(s.winRate * 100)}% win rate)`);

  // Identify recent patterns
  const recentPatterns: string[] = [];

  // Check market condition correlation
  const conditionStats = new Map<string, { wins: number; losses: number }>();
  for (const outcome of outcomes) {
    const stats = conditionStats.get(outcome.marketCondition) || { wins: 0, losses: 0 };
    if (outcome.outcome === "win") stats.wins++;
    else if (outcome.outcome === "loss") stats.losses++;
    conditionStats.set(outcome.marketCondition, stats);
  }

  for (const [condition, stats] of conditionStats.entries()) {
    const total = stats.wins + stats.losses;
    if (total >= 3) {
      const condWinRate = stats.wins / total;
      if (condWinRate >= 0.7) {
        recentPatterns.push(`Strong performance in ${condition} markets`);
      } else if (condWinRate <= 0.3) {
        recentPatterns.push(`Struggles in ${condition} markets`);
      }
    }
  }

  // Check holding period correlation
  const shortHolds = outcomes.filter((o) => o.holdingPeriodHours < 12);
  const longHolds = outcomes.filter((o) => o.holdingPeriodHours >= 24);

  if (shortHolds.length >= 3 && longHolds.length >= 3) {
    const shortWinRate = shortHolds.filter((o) => o.outcome === "win").length / shortHolds.length;
    const longWinRate = longHolds.filter((o) => o.outcome === "win").length / longHolds.length;

    if (shortWinRate > longWinRate + 0.2) {
      recentPatterns.push("Better results with shorter holding periods");
    } else if (longWinRate > shortWinRate + 0.2) {
      recentPatterns.push("Better results with longer holding periods");
    }
  }

  return {
    totalTrades: outcomes.length,
    winRate,
    bestSetups,
    cautiousSetups,
    recentPatterns,
  };
}

// Initialize tables on module load
try {
  initTradeEvaluatorTables();
} catch (error) {
  logger.error("Failed to initialize trade evaluator tables", error instanceof Error ? error : undefined);
}
