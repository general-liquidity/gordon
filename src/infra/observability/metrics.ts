/**
 * Metrics & Observability Module
 *
 * SOTA observability for Gordon:
 * - Trade performance metrics (Sharpe, Sortino, win rate)
 * - Agent quality metrics (response time, tool success rate)
 * - System health metrics (API latency, error rates)
 */

import { createModuleLogger } from "../logger/index.ts";
import { listTrades } from "../storage/trades.ts";
import { listPlans } from "../storage/plans.ts";
import type { Trade, Plan } from "../../types/index.ts";

const logger = createModuleLogger("metrics");

// ============================================================================
// Types
// ============================================================================

export interface TradeMetrics {
  totalTrades: number;
  openTrades: number;
  closedTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  totalPnl: number;
  totalPnlPercent: number;
  largestWin: number;
  largestLoss: number;
  consecutiveWins: number;
  consecutiveLosses: number;
  avgHoldingPeriod: number; // in hours
}

export interface RiskMetrics {
  sharpeRatio: number | null;
  sortinoRatio: number | null;
  maxDrawdown: number;
  currentDrawdown: number;
  volatility: number | null;
  riskAdjustedReturn: number | null;
}

export interface AgentMetrics {
  totalRequests: number;
  avgResponseTimeMs: number;
  toolCallCount: number;
  toolSuccessRate: number;
  networkRoutingCount: number;
  errorCount: number;
  errorRate: number;
}

export interface SystemMetrics {
  uptime: number; // milliseconds
  apiCallCount: number;
  avgApiLatencyMs: number;
  rateLimitHits: number;
  memoryUsageMb: number;
}

export interface GordonMetrics {
  trade: TradeMetrics;
  risk: RiskMetrics;
  agent: AgentMetrics;
  system: SystemMetrics;
  timestamp: string;
}

// ============================================================================
// In-Memory Metrics Storage (for session)
// ============================================================================

const sessionMetrics = {
  startTime: Date.now(),
  requests: [] as { timestamp: number; responseTimeMs: number; success: boolean }[],
  toolCalls: [] as { timestamp: number; tool: string; success: boolean }[],
  apiCalls: [] as { timestamp: number; latencyMs: number; endpoint: string }[],
  errors: [] as { timestamp: number; error: string }[],
};

// ============================================================================
// Trade Metrics Calculation
// ============================================================================

/**
 * Calculate comprehensive trade metrics from trade history
 */
