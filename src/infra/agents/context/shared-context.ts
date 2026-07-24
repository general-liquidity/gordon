/**
 * Shared Agent Context
 * Enables memory sharing and context handoff between sub-agents
 *
 * This module provides:
 * - SharedAgentContext: A context object that persists across agent handoffs
 * - Tools for reading/writing shared context
 * - Integration with Mastra's RequestContext for seamless access
 * - TTL-based cleanup to prevent memory leaks
 * - Context versioning with author tracking
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

// ============================================================================
// Configuration Constants
// ============================================================================

/** Default TTL for context entries: 1 hour in milliseconds */
const DEFAULT_CONTEXT_TTL_MS = 60 * 60 * 1000;

/** Maximum entries per context type to prevent memory leaks */
const MAX_ENTRIES_PER_TYPE = 100;

/** Maximum versions to keep per symbol */
const MAX_VERSIONS_PER_SYMBOL = 3;

// ============================================================================
// Shared Context Types
// ============================================================================

/**
 * Versioned context entry wrapper
 * Tracks version number, author, and creation time for each context
 */
export interface VersionedEntry<T> {
  data: T;
  version: number;
  author: string;
  createdAt: number;
  expiresAt: number;
}

/**
 * Context history for a single symbol
 */
export interface ContextHistory<T> {
  current: VersionedEntry<T> | null;
  previous: VersionedEntry<T>[];
}

/**
 * Analysis context shared from Analyst agent
 */
export interface AnalysisContext {
  symbol: string;
  timestamp: number;
  technicalSignals?: {
    trend: "bullish" | "bearish" | "neutral";
    rsi: number;
    macd: { signal: "buy" | "sell" | "neutral"; histogram: number };
    momentum: number;
  };
  supportResistance?: {
    nearestSupport: number;
    nearestResistance: number;
    currentPrice: number;
  };
  whaleActivity?: {
    detected: boolean;
    netFlow: "accumulating" | "distributing" | "neutral";
    largeOrders: number;
  };
  orderbookImbalance?: {
    ratio: number;
    bias: "bullish" | "bearish" | "neutral";
  };
  overallBias: "bullish" | "bearish" | "neutral";
  confidence: number;
}

/**
 * Scanner context shared from Scanner agent
 */
export interface ScannerContext {
  timestamp: number;
  topOpportunities: Array<{
    symbol: string;
    strategy: string;
    confidence: number;
    setupType: string;
  }>;
  marketCondition: "trending" | "ranging" | "volatile";
  ensembleResults?: Array<{
    symbol: string;
    agreementPct: number;
    strategies: string[];
  }>;
}

/**
 * Backtest context shared from Backtester agent
 */
export interface BacktestContext {
  timestamp: number;
  lastBacktest?: {
    symbol: string;
    strategy: string;
    metrics: {
      totalReturn: number;
      sharpeRatio: number;
      maxDrawdown: number;
      winRate: number;
      tradeCount: number;
    };
    recommendation: "use" | "avoid" | "optimize";
  };
  optimizationResults?: {
    bestParams: Record<string, number>;
    improvement: number;
  };
}

/**
 * Planner context shared from Planner agent
 */
export interface PlannerContext {
  timestamp: number;
  activePlans: Array<{
    planId: string;
    symbol: string;
    direction: "long" | "short";
    entry: number;
    stopLoss: number;
    takeProfits: number[];
    riskRewardRatio: number;
    positionSizePct: number;
  }>;
}

/**
 * Monitor context shared from Monitor agent
 * Ground truth: what the user actually owns, real PnL, capital
 */
export interface MonitorContext {
  timestamp: number;
  portfolioValue: number;
  cashAvailable: number;
  totalExposurePercent: number;
  openPositions: Array<{
    symbol: string;
    side: "long" | "short";
    entryPrice: number;
    currentPrice: number;
    size: number;
    unrealizedPnl: number;
    unrealizedPnlPercent: number;
  }>;
  recentOutcomes: Array<{
    symbol: string;
    strategy: string;
    result: "win" | "loss" | "breakeven";
    pnlPercent: number;
    closedAt: number;
  }>;
}

/**
 * Complete shared context across all agents
 * Uses versioned entries with TTL for memory management
 */
