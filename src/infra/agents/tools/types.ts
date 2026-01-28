/**
 * Shared types and utilities for agent tools
 */

import type { RunContext } from "@openai/agents";
import type { GordonContext } from "../types.ts";

// Re-export for convenience
export type { RunContext, GordonContext };

// Common tool context type
export type ToolRunContext = RunContext<GordonContext> | undefined;

/**
 * Helper to safely get context or return error
 */
export function getContext(runContext: ToolRunContext): GordonContext | null {
  return runContext?.context ?? null;
}

/**
 * Standard error responses
 */
export const errors = {
  noBinance: { error: "Binance client not connected. Please configure API keys." },
  noLLM: { error: "LLM client not connected." },
  noContext: { error: "Context not available." },
} as const;