export function calculateTradeMetrics(): TradeMetrics {
  const trades = listTrades();
  const closedTrades = trades.filter((t) => t.status === "CLOSED");
  const openTrades = trades.filter((t) => t.status === "OPEN");

  if (closedTrades.length === 0) {
    return {
      totalTrades: trades.length,
      openTrades: openTrades.length,
      closedTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      winRate: 0,
      avgWin: 0,
      avgLoss: 0,
      profitFactor: 0,
      totalPnl: 0,
      totalPnlPercent: 0,
      largestWin: 0,
      largestLoss: 0,
      consecutiveWins: 0,
      consecutiveLosses: 0,
      avgHoldingPeriod: 0,
    };
  }

  const winningTrades = closedTrades.filter((t) => t.realizedPnl > 0);
  const losingTrades = closedTrades.filter((t) => t.realizedPnl < 0);

  const totalWins = winningTrades.reduce((sum, t) => sum + t.realizedPnl, 0);
  const totalLosses = Math.abs(losingTrades.reduce((sum, t) => sum + t.realizedPnl, 0));

  // Calculate consecutive wins/losses
  let maxConsecutiveWins = 0;
  let maxConsecutiveLosses = 0;
  let currentConsecutive = 0;
  let lastWasWin: boolean | null = null;

  for (const trade of closedTrades) {
    const isWin = trade.realizedPnl > 0;
    if (lastWasWin === isWin) {
      currentConsecutive++;
    } else {
      currentConsecutive = 1;
      lastWasWin = isWin;
    }

    if (isWin) {
      maxConsecutiveWins = Math.max(maxConsecutiveWins, currentConsecutive);
    } else {
      maxConsecutiveLosses = Math.max(maxConsecutiveLosses, currentConsecutive);
    }
  }

  // Calculate average holding period
  const holdingPeriods = closedTrades
    .filter((t) => t.openedAt && t.closedAt)
    .map((t) => {
      const open = new Date(t.openedAt).getTime();
      const close = new Date(t.closedAt!).getTime();
      return (close - open) / (1000 * 60 * 60); // hours
    });
  const avgHoldingPeriod =
    holdingPeriods.length > 0
      ? holdingPeriods.reduce((a, b) => a + b, 0) / holdingPeriods.length
      : 0;

  return {
    totalTrades: trades.length,
    openTrades: openTrades.length,
    closedTrades: closedTrades.length,
    winningTrades: winningTrades.length,
    losingTrades: losingTrades.length,
    winRate: closedTrades.length > 0 ? winningTrades.length / closedTrades.length : 0,
    avgWin: winningTrades.length > 0 ? totalWins / winningTrades.length : 0,
    avgLoss: losingTrades.length > 0 ? totalLosses / losingTrades.length : 0,
    profitFactor: totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? Infinity : 0,
    totalPnl: closedTrades.reduce((sum, t) => sum + t.realizedPnl, 0),
    totalPnlPercent: closedTrades.reduce((sum, t) => sum + t.realizedPnlPercent, 0),
    largestWin: winningTrades.length > 0 ? Math.max(...winningTrades.map((t) => t.realizedPnl)) : 0,
    largestLoss: losingTrades.length > 0 ? Math.min(...losingTrades.map((t) => t.realizedPnl)) : 0,
    consecutiveWins: maxConsecutiveWins,
    consecutiveLosses: maxConsecutiveLosses,
    avgHoldingPeriod,
  };
}

// ============================================================================
// Risk Metrics Calculation
// ============================================================================

/**
 * Calculate risk-adjusted performance metrics
 */
export function calculateRiskMetrics(): RiskMetrics {
  const trades = listTrades().filter((t) => t.status === "CLOSED");

  if (trades.length < 2) {
    return {
      sharpeRatio: null,
      sortinoRatio: null,
      maxDrawdown: 0,
      currentDrawdown: 0,
      volatility: null,
      riskAdjustedReturn: null,
    };
  }

  const returns = trades.map((t) => t.realizedPnlPercent / 100);
  const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;

  // Standard deviation of returns
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
  const stdDev = Math.sqrt(variance);

  // Downside deviation (for Sortino)
  const negativeReturns = returns.filter((r) => r < 0);
  const downsideVariance =
    negativeReturns.length > 0
      ? negativeReturns.reduce((sum, r) => sum + Math.pow(r, 2), 0) / negativeReturns.length
      : 0;
  const downsideDeviation = Math.sqrt(downsideVariance);

  // Risk-free rate assumption (annualized ~3%)
  const riskFreeRate = 0.03 / 365; // Daily

  // Sharpe Ratio (annualized)
  const sharpeRatio = stdDev > 0 ? ((avgReturn - riskFreeRate) / stdDev) * Math.sqrt(365) : null;

  // Sortino Ratio (annualized)
  const sortinoRatio =
    downsideDeviation > 0 ? ((avgReturn - riskFreeRate) / downsideDeviation) * Math.sqrt(365) : null;

  // Max Drawdown calculation
  let peak = 0;
  let maxDrawdown = 0;
  let runningPnl = 0;

  for (const trade of trades) {
    runningPnl += trade.realizedPnl;
    if (runningPnl > peak) {
      peak = runningPnl;
    }
    const drawdown = peak > 0 ? (peak - runningPnl) / peak : 0;
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
    }
  }

  // Current drawdown
  const currentDrawdown = peak > 0 ? (peak - runningPnl) / peak : 0;

  return {
    sharpeRatio,
    sortinoRatio,
    maxDrawdown,
    currentDrawdown,
    volatility: stdDev > 0 ? stdDev * Math.sqrt(365) : null, // Annualized
    riskAdjustedReturn: sharpeRatio,
  };
}