export interface SharedAgentMemory {
  // Last analysis results by symbol (with version history)
  analyses: Map<string, ContextHistory<AnalysisContext>>;

  // Scanner's latest findings (versioned)
  scanner: VersionedEntry<ScannerContext> | null;

  // Backtest results cache (with version history)
  backtests: Map<string, ContextHistory<BacktestContext>>;

  // Active trading plans (versioned)
  planner: VersionedEntry<PlannerContext> | null;

  // Monitor ground truth: portfolio, positions, capital (versioned)
  monitor: VersionedEntry<MonitorContext> | null;

  // Session metadata
  session: {
    startTime: number;
    lastActivity: number;
    agentHistory: Array<{ agent: string; action: string; timestamp: number }>;
  };

  // Version counters per context type
  versionCounters: {
    analyses: Map<string, number>;
    scanner: number;
    backtests: Map<string, number>;
    planner: number;
    monitor: number;
  };
}

// ============================================================================
// Singleton Shared Memory Instance
// ============================================================================

let _sharedMemory: SharedAgentMemory | null = null;

/**
 * Get or create the shared agent memory instance
 */
export function getSharedMemory(): SharedAgentMemory {
  if (!_sharedMemory) {
    _sharedMemory = {
      analyses: new Map(),
      scanner: null,
      backtests: new Map(),
      planner: null,
      monitor: null,
      session: {
        startTime: Date.now(),
        lastActivity: Date.now(),
        agentHistory: [],
      },
      versionCounters: {
        analyses: new Map(),
        scanner: 0,
        backtests: new Map(),
        planner: 0,
        monitor: 0,
      },
    };
  }
  // Clean up expired entries on each access
  cleanupExpiredContexts();
  return _sharedMemory;
}

/**
 * Reset shared memory (useful for testing or session reset)
 */
export function resetSharedMemory(): void {
  _sharedMemory = null;
}

// ============================================================================
// TTL-Based Cleanup Functions
// ============================================================================

/**
 * Check if a versioned entry has expired
 */
function isExpired(entry: VersionedEntry<unknown>): boolean {
  return Date.now() > entry.expiresAt;
}

/**
 * Clean up expired contexts from all maps
 * Called automatically on each context access
 */
export function cleanupExpiredContexts(): void {
  if (!_sharedMemory) return;

  const now = Date.now();

  // Clean up expired analyses
  for (const [symbol, history] of _sharedMemory.analyses.entries()) {
    // Check current entry
    if (history.current && isExpired(history.current)) {
      history.current = null;
    }
    // Clean up expired previous versions
    history.previous = history.previous.filter((entry) => !isExpired(entry));

    // Remove entirely if both current and previous are empty
    if (!history.current && history.previous.length === 0) {
      _sharedMemory.analyses.delete(symbol);
    }
  }

  // Clean up scanner if expired
  if (_sharedMemory.scanner && isExpired(_sharedMemory.scanner)) {
    _sharedMemory.scanner = null;
  }

  // Clean up expired backtests
  for (const [symbol, history] of _sharedMemory.backtests.entries()) {
    if (history.current && isExpired(history.current)) {
      history.current = null;
    }
    history.previous = history.previous.filter((entry) => !isExpired(entry));

    if (!history.current && history.previous.length === 0) {
      _sharedMemory.backtests.delete(symbol);
    }
  }

  // Clean up planner if expired
  if (_sharedMemory.planner && isExpired(_sharedMemory.planner)) {
    _sharedMemory.planner = null;
  }

  // Clean up monitor if expired
  if (_sharedMemory.monitor && isExpired(_sharedMemory.monitor)) {
    _sharedMemory.monitor = null;
  }

  // Enforce max entries limit per type
  enforceMaxEntriesLimit(_sharedMemory.analyses);
  enforceMaxEntriesLimit(_sharedMemory.backtests);
}

/**
 * Enforce maximum entries limit for a context map
 * Removes oldest entries when limit is exceeded
 */
