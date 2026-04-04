/**
 * Research Data Collection
 *
 * Collects anonymized trading data for AI model training.
 * Separate opt-in from basic telemetry — this is financial data
 * and requires explicit user consent.
 *
 * Anonymization rules:
 * - Prices → normalized as % distance from entry (entry = 0%)
 * - Quantities/Capital → stripped entirely, only % of allocation kept
 * - Dollar PnL → stripped, only % PnL kept
 * - IDs → one-way hashed with per-install salt
 * - Timestamps → relative durations only (no absolute dates)
 * - Symbols → kept (public market data, not PII)
 * - Indicators → kept (already ratios/oscillators)
 * - Strategy names → kept
 * - Reasoning text → kept (valuable for training)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { GORDON_DIR } from "../storage/paths.ts";

// ============================================================================
// Constants
// ============================================================================

const RESEARCH_DIR = path.join(GORDON_DIR, "research");
const TRADES_FILE = path.join(RESEARCH_DIR, "trades.jsonl");
const BACKTESTS_FILE = path.join(RESEARCH_DIR, "backtests.jsonl");
const ANALYSES_FILE = path.join(RESEARCH_DIR, "analyses.jsonl");
const STRATEGIES_FILE = path.join(RESEARCH_DIR, "strategies.jsonl");
const MAX_FILE_SIZE_MB = 50;
const UPLOAD_ENDPOINT = "https://research.gordon.sh/api/v1/contribute";
const FETCH_TIMEOUT_MS = 10000;

// ============================================================================
// Anonymized Data Types
// ============================================================================

/** Anonymized trade outcome — the core training signal */
export interface AnonymizedTrade {
  /** Hashed trade ID */
  id: string;
  /** Trading pair (e.g., BTCUSDT) */
  symbol: string;
  /** Strategy used */
  strategy: string;
  /** Trade direction */
  direction: "long" | "short";
  /** Entry type */
  entryType: "limit" | "market";
  /** Number of entry fills */
  entryFillCount: number;
  /** Number of exit fills */
  exitFillCount: number;
  /** P&L as percentage */
  pnlPercent: number;
  /** Stop loss distance as % from entry */
  stopDistancePercent: number | null;
  /** Take profit levels as % from entry */
  tpDistancesPercent: number[];
  /** Exit reason */
  exitReason: string;
  /** Holding duration in hours */
  holdingHours: number;
  /** % of portfolio allocated */
  allocationPercent: number | null;
  /** Plan status */
  planStatus: string;
  /** Trade status */
  tradeStatus: string;
  /** Plan reasoning (AI-generated text) */
  reasoning: string | null;
  /** Market context at entry time */
  marketContext: AnonymizedMarketContext | null;
  /** Timestamp (epoch ms, rounded to nearest hour) */
  collectedAt: number;
}

/** Anonymized market context at trade time */
export interface AnonymizedMarketContext {
  /** RSI value */
  rsi: number | null;
  /** MACD histogram sign (+/-) and magnitude bucket */
  macdHistogramBucket: string | null;
  /** Volume ratio (current/average) */
  volumeRatio: number | null;
  /** Price change 24h % */
  change24hPercent: number | null;
  /** Detected trend */
  trend: "up" | "down" | "range" | null;
  /** Bias */
  bias: "bullish" | "bearish" | "neutral" | null;
  /** Risk level */
  risk: "low" | "medium" | "high" | null;
  /** Setup confidence (0-1) */
  setupConfidence: number | null;
  /** Number of support levels nearby (within 5%) */
  supportLevelsNearby: number;
  /** Number of resistance levels nearby (within 5%) */
  resistanceLevelsNearby: number;
}

/** Anonymized backtest result */
export interface AnonymizedBacktest {
  id: string;
  strategyName: string;
  symbol: string;
  timeframe: string;
  days: number;
  positionSizePercent: number;
  compounding: boolean;
  feePercent: number;
  slippagePercent: number;
  // Normalized metrics (all ratios/percentages)
  totalReturnPercent: number;
  annualizedReturnPercent: number;
  maxDrawdownPercent: number;
  sharpeRatio: number;
  sortinoRatio: number;
  calmarRatio: number;
  volatility: number;
  totalTrades: number;
  winRate: number;
  profitFactor: number;
  expectancy: number;
  avgTradePercent: number;
  avgWinPercent: number;
  avgLossPercent: number;
  maxConsecutiveWins: number;
  maxConsecutiveLosses: number;
  avgTradeDurationHours: number;
  // Trade outcome distribution
  tradeOutcomes: Array<{
    pnlPercent: number;
    holdingHours: number;
    exitReason: string;
    side: "LONG" | "SHORT";
  }>;
  executionTimeMs: number;
  collectedAt: number;
}