// ============================================================================
// Agent Metrics
// ============================================================================

/**
 * Record a request for metrics
 */
export function recordRequest(responseTimeMs: number, success: boolean): void {
  sessionMetrics.requests.push({
    timestamp: Date.now(),
    responseTimeMs,
    success,
  });

  // Keep only last 1000 requests
  if (sessionMetrics.requests.length > 1000) {
    sessionMetrics.requests.shift();
  }
}

/**
 * Record a tool call for metrics
 */
export function recordToolCall(tool: string, success: boolean): void {
  sessionMetrics.toolCalls.push({
    timestamp: Date.now(),
    tool,
    success,
  });

  // Keep only last 1000 tool calls
  if (sessionMetrics.toolCalls.length > 1000) {
    sessionMetrics.toolCalls.shift();
  }
}

/**
 * Record an error for metrics
 */
export function recordError(error: string): void {
  sessionMetrics.errors.push({
    timestamp: Date.now(),
    error,
  });
}

/**
 * Calculate agent metrics from session data
 */
export function calculateAgentMetrics(): AgentMetrics {
  const requests = sessionMetrics.requests;
  const toolCalls = sessionMetrics.toolCalls;
  const errors = sessionMetrics.errors;

  const successfulRequests = requests.filter((r) => r.success);
  const successfulToolCalls = toolCalls.filter((t) => t.success);

  return {
    totalRequests: requests.length,
    avgResponseTimeMs:
      requests.length > 0
        ? requests.reduce((sum, r) => sum + r.responseTimeMs, 0) / requests.length
        : 0,
    toolCallCount: toolCalls.length,
    toolSuccessRate: toolCalls.length > 0 ? successfulToolCalls.length / toolCalls.length : 1,
    networkRoutingCount: 0, // TODO: Track network routing
    errorCount: errors.length,
    errorRate: requests.length > 0 ? errors.length / requests.length : 0,
  };
}

// ============================================================================
// System Metrics
// ============================================================================

/**
 * Record an API call for metrics
 */
export function recordApiCall(endpoint: string, latencyMs: number): void {
  sessionMetrics.apiCalls.push({
    timestamp: Date.now(),
    endpoint,
    latencyMs,
  });

  // Keep only last 1000 API calls
  if (sessionMetrics.apiCalls.length > 1000) {
    sessionMetrics.apiCalls.shift();
  }
}

/**
 * Calculate system metrics
 */
export function calculateSystemMetrics(): SystemMetrics {
  const apiCalls = sessionMetrics.apiCalls;

  return {
    uptime: Date.now() - sessionMetrics.startTime,
    apiCallCount: apiCalls.length,
    avgApiLatencyMs:
      apiCalls.length > 0 ? apiCalls.reduce((sum, c) => sum + c.latencyMs, 0) / apiCalls.length : 0,
    rateLimitHits: 0, // TODO: Track from Binance client
    memoryUsageMb: process.memoryUsage().heapUsed / 1024 / 1024,
  };
}

// ============================================================================
// Aggregated Metrics
// ============================================================================

/**
 * Get all metrics in one call
 */
export function getAllMetrics(): GordonMetrics {
  return {
    trade: calculateTradeMetrics(),
    risk: calculateRiskMetrics(),
    agent: calculateAgentMetrics(),
    system: calculateSystemMetrics(),
    timestamp: new Date().toISOString(),
  };
}

/**
 * Format metrics for display
 */