function enforceMaxEntriesLimit<T>(
  contextMap: Map<string, ContextHistory<T>>
): void {
  if (contextMap.size <= MAX_ENTRIES_PER_TYPE) return;

  // Get entries sorted by most recent activity (current entry timestamp)
  const entries = Array.from(contextMap.entries())
    .map(([key, history]) => ({
      key,
      timestamp: history.current?.createdAt ?? 0,
    }))
    .sort((a, b) => a.timestamp - b.timestamp);

  // Remove oldest entries until we're under the limit
  const toRemove = entries.slice(0, contextMap.size - MAX_ENTRIES_PER_TYPE);
  for (const { key } of toRemove) {
    contextMap.delete(key);
  }
}

/**
 * Create a versioned entry with TTL
 */
function createVersionedEntry<T>(
  data: T,
  author: string,
  version: number,
  ttlMs: number = DEFAULT_CONTEXT_TTL_MS
): VersionedEntry<T> {
  const now = Date.now();
  return {
    data,
    version,
    author,
    createdAt: now,
    expiresAt: now + ttlMs,
  };
}

/**
 * Get the next version number for a context type
 */
function getNextVersion(
  memory: SharedAgentMemory,
  type: "analyses" | "backtests",
  symbol: string
): number;
function getNextVersion(
  memory: SharedAgentMemory,
  type: "scanner" | "planner" | "monitor"
): number;
function getNextVersion(
  memory: SharedAgentMemory,
  type: "analyses" | "backtests" | "scanner" | "planner" | "monitor",
  symbol?: string
): number {
  if (type === "analyses" || type === "backtests") {
    const counter = memory.versionCounters[type];
    const current = counter.get(symbol!) || 0;
    counter.set(symbol!, current + 1);
    return current + 1;
  } else {
    memory.versionCounters[type]++;
    return memory.versionCounters[type];
  }
}

// ============================================================================
// Context Access Functions
// ============================================================================

/**
 * Store analysis context from Analyst agent
 * Creates a versioned entry and maintains history
 */
export function storeAnalysisContext(
  context: AnalysisContext,
  author: string = "Analyst"
): void {
  const memory = getSharedMemory();
  const symbol = context.symbol;

  // Get or create history for this symbol
  let history = memory.analyses.get(symbol);
  if (!history) {
    history = { current: null, previous: [] };
    memory.analyses.set(symbol, history);
  }

  // Move current to previous (maintain version history)
  if (history.current) {
    history.previous.unshift(history.current);
    // Keep only MAX_VERSIONS_PER_SYMBOL - 1 previous versions
    history.previous = history.previous.slice(0, MAX_VERSIONS_PER_SYMBOL - 1);
  }

  // Create new versioned entry
  const version = getNextVersion(memory, "analyses", symbol);
  history.current = createVersionedEntry(context, author, version);

  memory.session.lastActivity = Date.now();
  memory.session.agentHistory.push({
    agent: author,
    action: `Analyzed ${symbol} (v${version})`,
    timestamp: Date.now(),
  });
}

/**
 * Retrieve analysis context for a symbol
 */
export function getAnalysisContext(symbol: string): AnalysisContext | null {
  const memory = getSharedMemory();
  const history = memory.analyses.get(symbol);
  if (!history?.current || isExpired(history.current)) {
    return null;
  }
  return history.current.data;
}

/**
 * Get the versioned entry for analysis context (includes metadata)
 */
export function getAnalysisContextVersioned(
  symbol: string
): VersionedEntry<AnalysisContext> | null {
  const memory = getSharedMemory();
  const history = memory.analyses.get(symbol);
  if (!history?.current || isExpired(history.current)) {
    return null;
  }
  return history.current;
}

/**
 * Get context history for a symbol (current + previous versions)
 */
export function getContextHistory<T extends "analysis" | "backtest">(
  type: T,
  symbol: string
): ContextHistory<T extends "analysis" ? AnalysisContext : BacktestContext> | null {
  const memory = getSharedMemory();

  if (type === "analysis") {
    const history = memory.analyses.get(symbol);
    if (!history) return null;
    return history as ContextHistory<T extends "analysis" ? AnalysisContext : BacktestContext>;
  } else {
    const history = memory.backtests.get(symbol);
    if (!history) return null;
    return history as ContextHistory<T extends "analysis" ? AnalysisContext : BacktestContext>;
  }
}