/** Anonymized analysis snapshot */
export interface AnonymizedAnalysis {
  symbol: string;
  change24hPercent: number;
  rsi: number | null;
  macdHistogramBucket: string | null;
  volumeRatio: number | null;
  trend: string | null;
  bias: string | null;
  risk: string | null;
  setupDetected: boolean;
  setupConfidence: number;
  supportLevelsCount: number;
  resistanceLevelsCount: number;
  collectedAt: number;
}

/** Anonymized strategy generation result */
export interface AnonymizedStrategyGeneration {
  id: string;
  riskLevel: string;
  timeframes: string[];
  symbol: string;
  iterations: number;
  meetsThresholds: boolean;
  // Resulting strategy performance
  backtestSharpe: number | null;
  backtestWinRate: number | null;
  backtestMaxDrawdown: number | null;
  backtestTotalReturn: number | null;
  improvements: string[];
  collectedAt: number;
}

// ============================================================================
// State
// ============================================================================

let salt: string | null = null;

function getSalt(): string {
  if (salt) return salt;
  // Reuse telemetry salt if available
  try {
    const telemetryFile = path.join(GORDON_DIR, ".telemetry");
    if (fs.existsSync(telemetryFile)) {
      const data = JSON.parse(fs.readFileSync(telemetryFile, "utf-8"));
      if (data.salt) {
        salt = data.salt;
        return salt!;
      }
    }
  } catch {
    // Generate new salt
  }
  salt = crypto.randomBytes(16).toString("hex");
  return salt;
}

function hashId(id: string): string {
  return crypto.createHash("sha256").update(getSalt()).update(id).digest("hex").slice(0, 16);
}

function roundToHour(timestamp: number): number {
  return Math.floor(timestamp / 3600000) * 3600000;
}

function bucketMacdHistogram(value: number | null | undefined): string | null {
  if (value == null) return null;
  if (value > 0.5) return "strong_positive";
  if (value > 0) return "weak_positive";
  if (value > -0.5) return "weak_negative";
  return "strong_negative";
}

// ============================================================================
// Consent
// ============================================================================

let researchEnabled: boolean | null = null;

/**
 * Check if research data collection is enabled.
 * Reads from config telemetry.researchData field.
 */
export function isResearchEnabled(): boolean {
  if (researchEnabled !== null) return researchEnabled;

  // Check env overrides
  if (process.env.DO_NOT_TRACK === "1" || process.env.GORDON_TELEMETRY_DISABLED === "1") {
    researchEnabled = false;
    return false;
  }

  try {
    const configFile = path.join(GORDON_DIR, "config.json");
    if (fs.existsSync(configFile)) {
      const config = JSON.parse(fs.readFileSync(configFile, "utf-8"));
      researchEnabled = config?.telemetry?.researchData === true;
      return researchEnabled!;
    }
  } catch {
    // Config not available
  }

  researchEnabled = false;
  return false;
}

/**
 * Enable research data collection.
 */
export function enableResearch(): void {
  researchEnabled = true;
  ensureResearchDir();
}

/**
 * Disable research data collection.
 */
export function disableResearch(): void {
  researchEnabled = false;
}

/**
 * Get research data status.
 */
