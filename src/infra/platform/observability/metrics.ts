/**
 * Metrics & Observability Module
 *
 * SOTA observability for Gordon:
 * - Trade performance metrics (Sharpe, Sortino, win rate)
 * - Agent quality metrics (response time, tool success rate)
 * - System health metrics (API latency, error rates)
 */

import { createModuleLogger } from "../../logger/index.ts";
import { listTrades } from "../../storage/entities/trades.ts";
import { listPlans } from "../../storage/entities/plans.ts";
import type { Trade, Plan } from "../../../types/index.ts";

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
// Per-Agent Metrics Types
// ============================================================================

/**
 * Metrics tracked per individual agent
 */
export interface PerAgentMetrics {
  agentName: string;
  totalCalls: number;
  successfulCalls: number;
  failedCalls: number;
  successRate: number;
  totalLatencyMs: number;
  avgLatencyMs: number;
  minLatencyMs: number;
  maxLatencyMs: number;
  totalTokens: number;
  avgTokensPerCall: number;
  errorTypes: Record<string, number>;
  recentErrors: Array<{ timestamp: number; errorType: string; message: string }>;
  lastCallTimestamp: number | null;
}

/**
 * Agent health report aggregating all agents
 */
export interface AgentHealthReport {
  timestamp: string;
  overallHealthScore: number; // 0-100
  totalAgentCalls: number;
  totalSuccessfulCalls: number;
  totalFailedCalls: number;
  overallSuccessRate: number;
  agents: Record<string, PerAgentMetrics>;
  unhealthyAgents: string[];
  recommendations: string[];
}

/**
 * Individual agent call record
 */
export interface AgentCallRecord {
  agentName: string;
  timestamp: number;
  durationMs: number;
  success: boolean;
  tokens: number;
  errorType?: string;
  errorMessage?: string;
}

// ============================================================================
// Rate Limiting Configuration
// ============================================================================

/**
 * Default per-tool-per-agent rate limit (calls/min). Overridable via
 * GORDON_TOOL_RATE_LIMIT; set it to 0 to disable rate limiting entirely.
 *
 * Raised from 10 → 60: a single market-status scan legitimately calls a tool
 * like quick_ta once per pair (15+ symbols), so 10/min throttled normal
 * analysis. The doom-loop detector (runtimeHarness) remains the real runaway
 * guard; this is a coarse secondary ceiling, not the primary safety control.
 */
const DEFAULT_RATE_LIMIT = (() => {
  const raw = process.env["GORDON_TOOL_RATE_LIMIT"];
  if (raw == null || raw === "") return 60;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 60;
})();
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute

/**
 * Per-agent-per-tool rate limit tracking
 * Key format: "agentName:toolName"
 */
const rateLimitTracker = new Map<string, number[]>();

/**
 * Rate limit result
 */
export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetInMs: number;
  error?: string;
}

// ============================================================================
// In-Memory Metrics Storage (for session)
// ============================================================================