/**
 * Check if we have recent analysis (within TTL)
 */
export function hasRecentAnalysis(
  symbol: string,
  maxAgeMs: number = 5 * 60 * 1000
): boolean {
  const context = getAnalysisContext(symbol);
  if (!context) return false;
  return Date.now() - context.timestamp < maxAgeMs;
}

/**
 * Store scanner context
 */
export function storeScannerContext(
  context: ScannerContext,
  author: string = "Scanner"
): void {
  const memory = getSharedMemory();
  const version = getNextVersion(memory, "scanner");
  memory.scanner = createVersionedEntry(context, author, version);
  memory.session.lastActivity = Date.now();
  memory.session.agentHistory.push({
    agent: author,
    action: `Found ${context.topOpportunities.length} opportunities (v${version})`,
    timestamp: Date.now(),
  });
}

/**
 * Get scanner context
 */
export function getScannerContext(): ScannerContext | null {
  const memory = getSharedMemory();
  if (!memory.scanner || isExpired(memory.scanner)) {
    return null;
  }
  return memory.scanner.data;
}

/**
 * Get versioned scanner context (includes metadata)
 */
export function getScannerContextVersioned(): VersionedEntry<ScannerContext> | null {
  const memory = getSharedMemory();
  if (!memory.scanner || isExpired(memory.scanner)) {
    return null;
  }
  return memory.scanner;
}

/**
 * Store backtest context
 */
export function storeBacktestContext(
  symbol: string,
  context: BacktestContext,
  author: string = "Backtester"
): void {
  const memory = getSharedMemory();

  // Get or create history for this symbol
  let history = memory.backtests.get(symbol);
  if (!history) {
    history = { current: null, previous: [] };
    memory.backtests.set(symbol, history);
  }

  // Move current to previous (maintain version history)
  if (history.current) {
    history.previous.unshift(history.current);
    history.previous = history.previous.slice(0, MAX_VERSIONS_PER_SYMBOL - 1);
  }

  // Create new versioned entry
  const version = getNextVersion(memory, "backtests", symbol);
  history.current = createVersionedEntry(context, author, version);

  memory.session.lastActivity = Date.now();
  memory.session.agentHistory.push({
    agent: author,
    action: `Backtested ${symbol} (v${version})`,
    timestamp: Date.now(),
  });
}

/**
 * Get backtest context for a symbol
 */
export function getBacktestContext(symbol: string): BacktestContext | null {
  const memory = getSharedMemory();
  const history = memory.backtests.get(symbol);
  if (!history?.current || isExpired(history.current)) {
    return null;
  }
  return history.current.data;
}

/**
 * Get versioned backtest context (includes metadata)
 */
export function getBacktestContextVersioned(
  symbol: string
): VersionedEntry<BacktestContext> | null {
  const memory = getSharedMemory();
  const history = memory.backtests.get(symbol);
  if (!history?.current || isExpired(history.current)) {
    return null;
  }
  return history.current;
}

/**
 * Store planner context
 */
export function storePlannerContext(
  context: PlannerContext,
  author: string = "Planner"
): void {
  const memory = getSharedMemory();
  const version = getNextVersion(memory, "planner");
  memory.planner = createVersionedEntry(context, author, version);
  memory.session.lastActivity = Date.now();
  memory.session.agentHistory.push({
    agent: author,
    action: `Created ${context.activePlans.length} plans (v${version})`,
    timestamp: Date.now(),
  });
}

/**
 * Get planner context
 */
export function getPlannerContext(): PlannerContext | null {
  const memory = getSharedMemory();
  if (!memory.planner || isExpired(memory.planner)) {
    return null;
  }
  return memory.planner.data;
}

/**
 * Get versioned planner context (includes metadata)
 */
export function getPlannerContextVersioned(): VersionedEntry<PlannerContext> | null {
  const memory = getSharedMemory();
  if (!memory.planner || isExpired(memory.planner)) {
    return null;
  }
  return memory.planner;
}

/**
 * Store monitor context (portfolio ground truth)
 */
