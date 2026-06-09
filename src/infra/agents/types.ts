/**
 * Agent Types
 * Shared types for Gordon's agent infrastructure
 */

import type { BinanceClient } from "../venues/exchange/clients/binance/index.ts";
import type { Exchange } from "../exchange/index.ts";
import type { BrokerAdapter } from "../broker/index.ts";
import type { LLMClient } from "../ai/llm/index.ts";
import type { ActionTaskScope, CredentialProfile } from "../runtime/actions/types.ts";
import type { GordonConfig, Plan, Trade } from "../../types/index.ts";

export interface GordonRuntimeToolAccessResult {
  status: "allowed" | "blocked" | "pending";
  reason?: string;
  requestId?: string;
}

export interface GordonRuntimeAccess {
  runtimeId: string;
  sessionId?: string;
  resourceId?: string;
  threadId?: string;
  evaluateToolAccess: (
    toolName: string,
    context: GordonContext,
  ) => Promise<GordonRuntimeToolAccessResult>;
  refreshPlugins?: () => Promise<void>;
  reloadPlugins?: () => Promise<void>;
  listRuntimeCommands?: () => string[];
  listRegisteredTools?: () => string[];
  searchHistory?: (query: string, options?: { limit?: number }) => Array<{
    timestamp: string;
    source: string;
    content: string;
  }>;
}

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
  /** Canonical action requested by the UI/command layer */
  requestedActionId?: string;
  /** Runtime scope used to constrain tool usage for the current request */
  requestedTaskScope?: ActionTaskScope;
  /** Credential profile the request should prefer */
  credentialProfile?: CredentialProfile;
  /** Session-bound runtime access for approvals, tooling, and history */
  runtime?: GordonRuntimeAccess;
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
