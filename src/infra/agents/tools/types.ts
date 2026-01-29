/**
 * Shared types and utilities for Mastra agent tools
 */

import type { RequestContext } from "@mastra/core/request-context";
import type { GordonContext } from "../types.ts";
import type { BinanceClient } from "../../binance/index.ts";
import type { LLMClient } from "../../llm/index.ts";
import type { GordonConfig } from "../../../types/index.ts";

// Re-export for convenience
export type { GordonContext };

/**
 * Mastra tool execution context type
 */
export interface MastraExecutionContext {
  requestContext?: RequestContext;
  tracingContext?: unknown;
  abortSignal?: AbortSignal;
}

/**
 * Extract GordonContext from Mastra's execution context
 * This bridges Mastra's RequestContext to our GordonContext type
 */
export function getGordonContext(execContext?: MastraExecutionContext): GordonContext | null {
  const rc = execContext?.requestContext;
  if (!rc) return null;

  return {
    binance: rc.get("binance") as BinanceClient | undefined,
    llm: rc.get("llm") as LLMClient | undefined,
    config: rc.get("config") as GordonConfig | undefined,
    userId: rc.get("userId") as string | undefined,
  } as GordonContext;
}

/**
 * Standard error responses
 */
export const errors = {
  noBinance: { error: "Binance client not connected. Please configure API keys." },
  noLLM: { error: "LLM client not connected." },
  noContext: { error: "Context not available." },
  notArmed: (action: string) => ({
    error: `System must be ARMED to ${action}. Use 'arm' command first.`,
  }),
  insufficientData: (symbol: string) => ({
    error: `Insufficient data for ${symbol}. Need at least 50 candles.`,
  }),
} as const;

/**
 * Helper to normalize trading pair symbols
 */
export function normalizeSymbol(symbol: string): string {
  return symbol.toUpperCase().endsWith("USDT")
    ? symbol.toUpperCase()
    : `${symbol.toUpperCase()}USDT`;
}

/**
 * Helper to check if system is armed
 */
export function isArmed(ctx: GordonContext): boolean {
  return ctx.config?.mode === "ARMED";
}