export function storeMonitorContext(
  context: MonitorContext,
  author: string = "Monitor"
): void {
  const memory = getSharedMemory();
  const version = getNextVersion(memory, "monitor");
  memory.monitor = createVersionedEntry(context, author, version);
  memory.session.lastActivity = Date.now();
  memory.session.agentHistory.push({
    agent: author,
    action: `Portfolio snapshot: $${context.portfolioValue.toFixed(2)}, ${context.openPositions.length} positions (v${version})`,
    timestamp: Date.now(),
  });
}

/**
 * Get monitor context
 */
export function getMonitorContext(): MonitorContext | null {
  const memory = getSharedMemory();
  if (!memory.monitor || isExpired(memory.monitor)) {
    return null;
  }
  return memory.monitor.data;
}

/**
 * Get versioned monitor context (includes metadata)
 */
export function getMonitorContextVersioned(): VersionedEntry<MonitorContext> | null {
  const memory = getSharedMemory();
  if (!memory.monitor || isExpired(memory.monitor)) {
    return null;
  }
  return memory.monitor;
}

/**
 * Get session summary for context injection
 */
export function getSessionSummary(): string {
  const memory = getSharedMemory();
  const parts: string[] = [];

  // Recent analyses (using versioned entries)
  if (memory.analyses.size > 0) {
    const recentAnalyses = Array.from(memory.analyses.entries())
      .filter(([_, history]) => {
        const ctx = history.current;
        return ctx && !isExpired(ctx) && Date.now() - ctx.data.timestamp < 10 * 60 * 1000;
      })
      .map(([symbol, history]) => {
        const ctx = history.current!.data;
        return `${symbol}: ${ctx.overallBias} (${Math.round(ctx.confidence * 100)}% confidence, v${history.current!.version})`;
      });

    if (recentAnalyses.length > 0) {
      parts.push(`Recent Analyses: ${recentAnalyses.join(", ")}`);
    }
  }

  // Scanner findings (using versioned entry)
  if (memory.scanner && !isExpired(memory.scanner)) {
    const ctx = memory.scanner.data;
    if (Date.now() - ctx.timestamp < 10 * 60 * 1000) {
      const topOps = ctx.topOpportunities
        .slice(0, 3)
        .map((o) => `${o.symbol} (${o.strategy})`)
        .join(", ");
      parts.push(`Scanner: ${topOps || "No opportunities"} (v${memory.scanner.version})`);
    }
  }

  // Backtest results (using versioned entries)
  if (memory.backtests.size > 0) {
    const recentBacktests = Array.from(memory.backtests.entries())
      .filter(([_, history]) => {
        const ctx = history.current;
        return (
          ctx &&
          !isExpired(ctx) &&
          ctx.data.lastBacktest &&
          Date.now() - ctx.data.timestamp < 30 * 60 * 1000
        );
      })
      .map(([symbol, history]) => {
        const ctx = history.current!.data;
        const bt = ctx.lastBacktest!;
        return `${symbol}/${bt.strategy}: ${bt.recommendation} (${(bt.metrics.totalReturn * 100).toFixed(1)}% return, v${history.current!.version})`;
      });

    if (recentBacktests.length > 0) {
      parts.push(`Backtests: ${recentBacktests.join(", ")}`);
    }
  }

  // Active plans (using versioned entry)
  if (memory.planner && !isExpired(memory.planner)) {
    const ctx = memory.planner.data;
    if (ctx.activePlans.length > 0) {
      const plans = ctx.activePlans
        .slice(0, 3)
        .map((p) => `${p.symbol} ${p.direction} @ ${p.entry}`)
        .join(", ");
      parts.push(`Active Plans: ${plans} (v${memory.planner.version})`);
    }
  }

  // Monitor portfolio snapshot (using versioned entry)
  if (memory.monitor && !isExpired(memory.monitor)) {
    const ctx = memory.monitor.data;
    const posCount = ctx.openPositions.length;
    const totalPnl = ctx.openPositions.reduce((sum, p) => sum + p.unrealizedPnl, 0);
    parts.push(
      `Portfolio: $${ctx.portfolioValue.toFixed(0)} | ${posCount} positions | ` +
      `${totalPnl >= 0 ? "+" : ""}$${totalPnl.toFixed(2)} unrealized | ` +
      `${ctx.totalExposurePercent.toFixed(1)}% exposure (v${memory.monitor.version})`
    );
  }

  return parts.length > 0
    ? `\n## Cross-Agent Context\n${parts.join("\n")}`
    : "";
}