export function formatMetricsReport(): string {
  const metrics = getAllMetrics();
  const lines: string[] = [];

  lines.push("═══════════════════════════════════════════");
  lines.push("           GORDON PERFORMANCE REPORT       ");
  lines.push("═══════════════════════════════════════════");
  lines.push("");

  // Trade Performance
  lines.push("📊 TRADE PERFORMANCE");
  lines.push("───────────────────────────────────────────");
  lines.push(`Total Trades: ${metrics.trade.totalTrades} (${metrics.trade.openTrades} open, ${metrics.trade.closedTrades} closed)`);
  lines.push(`Win Rate: ${(metrics.trade.winRate * 100).toFixed(1)}% (${metrics.trade.winningTrades}W / ${metrics.trade.losingTrades}L)`);
  lines.push(`Profit Factor: ${metrics.trade.profitFactor === Infinity ? "∞" : metrics.trade.profitFactor.toFixed(2)}`);
  lines.push(`Total P&L: $${metrics.trade.totalPnl.toFixed(2)} (${metrics.trade.totalPnlPercent.toFixed(2)}%)`);
  lines.push(`Avg Win: $${metrics.trade.avgWin.toFixed(2)} | Avg Loss: $${metrics.trade.avgLoss.toFixed(2)}`);
  lines.push(`Largest Win: $${metrics.trade.largestWin.toFixed(2)} | Largest Loss: $${metrics.trade.largestLoss.toFixed(2)}`);
  lines.push(`Max Consecutive: ${metrics.trade.consecutiveWins}W / ${metrics.trade.consecutiveLosses}L`);
  lines.push(`Avg Holding Period: ${metrics.trade.avgHoldingPeriod.toFixed(1)} hours`);
  lines.push("");

  // Risk Metrics
  lines.push("📈 RISK METRICS");
  lines.push("───────────────────────────────────────────");
  lines.push(`Sharpe Ratio: ${metrics.risk.sharpeRatio?.toFixed(2) ?? "N/A"}`);
  lines.push(`Sortino Ratio: ${metrics.risk.sortinoRatio?.toFixed(2) ?? "N/A"}`);
  lines.push(`Max Drawdown: ${(metrics.risk.maxDrawdown * 100).toFixed(1)}%`);
  lines.push(`Current Drawdown: ${(metrics.risk.currentDrawdown * 100).toFixed(1)}%`);
  lines.push(`Volatility (Ann.): ${metrics.risk.volatility ? (metrics.risk.volatility * 100).toFixed(1) + "%" : "N/A"}`);
  lines.push("");

  // Agent Metrics
  lines.push("🤖 AGENT PERFORMANCE");
  lines.push("───────────────────────────────────────────");
  lines.push(`Total Requests: ${metrics.agent.totalRequests}`);
  lines.push(`Avg Response Time: ${metrics.agent.avgResponseTimeMs.toFixed(0)}ms`);
  lines.push(`Tool Calls: ${metrics.agent.toolCallCount} (${(metrics.agent.toolSuccessRate * 100).toFixed(1)}% success)`);
  lines.push(`Error Rate: ${(metrics.agent.errorRate * 100).toFixed(1)}%`);
  lines.push("");

  // System Metrics
  lines.push("⚙️  SYSTEM HEALTH");
  lines.push("───────────────────────────────────────────");
  lines.push(`Uptime: ${formatUptime(metrics.system.uptime)}`);
  lines.push(`API Calls: ${metrics.system.apiCallCount}`);
  lines.push(`Avg API Latency: ${metrics.system.avgApiLatencyMs.toFixed(0)}ms`);
  lines.push(`Memory Usage: ${metrics.system.memoryUsageMb.toFixed(1)} MB`);
  lines.push("");

  lines.push("═══════════════════════════════════════════");
  lines.push(`Generated: ${metrics.timestamp}`);

  return lines.join("\n");
}

/**
 * Format uptime as human-readable string
 */
function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days}d ${hours % 24}h ${minutes % 60}m`;
  } else if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

// ============================================================================
// Reset Session Metrics
// ============================================================================

export function resetSessionMetrics(): void {
  sessionMetrics.startTime = Date.now();
  sessionMetrics.requests = [];
  sessionMetrics.toolCalls = [];
  sessionMetrics.apiCalls = [];
  sessionMetrics.errors = [];
}