const sessionMetrics = {
  startTime: Date.now(),
  requests: [] as { timestamp: number; responseTimeMs: number; success: boolean }[],
  toolCalls: [] as { timestamp: number; tool: string; success: boolean; agentName?: string }[],
  apiCalls: [] as { timestamp: number; latencyMs: number; endpoint: string }[],
  errors: [] as { timestamp: number; error: string }[],
  networkRoutings: [] as { timestamp: number; fromAgent: string; toAgent: string }[],
  // Per-agent tracking
  agentCalls: [] as AgentCallRecord[],
  // Rate limit violations
  rateLimitViolations: [] as { timestamp: number; agentName: string; toolName: string }[],
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
export function recordToolCall(tool: string, success: boolean, agentName?: string): void {
  sessionMetrics.toolCalls.push({
    timestamp: Date.now(),
    tool,
    success,
    agentName,
  });

  // Keep only last 1000 tool calls
  if (sessionMetrics.toolCalls.length > 1000) {
    sessionMetrics.toolCalls.shift();
  }
}

/**
 * Record an agent-network routing event (handoff between agents).
 */
export function recordNetworkRouting(fromAgent: string, toAgent: string): void {
  sessionMetrics.networkRoutings.push({
    timestamp: Date.now(),
    fromAgent,
    toAgent,
  });

  if (sessionMetrics.networkRoutings.length > 1000) {
    sessionMetrics.networkRoutings.shift();
  }
}

// ============================================================================
// Per-Agent-Per-Tool Rate Limiting
// ============================================================================

/**
 * Get the rate limit key for an agent and tool combination
 */
function getRateLimitKey(agentName: string, toolName: string): string {
  return `${agentName}:${toolName}`;
}

/**
 * Clean up old timestamps from rate limit tracker
 */
function cleanupRateLimitTracker(key: string): void {
  const timestamps = rateLimitTracker.get(key);
  if (!timestamps) return;

  const now = Date.now();
  const validTimestamps = timestamps.filter(ts => now - ts < RATE_LIMIT_WINDOW_MS);

  if (validTimestamps.length === 0) {
    rateLimitTracker.delete(key);
  } else {
    rateLimitTracker.set(key, validTimestamps);
  }
}

/**
 * Check if a tool call is allowed under the rate limit
 *
 * @param agentName - Name of the agent making the call
 * @param toolName - Name of the tool being called
 * @param limit - Maximum calls per minute (default: 10)
 * @returns RateLimitResult with allowed status and details
 */
export function checkRateLimit(
  agentName: string,
  toolName: string,
  limit: number = DEFAULT_RATE_LIMIT
): RateLimitResult {
  // limit <= 0 disables rate limiting (GORDON_TOOL_RATE_LIMIT=0).
  if (limit <= 0) {
    return { allowed: true, remaining: Number.POSITIVE_INFINITY, resetInMs: 0 };
  }

  const key = getRateLimitKey(agentName, toolName);
  const now = Date.now();

  // Clean up old timestamps
  cleanupRateLimitTracker(key);

  const timestamps = rateLimitTracker.get(key) || [];
  const remaining = limit - timestamps.length;

  if (remaining <= 0) {
    // Find when the oldest timestamp will expire
    const oldestTimestamp = timestamps[0] || now;
    const resetInMs = RATE_LIMIT_WINDOW_MS - (now - oldestTimestamp);

    // Record the violation
    sessionMetrics.rateLimitViolations.push({
      timestamp: now,
      agentName,
      toolName,
    });

    logger.warn("Rate limit exceeded", {
      agentName,
      toolName,
      limit,
      resetInMs,
    });

    return {
      allowed: false,
      remaining: 0,
      resetInMs: Math.max(0, resetInMs),
      error: `Rate limit exceeded for ${toolName}. Max ${limit} calls per minute. Try again in ${Math.ceil(resetInMs / 1000)}s.`,
    };
  }

  return {
    allowed: true,
    remaining: remaining - 1, // After this call
    resetInMs: timestamps.length > 0 ? RATE_LIMIT_WINDOW_MS - (now - timestamps[0]!) : RATE_LIMIT_WINDOW_MS,
  };
}

/**
 * Record a tool call for rate limiting
 * Call this AFTER checkRateLimit returns allowed: true
 *
 * @param agentName - Name of the agent making the call
 * @param toolName - Name of the tool being called
 */
export function recordRateLimitedCall(agentName: string, toolName: string): void {
  const key = getRateLimitKey(agentName, toolName);
  const timestamps = rateLimitTracker.get(key) || [];
  timestamps.push(Date.now());
  rateLimitTracker.set(key, timestamps);
}

/**
 * Check rate limit and record the call if allowed
 * Convenience function that combines check and record
 *
 * @param agentName - Name of the agent making the call
 * @param toolName - Name of the tool being called
 * @param limit - Maximum calls per minute (default: 10)
 * @returns RateLimitResult with allowed status and details
 */
export function enforceRateLimit(
  agentName: string,
  toolName: string,
  limit: number = DEFAULT_RATE_LIMIT
): RateLimitResult {
  const result = checkRateLimit(agentName, toolName, limit);

  if (result.allowed) {
    recordRateLimitedCall(agentName, toolName);
  }

  return result;
}

/**
 * Get current rate limit status for an agent/tool combination
 */
export function getRateLimitStatus(
  agentName: string,
  toolName: string,
  limit: number = DEFAULT_RATE_LIMIT
): {
  used: number;
  remaining: number;
  limit: number;
  resetInMs: number;
} {
  const key = getRateLimitKey(agentName, toolName);
  cleanupRateLimitTracker(key);

  const timestamps = rateLimitTracker.get(key) || [];
  const used = timestamps.length;
  const remaining = Math.max(0, limit - used);
  const resetInMs = timestamps.length > 0
    ? RATE_LIMIT_WINDOW_MS - (Date.now() - timestamps[0]!)
    : RATE_LIMIT_WINDOW_MS;

  return {
    used,
    remaining,
    limit,
    resetInMs: Math.max(0, resetInMs),
  };
}

/**
 * Reset rate limit for a specific agent/tool combination
 * Useful for testing or administrative override
 */
export function resetRateLimit(agentName: string, toolName: string): void {
  const key = getRateLimitKey(agentName, toolName);
  rateLimitTracker.delete(key);
  logger.debug("Rate limit reset", { agentName, toolName });
}

/**
 * Reset all rate limits
 */
export function resetAllRateLimits(): void {
  rateLimitTracker.clear();
  logger.debug("All rate limits reset");
}

/**
 * Get rate limit violations count
 */
export function getRateLimitViolations(options?: {
  agentName?: string;
  toolName?: string;
  sinceMs?: number;
}): number {
  const since = options?.sinceMs ? Date.now() - options.sinceMs : 0;

  return sessionMetrics.rateLimitViolations.filter(v => {
    if (v.timestamp < since) return false;
    if (options?.agentName && v.agentName !== options.agentName) return false;
    if (options?.toolName && v.toolName !== options.toolName) return false;
    return true;
  }).length;
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

// ============================================================================
// Per-Agent Metrics Recording & Reporting
// ============================================================================

/**
 * Record a call to a specific agent
 *
 * @param agentName - Name of the agent (e.g., "Analyst", "Scanner", "Backtester")
 * @param durationMs - Duration of the call in milliseconds
 * @param success - Whether the call succeeded
 * @param tokens - Number of tokens used
 * @param errorType - Optional error type if the call failed
 * @param errorMessage - Optional error message if the call failed
 */
export function recordAgentCall(
  agentName: string,
  durationMs: number,
  success: boolean,
  tokens: number,
  errorType?: string,
  errorMessage?: string
): void {
  const record: AgentCallRecord = {
    agentName,
    timestamp: Date.now(),
    durationMs,
    success,
    tokens,
    errorType,
    errorMessage,
  };

  sessionMetrics.agentCalls.push(record);

  // Keep only last 5000 agent calls to prevent memory bloat
  if (sessionMetrics.agentCalls.length > 5000) {
    sessionMetrics.agentCalls.shift();
  }

  logger.debug("Recorded agent call", {
    agentName,
    durationMs,
    success,
    tokens,
    errorType,
  });
}

/**
 * Get metrics for a specific agent
 */
export function getAgentMetrics(agentName: string): PerAgentMetrics {
  const agentCalls = sessionMetrics.agentCalls.filter(
    (call) => call.agentName === agentName
  );

  if (agentCalls.length === 0) {
    return {
      agentName,
      totalCalls: 0,
      successfulCalls: 0,
      failedCalls: 0,
      successRate: 1, // Default to 100% if no calls
      totalLatencyMs: 0,
      avgLatencyMs: 0,
      minLatencyMs: 0,
      maxLatencyMs: 0,
      totalTokens: 0,
      avgTokensPerCall: 0,
      errorTypes: {},
      recentErrors: [],
      lastCallTimestamp: null,
    };
  }

  const successfulCalls = agentCalls.filter((c) => c.success);
  const failedCalls = agentCalls.filter((c) => !c.success);

  const latencies = agentCalls.map((c) => c.durationMs);
  const totalLatencyMs = latencies.reduce((sum, l) => sum + l, 0);
  const totalTokens = agentCalls.reduce((sum, c) => sum + c.tokens, 0);

  // Count error types
  const errorTypes: Record<string, number> = {};
  for (const call of failedCalls) {
    const errType = call.errorType || "Unknown";
    errorTypes[errType] = (errorTypes[errType] || 0) + 1;
  }

  // Get recent errors (last 10)
  const recentErrors = failedCalls
    .slice(-10)
    .map((call) => ({
      timestamp: call.timestamp,
      errorType: call.errorType || "Unknown",
      message: call.errorMessage || "No message",
    }));

  return {
    agentName,
    totalCalls: agentCalls.length,
    successfulCalls: successfulCalls.length,
    failedCalls: failedCalls.length,
    successRate: agentCalls.length > 0 ? successfulCalls.length / agentCalls.length : 1,
    totalLatencyMs,
    avgLatencyMs: agentCalls.length > 0 ? totalLatencyMs / agentCalls.length : 0,
    minLatencyMs: Math.min(...latencies),
    maxLatencyMs: Math.max(...latencies),
    totalTokens,
    avgTokensPerCall: agentCalls.length > 0 ? totalTokens / agentCalls.length : 0,
    errorTypes,
    recentErrors,
    lastCallTimestamp: agentCalls[agentCalls.length - 1]?.timestamp || null,
  };
}

/**
 * Get a comprehensive health report for all agents
 */
export function getAgentHealthReport(): AgentHealthReport {
  const agentCalls = sessionMetrics.agentCalls;

  // Get unique agent names
  const agentNames = [...new Set(agentCalls.map((c) => c.agentName))];

  // Build per-agent metrics
  const agents: Record<string, PerAgentMetrics> = {};
  for (const agentName of agentNames) {
    agents[agentName] = getAgentMetrics(agentName);
  }

  // Calculate overall metrics
  const totalAgentCalls = agentCalls.length;
  const totalSuccessfulCalls = agentCalls.filter((c) => c.success).length;
  const totalFailedCalls = totalAgentCalls - totalSuccessfulCalls;
  const overallSuccessRate = totalAgentCalls > 0 ? totalSuccessfulCalls / totalAgentCalls : 1;

  // Identify unhealthy agents (success rate < 80% or very high latency)
  const unhealthyAgents: string[] = [];
  for (const [name, metrics] of Object.entries(agents)) {
    if (metrics.totalCalls >= 3 && metrics.successRate < 0.8) {
      unhealthyAgents.push(name);
    } else if (metrics.avgLatencyMs > 30000) { // > 30 seconds average
      unhealthyAgents.push(name);
    }
  }

  // Calculate overall health score (0-100)
  let healthScore = 100;
  // Penalize for low success rate
  healthScore -= (1 - overallSuccessRate) * 50;
  // Penalize for unhealthy agents
  healthScore -= unhealthyAgents.length * 10;
  // Clamp to 0-100
  healthScore = Math.max(0, Math.min(100, healthScore));

  // Generate recommendations
  const recommendations: string[] = [];
  if (unhealthyAgents.length > 0) {
    recommendations.push(
      `Investigate failing agents: ${unhealthyAgents.join(", ")}`
    );
  }
  if (overallSuccessRate < 0.9) {
    recommendations.push("Overall success rate is below 90%. Check for systematic issues.");
  }
  for (const [name, metrics] of Object.entries(agents)) {
    if (metrics.avgLatencyMs > 10000) {
      recommendations.push(`${name} has high latency (${(metrics.avgLatencyMs / 1000).toFixed(1)}s avg). Consider optimization.`);
    }
    const topError = Object.entries(metrics.errorTypes).sort(([, a], [, b]) => b - a)[0];
    if (topError && topError[1] >= 3) {
      recommendations.push(`${name} frequently fails with "${topError[0]}" (${topError[1]} times).`);
    }
  }

  return {
    timestamp: new Date().toISOString(),
    overallHealthScore: Math.round(healthScore),
    totalAgentCalls,
    totalSuccessfulCalls,
    totalFailedCalls,
    overallSuccessRate,
    agents,
    unhealthyAgents,
    recommendations,
  };
}

/**
 * Format agent health report for display
 */
export function formatAgentHealthReport(): string {
  const report = getAgentHealthReport();
  const lines: string[] = [];

  lines.push("═══════════════════════════════════════════");
  lines.push("           AGENT HEALTH REPORT             ");
  lines.push("═══════════════════════════════════════════");
  lines.push("");

  // Overall health
  const healthEmoji = report.overallHealthScore >= 90 ? "GREEN" :
                      report.overallHealthScore >= 70 ? "YELLOW" : "RED";
  lines.push(`Overall Health: ${report.overallHealthScore}/100 [${healthEmoji}]`);
  lines.push(`Total Calls: ${report.totalAgentCalls} (${report.totalSuccessfulCalls} OK, ${report.totalFailedCalls} FAILED)`);
  lines.push(`Success Rate: ${(report.overallSuccessRate * 100).toFixed(1)}%`);
  lines.push("");

  // Per-agent breakdown
  lines.push("AGENT BREAKDOWN");
  lines.push("───────────────────────────────────────────");

  for (const [agentName, metrics] of Object.entries(report.agents)) {
    const status = metrics.successRate >= 0.9 ? "OK" :
                   metrics.successRate >= 0.7 ? "WARN" : "FAIL";
    lines.push(`[${status}] ${agentName}`);
    lines.push(`    Calls: ${metrics.totalCalls} | Success: ${(metrics.successRate * 100).toFixed(1)}%`);
    lines.push(`    Latency: ${metrics.avgLatencyMs.toFixed(0)}ms avg (${metrics.minLatencyMs.toFixed(0)}-${metrics.maxLatencyMs.toFixed(0)}ms)`);
    lines.push(`    Tokens: ${metrics.totalTokens} total (${metrics.avgTokensPerCall.toFixed(0)} avg/call)`);
    if (Object.keys(metrics.errorTypes).length > 0) {
      const errStr = Object.entries(metrics.errorTypes)
        .map(([type, count]) => `${type}: ${count}`)
        .join(", ");
      lines.push(`    Errors: ${errStr}`);
    }
  }

  // Recommendations
  if (report.recommendations.length > 0) {
    lines.push("");
    lines.push("RECOMMENDATIONS");
    lines.push("───────────────────────────────────────────");
    for (const rec of report.recommendations) {
      lines.push(`  - ${rec}`);
    }
  }

  lines.push("");
  lines.push("═══════════════════════════════════════════");
  lines.push(`Generated: ${report.timestamp}`);

  return lines.join("\n");
}

/**
 * Calculate agent metrics from session data
 */
export function calculateAgentMetrics(): AgentMetrics {
  const requests = sessionMetrics.requests;
  const toolCalls = sessionMetrics.toolCalls;
  const errors = sessionMetrics.errors;
  const networkRoutings = sessionMetrics.networkRoutings;

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
    networkRoutingCount: networkRoutings.length,
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
  const rateLimitHits = sessionMetrics.rateLimitViolations.length;

  return {
    uptime: Date.now() - sessionMetrics.startTime,
    apiCallCount: apiCalls.length,
    avgApiLatencyMs:
      apiCalls.length > 0 ? apiCalls.reduce((sum, c) => sum + c.latencyMs, 0) / apiCalls.length : 0,
    rateLimitHits,
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
  sessionMetrics.networkRoutings = [];
  sessionMetrics.agentCalls = [];
  sessionMetrics.rateLimitViolations = [];
  resetAllRateLimits();
}