/**
 * Get memory statistics for monitoring
 */
export function getMemoryStats(): {
  analysesCount: number;
  backtestsCount: number;
  hasScanner: boolean;
  hasPlanner: boolean;
  hasMonitor: boolean;
  totalVersions: number;
  oldestEntry: number | null;
} {
  const memory = getSharedMemory();

  let totalVersions = 0;
  let oldestEntry: number | null = null;

  // Count analyses versions
  for (const history of memory.analyses.values()) {
    if (history.current) {
      totalVersions++;
      if (oldestEntry === null || history.current.createdAt < oldestEntry) {
        oldestEntry = history.current.createdAt;
      }
    }
    totalVersions += history.previous.length;
  }

  // Count backtest versions
  for (const history of memory.backtests.values()) {
    if (history.current) {
      totalVersions++;
      if (oldestEntry === null || history.current.createdAt < oldestEntry) {
        oldestEntry = history.current.createdAt;
      }
    }
    totalVersions += history.previous.length;
  }

  // Count scanner and planner
  if (memory.scanner) {
    totalVersions++;
    if (oldestEntry === null || memory.scanner.createdAt < oldestEntry) {
      oldestEntry = memory.scanner.createdAt;
    }
  }
  if (memory.planner) {
    totalVersions++;
    if (oldestEntry === null || memory.planner.createdAt < oldestEntry) {
      oldestEntry = memory.planner.createdAt;
    }
  }
  if (memory.monitor) {
    totalVersions++;
    if (oldestEntry === null || memory.monitor.createdAt < oldestEntry) {
      oldestEntry = memory.monitor.createdAt;
    }
  }

  return {
    analysesCount: memory.analyses.size,
    backtestsCount: memory.backtests.size,
    hasScanner: memory.scanner !== null && !isExpired(memory.scanner),
    hasPlanner: memory.planner !== null && !isExpired(memory.planner),
    hasMonitor: memory.monitor !== null && !isExpired(memory.monitor),
    totalVersions,
    oldestEntry,
  };
}

// ============================================================================
// Shared Context Tools (for agent use)
// ============================================================================

/**
 * Tool for agents to read shared context from other agents
 */
type SharedContextReadResult = {
  found: boolean;
  context?: unknown;
  summary: string;
  age?: number;
  version?: number;
  author?: string;
  history?: unknown[];
};

