/**
 * Intent Parser
 *
 * Maps natural language execution descriptions to ExecutionIntent objects.
 * Detects keywords like "slowly", "VWAP", "hide", "iceberg" to select
 * the appropriate algorithm and configuration.
 */

import type {
  ExecutionIntent,
  ExecutionAlgorithm,
  TWAPConfig,
  VWAPConfig,
  IcebergConfig,
  POVConfig,
} from "./algorithms/types.ts";
import {
  DEFAULT_TWAP_CONFIG,
  DEFAULT_VWAP_CONFIG,
  DEFAULT_ICEBERG_CONFIG,
  DEFAULT_POV_CONFIG,
} from "./algorithms/types.ts";

// ============================================================================
// Duration Parsing
// ============================================================================

const DURATION_PATTERNS: Array<{ pattern: RegExp; toMs: (match: RegExpMatchArray) => number }> = [
  { pattern: /(\d+)\s*h(?:ours?)?/i, toMs: (m) => parseInt(m[1]!, 10) * 60 * 60 * 1000 },
  { pattern: /(\d+)\s*m(?:in(?:utes?)?)?/i, toMs: (m) => parseInt(m[1]!, 10) * 60 * 1000 },
  { pattern: /(\d+)\s*d(?:ays?)?/i, toMs: (m) => parseInt(m[1]!, 10) * 24 * 60 * 60 * 1000 },
];

function parseDuration(text: string): number | null {
  for (const { pattern, toMs } of DURATION_PATTERNS) {
    const match = text.match(pattern);
    if (match) return toMs(match);
  }
  return null;
}

// ============================================================================
// Algorithm Detection
// ============================================================================

interface AlgorithmHint {
  algorithm: ExecutionAlgorithm;
  confidence: number;
  keywords: string[];
}

function detectAlgorithm(text: string): AlgorithmHint {
  const lower = text.toLowerCase();

  // Explicit algorithm names (highest confidence)
  if (
    lower.includes("twap") ||
    lower.includes("time-weighted") ||
    lower.includes("time weighted")
  ) {
    return { algorithm: "TWAP", confidence: 1.0, keywords: ["twap"] };
  }
  if (
    lower.includes("vwap") ||
    lower.includes("volume-weighted") ||
    lower.includes("volume weighted")
  ) {
    return { algorithm: "VWAP", confidence: 1.0, keywords: ["vwap"] };
  }
  if (lower.includes("iceberg") || lower.includes("ice berg")) {
    return { algorithm: "ICEBERG", confidence: 1.0, keywords: ["iceberg"] };
  }
  if (
    lower.includes("pov") ||
    lower.includes("percentage of volume") ||
    lower.includes("percent of volume") ||
    lower.includes("participation rate")
  ) {
    return { algorithm: "POV", confidence: 1.0, keywords: ["pov"] };
  }

  // Behavioral keywords (lower confidence)
  if (
    lower.includes("hide") ||
    lower.includes("hidden") ||
    lower.includes("stealth") ||
    lower.includes("without moving")
  ) {
    return { algorithm: "ICEBERG", confidence: 0.8, keywords: ["hide/stealth"] };
  }
  if (
    lower.includes("match volume") ||
    lower.includes("follow volume") ||
    lower.includes("volume profile")
  ) {
    return { algorithm: "VWAP", confidence: 0.8, keywords: ["volume matching"] };
  }
  if (
    lower.includes("slowly") ||
    lower.includes("gradually") ||
    lower.includes("spread out") ||
    lower.includes("over time")
  ) {
    return { algorithm: "TWAP", confidence: 0.7, keywords: ["gradual execution"] };
  }
  if (lower.includes("accumulate") || lower.includes("dca") || lower.includes("dollar cost")) {
    return { algorithm: "TWAP", confidence: 0.7, keywords: ["accumulation/DCA"] };
  }
  if (
    lower.includes("minimize impact") ||
    lower.includes("low impact") ||
    lower.includes("minimal slippage")
  ) {
    return { algorithm: "TWAP", confidence: 0.6, keywords: ["impact minimization"] };
  }

  // Default: TWAP
  return { algorithm: "TWAP", confidence: 0.3, keywords: ["default"] };
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Parse a natural language execution description into an ExecutionIntent.
 *
 * Examples:
 *   "Buy 1 BTC slowly over 4 hours" → TWAP(4h)
 *   "Accumulate ETH matching volume pattern" → VWAP
 *   "Buy without moving the market" → ICEBERG
 *   "TWAP 0.5 BTC over 2 hours" → TWAP(2h)
 */
export function parseExecutionIntent(
  text: string,
  symbol: string,
  side: "BUY" | "SELL",
  totalQuantity: number,
): ExecutionIntent {
  const hint = detectAlgorithm(text);
  const duration = parseDuration(text);

  let config: TWAPConfig | VWAPConfig | IcebergConfig | POVConfig;

  switch (hint.algorithm) {
    case "TWAP": {
      const durationMs = duration ?? DEFAULT_TWAP_CONFIG.durationMs;
      const slices = Math.max(4, Math.min(100, Math.ceil(durationMs / (5 * 60 * 1000))));
      config = {
        ...DEFAULT_TWAP_CONFIG,
        durationMs,
        slices,
      };
      break;
    }
    case "VWAP": {
      config = {
        ...DEFAULT_VWAP_CONFIG,
        durationMs: duration ?? DEFAULT_VWAP_CONFIG.durationMs,
      };
      break;
    }
    case "ICEBERG": {
      config = { ...DEFAULT_ICEBERG_CONFIG };
      break;
    }
    case "POV": {
      config = {
        ...DEFAULT_POV_CONFIG,
        maxDurationMs: duration ?? DEFAULT_POV_CONFIG.maxDurationMs,
      };
      break;
    }
  }

  return {
    algorithm: hint.algorithm,
    symbol,
    side,
    totalQuantity,
    config,
  };
}

/**
 * Get a human-readable description of an execution intent.
 */
export function describeIntent(intent: ExecutionIntent): string {
  const { algorithm, symbol, side, totalQuantity, config } = intent;

  switch (algorithm) {
    case "TWAP": {
      const cfg = config as TWAPConfig;
      const hours = (cfg.durationMs / (60 * 60 * 1000)).toFixed(1);
      return `TWAP ${side} ${totalQuantity} ${symbol} over ${hours}h in ${cfg.slices} slices`;
    }
    case "VWAP": {
      const cfg = config as VWAPConfig;
      const hours = (cfg.durationMs / (60 * 60 * 1000)).toFixed(1);
      return `VWAP ${side} ${totalQuantity} ${symbol} over ${hours}h (${cfg.participationRate}% participation)`;
    }
    case "ICEBERG": {
      const cfg = config as IcebergConfig;
      return `Iceberg ${side} ${totalQuantity} ${symbol} (${(cfg.showRatio * 100).toFixed(0)}% visible)`;
    }
    case "POV": {
      const cfg = config as POVConfig;
      return `POV ${side} ${totalQuantity} ${symbol} at ${cfg.targetParticipationRate}% (cap ${cfg.maxParticipationRate}%)`;
    }
  }
}
