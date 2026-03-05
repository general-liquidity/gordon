/**
 * Agent Types
 * Shared types for Gordon's agent infrastructure
 */

import type { BinanceClient } from "../binance/index.ts";
import type { Exchange } from "../exchange/index.ts";
import type { BrokerAdapter } from "../broker/index.ts";
import type { LLMClient } from "../llm/index.ts";
import type { GordonConfig, Plan, Trade } from "../../types/index.ts";

/**
 * Context passed to all tools and agents
 */
export interface GordonContext {
  /**
   * @deprecated Use `exchange` instead for multi-exchange support
   */
  binance: BinanceClient | null;
  /**
   * Abstract exchange interface - supports multiple exchanges
   * Prefer using this over `binance` for forward compatibility
   */
  exchange: Exchange | null;
  /**
   * Abstract stock/options broker interface (Alpaca first)
   */
  broker?: BrokerAdapter | null;
  llm: LLMClient;
  config: GordonConfig;
  portfolioValue: number;
  availableCash: number;
  /** User ID for Mastra memory tracking */
  userId?: string;
  /** Thread ID for conversation persistence */
  threadId?: string;
}

/**
 * Result from scanning the market
 */
export interface ScanToolResult {
  timestamp: string;
  coinsScanned: number;
  opportunities: Array<{
    symbol: string;
    price: number;
    change24h: number;
    setupConfidence: number;
    bias: string;
    risk: string;
  }>;
}

/**
 * Result from analyzing a specific coin
 */
export interface AnalyzeToolResult {
  symbol: string;
  price: number;
  trend: string;
  setupDetected: boolean;
  setupConfidence: number;
  supports: Array<{ price: number; strength: number }>;
  resistances: Array<{ price: number; strength: number }>;
  indicators: {
    rsi: number | null;
    macdState: string;
    volumeTrend: string;
  };
  recommendation: string;
}

/**
 * Result from generating a plan
 */
export interface PlanToolResult {
  success: boolean;
  plan?: Plan;
  error?: string;
  summary?: string;
}

/**
 * Result from executing a plan (requires approval)
 */
export interface ExecuteToolResult {
  success: boolean;
  trade?: Trade;
  error?: string;
  orderCount?: number;
}

/**
 * Result from monitoring positions
 */
export interface MonitorToolResult {
  openTrades: number;
  totalUnrealizedPnl: number;
  totalUnrealizedPnlPercent: number;
  positions: Array<{
    symbol: string;
    status: string;
    unrealizedPnl: number;
    unrealizedPnlPercent: number;
  }>;
  alerts: string[];
}

/**
 * Result from an explanation request
 */
export interface ExplainToolResult {
  explanation: string;
  topic: string;
}