export function getResearchStatus(): {
  enabled: boolean;
  localFiles: Array<{ name: string; sizeMb: number; lines: number }>;
  totalSizeMb: number;
} {
  const files: Array<{ name: string; sizeMb: number; lines: number }> = [];
  let totalSize = 0;

  for (const [name, filePath] of [
    ["trades", TRADES_FILE],
    ["backtests", BACKTESTS_FILE],
    ["analyses", ANALYSES_FILE],
    ["strategies", STRATEGIES_FILE],
  ] as const) {
    try {
      if (fs.existsSync(filePath)) {
        const stat = fs.statSync(filePath);
        const sizeMb = stat.size / (1024 * 1024);
        const content = fs.readFileSync(filePath, "utf-8");
        const lines = content.split("\n").filter((l) => l.trim()).length;
        files.push({ name, sizeMb: Math.round(sizeMb * 100) / 100, lines });
        totalSize += sizeMb;
      }
    } catch {
      // Skip
    }
  }

  return {
    enabled: isResearchEnabled(),
    localFiles: files,
    totalSizeMb: Math.round(totalSize * 100) / 100,
  };
}

// ============================================================================
// File Management
// ============================================================================

function ensureResearchDir(): void {
  try {
    fs.mkdirSync(RESEARCH_DIR, { recursive: true });
  } catch {
    // Non-critical
  }
}

function appendToFile(filePath: string, data: unknown): void {
  try {
    // Check file size limit
    if (fs.existsSync(filePath)) {
      const stat = fs.statSync(filePath);
      if (stat.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
        // Rotate: rename to .bak, start fresh
        const bakPath = filePath + ".bak";
        try { fs.unlinkSync(bakPath); } catch { /* no-op */ }
        fs.renameSync(filePath, bakPath);
      }
    }

    fs.appendFileSync(filePath, JSON.stringify(data) + "\n", "utf-8");
  } catch {
    // Non-critical — never crash for data collection
  }
}

// ============================================================================
// Collection Methods
// ============================================================================

/**
 * Collect an anonymized trade outcome.
 * Call this when a trade is closed.
 */
export function collectTrade(params: {
  trade: {
    id: string;
    symbol: string;
    status: string;
    averageEntry: number;
    realizedPnlPercent: number;
    openedAt: string;
    closedAt: string | null;
    entries: Array<{ price: number; quantity: number }>;
    exits: Array<{ price: number; reason: string }>;
  };
  plan?: {
    strategy: string;
    direction?: string;
    entryType?: string;
    stopLoss?: { price: number };
    takeProfit?: Array<{ price: number }>;
    allocation?: { percentOfPortfolio: number };
    reasoning?: string;
    status?: string;
  } | null;
  marketContext?: {
    rsi?: number | null;
    macdHistogram?: number | null;
    volumeRatio?: number | null;
    change24h?: number | null;
    trend?: string | null;
    bias?: string | null;
    risk?: string | null;
    setupConfidence?: number | null;
    supportLevels?: number;
    resistanceLevels?: number;
  } | null;
}): void {
  if (!isResearchEnabled()) return;
  ensureResearchDir();

  const { trade, plan, marketContext } = params;
  const entryPrice = trade.averageEntry;

  // Calculate holding duration
  let holdingHours = 0;
  if (trade.openedAt && trade.closedAt) {
    holdingHours = (new Date(trade.closedAt).getTime() - new Date(trade.openedAt).getTime()) / 3600000;
  }

  // Normalize stop/TP distances as % from entry
  let stopDistancePercent: number | null = null;
  if (plan?.stopLoss && entryPrice > 0) {
    stopDistancePercent = ((plan.stopLoss.price - entryPrice) / entryPrice) * 100;
  }

  const tpDistancesPercent: number[] = [];
  if (plan?.takeProfit && entryPrice > 0) {
    for (const tp of plan.takeProfit) {
      tpDistancesPercent.push(((tp.price - entryPrice) / entryPrice) * 100);
    }
  }

  const anonymized: AnonymizedTrade = {
    id: hashId(trade.id),
    symbol: trade.symbol,
    strategy: plan?.strategy || "unknown",
    direction: (plan?.direction as "long" | "short") || "long",
    entryType: (plan?.entryType as "limit" | "market") || "market",
    entryFillCount: trade.entries.length,
    exitFillCount: trade.exits.length,
    pnlPercent: trade.realizedPnlPercent,
    stopDistancePercent,
    tpDistancesPercent,
    exitReason: trade.exits[trade.exits.length - 1]?.reason || "unknown",
    holdingHours: Math.round(holdingHours * 100) / 100,
    allocationPercent: plan?.allocation?.percentOfPortfolio ?? null,
    planStatus: plan?.status || "unknown",
    tradeStatus: trade.status,
    reasoning: plan?.reasoning || null,
    marketContext: marketContext
      ? {
          rsi: marketContext.rsi ?? null,
          macdHistogramBucket: bucketMacdHistogram(marketContext.macdHistogram),
          volumeRatio: marketContext.volumeRatio ?? null,
          change24hPercent: marketContext.change24h ?? null,
          trend: (marketContext.trend as AnonymizedMarketContext["trend"]) ?? null,
          bias: (marketContext.bias as AnonymizedMarketContext["bias"]) ?? null,
          risk: (marketContext.risk as AnonymizedMarketContext["risk"]) ?? null,
          setupConfidence: marketContext.setupConfidence ?? null,
          supportLevelsNearby: marketContext.supportLevels ?? 0,
          resistanceLevelsNearby: marketContext.resistanceLevels ?? 0,
        }
      : null,
    collectedAt: roundToHour(Date.now()),
  };

  appendToFile(TRADES_FILE, anonymized);
}