export const readSharedContextTool = createTool({
  id: "read_shared_context",
  description:
    "Read context shared by other agents. Use this to get previous analysis, " +
    "scanner findings, or backtest results before starting your work. " +
    "Helps avoid redundant work and provides context from other specialists. " +
    "Use includeHistory=true to retrieve previous versions.",
  inputSchema: z.object({
    contextType: z
      .enum(["analysis", "scanner", "backtest", "planner", "monitor", "all", "history"])
      .describe("contextType: which agent's context to read — 'analysis', 'scanner', 'backtest', 'planner', 'monitor', 'all', or 'history'. Use 'monitor' for portfolio ground truth."),
    symbol: z
      .string()
      .optional()
      .describe("Symbol to get context for (required for analysis/backtest/history)"),
    includeHistory: z
      .boolean()
      .optional()
      .default(false)
      .describe("Include previous versions in the response"),
  }),
  outputSchema: z.object({
    found: z.boolean(),
    context: z.any().optional(),
    summary: z.string(),
    age: z.number().optional().describe("Age of context in seconds"),
    version: z.number().optional().describe("Version number of the context"),
    author: z.string().optional().describe("Agent that created this context"),
    history: z.array(z.any()).optional().describe("Previous versions if requested"),
  }),
  execute: async (input) => {
    const memory = getSharedMemory();

    switch (input.contextType) {
      case "analysis": {
        if (!input.symbol) {
          return { found: false, summary: "Symbol required for analysis context" };
        }
        const versioned = getAnalysisContextVersioned(input.symbol);
        if (!versioned) {
          return { found: false, summary: `No analysis found for ${input.symbol}` };
        }
        const ctx = versioned.data;
        const result: SharedContextReadResult = {
          found: true,
          context: ctx,
          summary: `${input.symbol}: ${ctx.overallBias} bias with ${Math.round(ctx.confidence * 100)}% confidence`,
          age: Math.round((Date.now() - ctx.timestamp) / 1000),
          version: versioned.version,
          author: versioned.author,
        };

        if (input.includeHistory) {
          const historyData = getContextHistory("analysis", input.symbol);
          if (historyData) {
            result.history = historyData.previous.map((v) => ({
              data: v.data,
              version: v.version,
              author: v.author,
              age: Math.round((Date.now() - v.createdAt) / 1000),
            }));
          }
        }
        return result;
      }

      case "scanner": {
        const versioned = getScannerContextVersioned();
        if (!versioned) {
          return { found: false, summary: "No scanner context available" };
        }
        const ctx = versioned.data;
        return {
          found: true,
          context: ctx,
          summary: `Found ${ctx.topOpportunities.length} opportunities, market is ${ctx.marketCondition}`,
          age: Math.round((Date.now() - ctx.timestamp) / 1000),
          version: versioned.version,
          author: versioned.author,
        };
      }

      case "backtest": {
        if (!input.symbol) {
          return { found: false, summary: "Symbol required for backtest context" };
        }
        const versioned = getBacktestContextVersioned(input.symbol);
        if (!versioned || !versioned.data.lastBacktest) {
          return { found: false, summary: `No backtest results for ${input.symbol}` };
        }
        const ctx = versioned.data;
        const bt = ctx.lastBacktest;
        if (!bt) {
          return { found: false, summary: "No backtest data in context" };
        }
        const result: SharedContextReadResult = {
          found: true,
          context: ctx,
          summary:
            `${bt.strategy} on ${input.symbol}: ${(bt.metrics.totalReturn * 100).toFixed(1)}% return, ` +
            `${(bt.metrics.winRate * 100).toFixed(0)}% win rate, recommendation: ${bt.recommendation}`,
          age: Math.round((Date.now() - ctx.timestamp) / 1000),
          version: versioned.version,
          author: versioned.author,
        };

        if (input.includeHistory) {
          const historyData = getContextHistory("backtest", input.symbol);
          if (historyData) {
            result.history = historyData.previous.map((v) => ({
              data: v.data,
              version: v.version,
              author: v.author,
              age: Math.round((Date.now() - v.createdAt) / 1000),
            }));
          }
        }
        return result;
      }

      case "planner": {
        const versioned = getPlannerContextVersioned();
        if (!versioned || versioned.data.activePlans.length === 0) {
          return { found: false, summary: "No active plans" };
        }
        const ctx = versioned.data;
        return {
          found: true,
          context: ctx,
          summary: `${ctx.activePlans.length} active plans`,
          age: Math.round((Date.now() - ctx.timestamp) / 1000),
          version: versioned.version,
          author: versioned.author,
        };
      }

      case "monitor": {
        const versioned = getMonitorContextVersioned();
        if (!versioned) {
          return { found: false, summary: "No portfolio snapshot available" };
        }
        const ctx = versioned.data;
        const totalPnl = ctx.openPositions.reduce((sum, p) => sum + p.unrealizedPnl, 0);
        return {
          found: true,
          context: ctx,
          summary:
            `Portfolio: $${ctx.portfolioValue.toFixed(2)} | ` +
            `${ctx.openPositions.length} positions | ` +
            `${totalPnl >= 0 ? "+" : ""}$${totalPnl.toFixed(2)} unrealized PnL | ` +
            `$${ctx.cashAvailable.toFixed(2)} cash | ` +
            `${ctx.totalExposurePercent.toFixed(1)}% exposure`,
          age: Math.round((Date.now() - ctx.timestamp) / 1000),
          version: versioned.version,
          author: versioned.author,
        };
      }

      case "history": {
        if (!input.symbol) {
          return { found: false, summary: "Symbol required for history lookup" };
        }
        // Try analysis first, then backtest
        const analysisHistory = getContextHistory("analysis", input.symbol);
        const backtestHistory = getContextHistory("backtest", input.symbol);

        const historyItems: Array<{
          type: string;
          data: unknown;
          version: number;
          author: string;
          age: number;
        }> = [];

        if (analysisHistory?.current) {
          historyItems.push({
            type: "analysis",
            data: analysisHistory.current.data,
            version: analysisHistory.current.version,
            author: analysisHistory.current.author,
            age: Math.round((Date.now() - analysisHistory.current.createdAt) / 1000),
          });
          for (const prev of analysisHistory.previous) {
            historyItems.push({
              type: "analysis",
              data: prev.data,
              version: prev.version,
              author: prev.author,
              age: Math.round((Date.now() - prev.createdAt) / 1000),
            });
          }
        }

        if (backtestHistory?.current) {
          historyItems.push({
            type: "backtest",
            data: backtestHistory.current.data,
            version: backtestHistory.current.version,
            author: backtestHistory.current.author,
            age: Math.round((Date.now() - backtestHistory.current.createdAt) / 1000),
          });
          for (const prev of backtestHistory.previous) {
            historyItems.push({
              type: "backtest",
              data: prev.data,
              version: prev.version,
              author: prev.author,
              age: Math.round((Date.now() - prev.createdAt) / 1000),
            });
          }
        }

        if (historyItems.length === 0) {
          return { found: false, summary: `No context history for ${input.symbol}` };
        }

        return {
          found: true,
          context: historyItems,
          summary: `Found ${historyItems.length} context entries for ${input.symbol}`,
          history: historyItems,
        };
      }

      case "all": {
        const summary = getSessionSummary();
        const stats = getMemoryStats();
        return {
          found: summary.length > 0,
          context: {
            analysisCount: stats.analysesCount,
            hasScanner: stats.hasScanner,
            backtestCount: stats.backtestsCount,
            hasPlanner: stats.hasPlanner,
            hasMonitor: stats.hasMonitor,
            totalVersions: stats.totalVersions,
            history: memory.session.agentHistory.slice(-10),
          },
          summary: summary || "No shared context available",
        };
      }

      default:
        return { found: false, summary: "Unknown context type" };
    }
  },
});

