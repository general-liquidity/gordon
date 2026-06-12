import { useCallback } from "react";

// Token estimation — predict cost before expensive API calls.
// Trading context: backtests, deep scans, multi-symbol analysis.
//
// IMPORTANT: `estimate()` is a PURE FUNCTION (no state updates). Callers
// may invoke it during render to derive a display value. A prior version
// stored the last result in useState, which caused an infinite re-render
// loop when PromptInput called estimate(value) every render to show the
// inline "~N tokens" hint.

interface TokenEstimate {
  estimatedTokens: number;
  estimatedCostUsd: number;
  warning: string | null;
}

// Rough cost per 1K tokens by provider (input+output blended)
const COST_PER_1K: Record<string, number> = {
  "openai": 0.005,
  "anthropic": 0.008,
  "google": 0.003,
  "dedalus": 0.006,
};

export function useTokenEstimation() {
  const estimate = useCallback((
    inputText: string,
    provider: string = "dedalus",
    toolCount: number = 0,
  ): TokenEstimate => {
    // Rough estimation: ~4 chars per token for English text
    const inputTokens = Math.ceil(inputText.length / 4);
    // Tool schemas add ~200 tokens per tool
    const toolTokens = toolCount * 200;
    // System prompt ~2000 tokens
    const systemTokens = 2000;
    // Expect output ~2x input for analysis, ~1x for simple queries
    const outputMultiplier = toolCount > 3 ? 2.5 : 1.5;

    const totalTokens = Math.round((inputTokens + toolTokens + systemTokens) * (1 + outputMultiplier));
    const costPer1K = COST_PER_1K[provider] ?? 0.005;
    const estimatedCostUsd = (totalTokens / 1000) * costPer1K;

    const warning = estimatedCostUsd > 0.50
      ? `This request may cost ~$${estimatedCostUsd.toFixed(2)}`
      : estimatedCostUsd > 0.10
        ? `Estimated cost: ~$${estimatedCostUsd.toFixed(2)}`
        : null;

    return { estimatedTokens: totalTokens, estimatedCostUsd, warning };
  }, []);

  return { estimate };
}