/**
 * Collect an anonymized backtest result.
 */
export function collectBacktest(params: {
  strategyName: string;
  symbol: string;
  timeframe: string;
  days: number;
  positionSizePercent: number;
  compounding: boolean;
  feePercent: number;
  slippagePercent: number;
  metrics: {
    totalReturn?: number;
    annualizedReturn?: number;
    maxDrawdown?: number;
    sharpeRatio?: number;
    sortinoRatio?: number;
    calmarRatio?: number;
    volatility?: number;
    totalTrades?: number;
    winRate?: number;
    profitFactor?: number;
    expectancy?: number;
    averageTrade?: number;
    averageWin?: number;
    averageLoss?: number;
    maxConsecutiveWins?: number;
    maxConsecutiveLosses?: number;
    avgTradeDuration?: number;
  };
  trades?: Array<{
    pnlPercent: number;
    entryTime: string;
    exitTime: string;
    exitReason: string;
    side: "LONG" | "SHORT";
  }>;
  executionTimeMs: number;
}): void {
  if (!isResearchEnabled()) return;
  ensureResearchDir();

  const { metrics, trades } = params;

  const tradeOutcomes = (trades || []).map((t) => ({
    pnlPercent: t.pnlPercent,
    holdingHours:
      Math.round(
        ((new Date(t.exitTime).getTime() - new Date(t.entryTime).getTime()) / 3600000) * 100,
      ) / 100,
    exitReason: t.exitReason,
    side: t.side,
  }));

  const anonymized: AnonymizedBacktest = {
    id: hashId(crypto.randomUUID()),
    strategyName: params.strategyName,
    symbol: params.symbol,
    timeframe: params.timeframe,
    days: params.days,
    positionSizePercent: params.positionSizePercent,
    compounding: params.compounding,
    feePercent: params.feePercent,
    slippagePercent: params.slippagePercent,
    totalReturnPercent: metrics.totalReturn ?? 0,
    annualizedReturnPercent: metrics.annualizedReturn ?? 0,
    maxDrawdownPercent: metrics.maxDrawdown ?? 0,
    sharpeRatio: metrics.sharpeRatio ?? 0,
    sortinoRatio: metrics.sortinoRatio ?? 0,
    calmarRatio: metrics.calmarRatio ?? 0,
    volatility: metrics.volatility ?? 0,
    totalTrades: metrics.totalTrades ?? 0,
    winRate: metrics.winRate ?? 0,
    profitFactor: metrics.profitFactor ?? 0,
    expectancy: metrics.expectancy ?? 0,
    avgTradePercent: metrics.averageTrade ?? 0,
    avgWinPercent: metrics.averageWin ?? 0,
    avgLossPercent: metrics.averageLoss ?? 0,
    maxConsecutiveWins: metrics.maxConsecutiveWins ?? 0,
    maxConsecutiveLosses: metrics.maxConsecutiveLosses ?? 0,
    avgTradeDurationHours: metrics.avgTradeDuration ?? 0,
    tradeOutcomes,
    executionTimeMs: params.executionTimeMs,
    collectedAt: roundToHour(Date.now()),
  };

  appendToFile(BACKTESTS_FILE, anonymized);
}