/**
 * Tool for agents to write their results to shared context
 */
export const writeSharedContextTool = createTool({
  id: "write_shared_context",
  description:
    "Write your analysis/results to shared context for other agents to use. " +
    "Call this after completing significant work so other agents can benefit.",
  inputSchema: z.object({
    contextType: z.enum(["analysis", "scanner", "backtest", "planner", "monitor"]),
    symbol: z.string().optional(),
    data: z.record(z.string(), z.any()).describe("Context data to store"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),
  execute: async (input) => {
    try {
      switch (input.contextType) {
        case "analysis":
          if (!input.symbol) {
            return { success: false, message: "Symbol required for analysis context" };
          }
          storeAnalysisContext({
            symbol: input.symbol,
            timestamp: Date.now(),
            ...input.data,
          } as AnalysisContext);
          return { success: true, message: `Stored analysis for ${input.symbol}` };

        case "scanner":
          storeScannerContext({
            timestamp: Date.now(),
            ...input.data,
          } as ScannerContext);
          return { success: true, message: "Stored scanner context" };

        case "backtest":
          if (!input.symbol) {
            return { success: false, message: "Symbol required for backtest context" };
          }
          storeBacktestContext(input.symbol, {
            timestamp: Date.now(),
            ...input.data,
          } as BacktestContext);
          return { success: true, message: `Stored backtest for ${input.symbol}` };

        case "planner":
          storePlannerContext({
            timestamp: Date.now(),
            ...input.data,
          } as PlannerContext);
          return { success: true, message: "Stored planner context" };

        case "monitor":
          storeMonitorContext({
            timestamp: Date.now(),
            ...input.data,
          } as MonitorContext);
          return { success: true, message: "Stored monitor context (portfolio snapshot)" };

        default:
          return { success: false, message: "Unknown context type" };
      }
    } catch (err) {
      return {
        success: false,
        message: `Failed to store context: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
});

/**
 * Combined shared context tools for easy import
 */
export const sharedContextTools = {
  read_shared_context: readSharedContextTool,
  write_shared_context: writeSharedContextTool,
};
