/**
 * Shared types and utilities for Mastra agent tools
 */

import type { GordonContext } from "../types.ts";

// Re-export for convenience
export type { GordonContext };

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