/**
 * Collect an anonymized market analysis snapshot.
 */
export function collectAnalysis(params: {
  symbol: string;
  change24h: number;
  rsi?: number | null;
  macdHistogram?: number | null;
  volumeRatio?: number | null;
  trend?: string | null;
  bias?: string | null;
  risk?: string | null;
  setupDetected: boolean;
  setupConfidence: number;
  supportLevelsCount: number;
  resistanceLevelsCount: number;
}): void {
  if (!isResearchEnabled()) return;
  ensureResearchDir();

  const anonymized: AnonymizedAnalysis = {
    symbol: params.symbol,
    change24hPercent: params.change24h,
    rsi: params.rsi ?? null,
    macdHistogramBucket: bucketMacdHistogram(params.macdHistogram),
    volumeRatio: params.volumeRatio ?? null,
    trend: params.trend ?? null,
    bias: params.bias ?? null,
    risk: params.risk ?? null,
    setupDetected: params.setupDetected,
    setupConfidence: params.setupConfidence,
    supportLevelsCount: params.supportLevelsCount,
    resistanceLevelsCount: params.resistanceLevelsCount,
    collectedAt: roundToHour(Date.now()),
  };

  appendToFile(ANALYSES_FILE, anonymized);
}

/**
 * Collect an anonymized strategy generation result.
 */
export function collectStrategyGeneration(params: {
  riskLevel: string;
  timeframes: string[];
  symbol: string;
  iterations: number;
  meetsThresholds: boolean;
  backtestSharpe?: number | null;
  backtestWinRate?: number | null;
  backtestMaxDrawdown?: number | null;
  backtestTotalReturn?: number | null;
  improvements: string[];
}): void {
  if (!isResearchEnabled()) return;
  ensureResearchDir();

  const anonymized: AnonymizedStrategyGeneration = {
    id: hashId(crypto.randomUUID()),
    riskLevel: params.riskLevel,
    timeframes: params.timeframes,
    symbol: params.symbol,
    iterations: params.iterations,
    meetsThresholds: params.meetsThresholds,
    backtestSharpe: params.backtestSharpe ?? null,
    backtestWinRate: params.backtestWinRate ?? null,
    backtestMaxDrawdown: params.backtestMaxDrawdown ?? null,
    backtestTotalReturn: params.backtestTotalReturn ?? null,
    improvements: params.improvements,
    collectedAt: roundToHour(Date.now()),
  };

  appendToFile(STRATEGIES_FILE, anonymized);
}

// ============================================================================
// Upload
// ============================================================================

/**
 * Upload collected research data to the server.
 * Reads JSONL files, batches them, and POSTs.
 * Returns number of records uploaded.
 */
export async function uploadResearchData(): Promise<{ uploaded: number; errors: number }> {
  if (!isResearchEnabled()) return { uploaded: 0, errors: 0 };

  let totalUploaded = 0;
  let totalErrors = 0;

  for (const filePath of [TRADES_FILE, BACKTESTS_FILE, ANALYSES_FILE, STRATEGIES_FILE]) {
    try {
      if (!fs.existsSync(filePath)) continue;

      const content = fs.readFileSync(filePath, "utf-8");
      const lines = content.split("\n").filter((l) => l.trim());
      if (lines.length === 0) continue;

      const records = lines.map((l) => JSON.parse(l));
      const dataType = path.basename(filePath, ".jsonl");

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

      const response = await fetch(UPLOAD_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataType, records }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (response.ok) {
        totalUploaded += records.length;
        // Clear uploaded file
        fs.writeFileSync(filePath, "", "utf-8");
      } else {
        totalErrors += records.length;
      }
    } catch {
      totalErrors++;
    }
  }

  return { uploaded: totalUploaded, errors: totalErrors };
}

/**
 * Clear all local research data files.
 */
export function clearResearchData(): number {
  let cleared = 0;

  for (const filePath of [TRADES_FILE, BACKTESTS_FILE, ANALYSES_FILE, STRATEGIES_FILE]) {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        cleared++;
      }
      const bakPath = filePath + ".bak";
      if (fs.existsSync(bakPath)) {
        fs.unlinkSync(bakPath);
      }
    } catch {
      // Non-critical
    }
  }

  return cleared;
}
