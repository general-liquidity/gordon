/**
 * Guardrails Middleware for Mastra
 *
 * Mastra doesn't have built-in guardrails like OpenAI Agents SDK.
 * This module provides input/output validation as middleware functions.
 *
 * Security improvements:
 * - Word boundary matching to prevent false positives
 * - Whitelist for legitimate phrases
 * - More specific dangerous patterns
 * - Pattern context awareness
 */

import { createModuleLogger } from "../../logger/index.ts";
import { emitEvent } from "../../../events/index.ts";

const logger = createModuleLogger("guardrails");

// ============================================================================
// Input Guardrails
// ============================================================================

/**
 * Whitelist of legitimate phrases that might match dangerous patterns
 * These are checked first and bypass pattern matching
 */
const WHITELISTED_PHRASES = [
  "all in one",
  "all in all",
  "all in favor",
  "all in good time",
  "all in the family",
  "all inclusive",
  "delete all orders", // Legitimate trading command
  "show all",
  "list all",
  "view all",
  "get all",
  "fetch all",
  "check all",
  "cancel all orders", // Legitimate trading command
];

/**
 * Patterns that indicate potentially dangerous commands
 * Using word boundaries (\b) to prevent false positives
 */
const DANGEROUS_PATTERNS: { pattern: RegExp; description: string; severity: "high" | "medium" }[] = [
  // High severity - immediate execution or bypass attempts
  { pattern: /\bexecute\s+immediately\s+without\b/i, description: "Immediate execution without safeguards", severity: "high" },
  { pattern: /\bbypass\s+(?:all\s+)?safety\b/i, description: "Attempting to bypass safety mechanisms", severity: "high" },
  { pattern: /\bignore\s+(?:all\s+)?limits?\b/i, description: "Attempting to ignore trading limits", severity: "high" },
  { pattern: /\bdisable\s+(?:all\s+)?(?:safety|guardrails?|limits?)\b/i, description: "Attempting to disable safety features", severity: "high" },
  { pattern: /\boverride\s+(?:all\s+)?(?:safety|limits?|restrictions?)\b/i, description: "Attempting to override restrictions", severity: "high" },
  { pattern: /\bskip\s+(?:all\s+)?(?:validation|checks?|verification)\b/i, description: "Attempting to skip validation", severity: "high" },

  // Medium severity - risky trading patterns
  { pattern: /\bmax(?:imum)?\s+leverage\b/i, description: "Requesting maximum leverage", severity: "medium" },
  { pattern: /\b(?:100|hundred)\s*%\s+(?:of\s+)?(?:portfolio|balance|funds?)\b/i, description: "Requesting 100% allocation", severity: "medium" },
  { pattern: /\ball[\s-]in\b(?!\s+(?:one|all|favor|good|the|clusive))/i, description: "All-in trading request", severity: "medium" },
  { pattern: /\byolo\s+(?:trade|buy|sell|everything)\b/i, description: "YOLO trading request", severity: "medium" },
  { pattern: /\bbet\s+everything\b/i, description: "Betting everything", severity: "medium" },
  { pattern: /\binvest\s+(?:all|everything|entire)\b/i, description: "Investing entire balance", severity: "medium" },

  // SQL injection attempts (medium severity - shouldn't work but flag anyway)
  { pattern: /\bdrop\s+(?:table|database|index)\b/i, description: "SQL injection attempt", severity: "medium" },
  { pattern: /\bdelete\s+from\s+\w+\s+where\b/i, description: "SQL injection attempt", severity: "medium" },
  { pattern: /;\s*(?:drop|delete|truncate|update)\b/i, description: "SQL injection attempt", severity: "medium" },

  // Prompt injection attempts
  { pattern: /\bignore\s+(?:previous|all|your)\s+instructions?\b/i, description: "Prompt injection attempt", severity: "high" },
  { pattern: /\bforget\s+(?:all\s+)?(?:previous\s+)?(?:instructions?|rules?)\b/i, description: "Prompt injection attempt", severity: "high" },
  { pattern: /\byou\s+are\s+now\s+(?:a|an)\b/i, description: "Prompt injection attempt", severity: "high" },
  { pattern: /\bact\s+as\s+(?:if|though)\s+you\s+(?:have\s+)?no\s+restrictions?\b/i, description: "Prompt injection attempt", severity: "high" },
];

/**
 * Check if input contains a whitelisted phrase
 */
function containsWhitelistedPhrase(input: string): boolean {
  const lowerInput = input.toLowerCase();
  return WHITELISTED_PHRASES.some(phrase => lowerInput.includes(phrase));
}

/**
 * Check input for dangerous patterns
 */
export async function checkInputGuardrails(input: string): Promise<{
  allowed: boolean;
  reason?: string;
  sanitized?: string;
  severity?: "high" | "medium";
}> {
  // First check if input contains a whitelisted phrase
  if (containsWhitelistedPhrase(input)) {
    logger.debug("Input contains whitelisted phrase, skipping pattern check");
    // Still continue to check for high-severity patterns even with whitelist
    for (const { pattern, description, severity } of DANGEROUS_PATTERNS) {
      if (severity === "high" && pattern.test(input)) {
        logger.warn("Input guardrail triggered (high severity)", { pattern: pattern.source, description });
        await emitEvent("guardrail:input_blocked", {
          reason: "dangerous_pattern",
          pattern: pattern.source,
          description,
          severity,
        });
        return {
          allowed: false,
          reason: `Security violation: ${description}`,
          severity,
        };
      }
    }
    return { allowed: true };
  }

  // Check for dangerous patterns
  for (const { pattern, description, severity } of DANGEROUS_PATTERNS) {
    if (pattern.test(input)) {
      logger.warn("Input guardrail triggered", { pattern: pattern.source, description, severity });
      await emitEvent("guardrail:input_blocked", {
        reason: "dangerous_pattern",
        pattern: pattern.source,
        description,
        severity,
      });
      return {
        allowed: false,
        reason: `${severity === "high" ? "Security violation" : "Risky request detected"}: ${description}`,
        severity,
      };
    }
  }

  // Check for excessive amounts (e.g., "buy 1000000 BTC")
  const amountMatch = input.match(/(\d+(?:\.\d+)?)\s*(btc|eth|bnb)/i);
  if (amountMatch) {
    const amount = parseFloat(amountMatch[1]!);
    const asset = amountMatch[2]!.toUpperCase();

    // Sanity check for unrealistic amounts
    const maxAmounts: Record<string, number> = {
      BTC: 100,
      ETH: 1000,
      BNB: 10000,
    };

    if (amount > (maxAmounts[asset] || 100000)) {
      return {
        allowed: false,
        reason: `Amount ${amount} ${asset} seems unrealistic. Please verify.`,
      };
    }
  }

  return { allowed: true };
}

// ============================================================================
// Output Guardrails
// ============================================================================

/**
 * Patterns that might indicate sensitive information
 */
const SENSITIVE_PATTERNS = [
  /\b[A-Za-z0-9]{32,64}\b/g, // API keys, secrets
  /\b0x[a-fA-F0-9]{40}\b/g, // Ethereum addresses (warn only)
  /\bsk[-_][a-zA-Z0-9]{20,}\b/g, // OpenAI-style keys
];

/**
 * Check and sanitize output
 */
export async function checkOutputGuardrails(output: string): Promise<{
  sanitized: string;
  warnings: string[];
  blocked: boolean;
}> {
  const warnings: string[] = [];
  let sanitized = output;
  let blocked = false;

  // Check for potential API keys or secrets
  for (const pattern of SENSITIVE_PATTERNS) {
    const matches = output.match(pattern);
    if (matches) {
      for (const match of matches) {
        // Don't redact transaction hashes or addresses (they're public)
        if (match.startsWith("0x")) {
          warnings.push("Blockchain address detected (public data)");
          continue;
        }

        // Redact potential secrets
        warnings.push("Potential sensitive data detected and redacted");
        sanitized = sanitized.replace(match, "[REDACTED]");

        await emitEvent("guardrail:output_sanitized", {
          reason: "sensitive_data",
        });
      }
    }
  }

  // Check for accidental credential exposure
  if (/api[_-]?key|secret|password|token/i.test(output)) {
    warnings.push("Output may contain credential-related information");
    logger.warn("Credential-related terms in output", { outputLength: output.length });
  }

  return { sanitized, warnings, blocked };
}

// ============================================================================
// Trade Validation Guardrails
// ============================================================================

export interface TradeValidationInput {
  symbol: string;
  side: "BUY" | "SELL";
  quantity: number;
  price?: number;
  portfolioValue: number;
  maxAllocationPercent: number;
}

/**
 * Validate trade parameters before execution
 */
export function validateTrade(input: TradeValidationInput): {
  valid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  const { quantity, price, portfolioValue, maxAllocationPercent } = input;

  // Calculate trade value
  const tradeValue = price ? quantity * price : 0;

  // Check allocation limits
  if (tradeValue > 0) {
    const allocationPercent = (tradeValue / portfolioValue) * 100;

    if (allocationPercent > maxAllocationPercent * 100) {
      errors.push(
        `Trade allocation (${allocationPercent.toFixed(1)}%) exceeds max allowed (${(maxAllocationPercent * 100).toFixed(1)}%)`
      );
    }

    if (allocationPercent > 20) {
      warnings.push(
        `Large allocation: ${allocationPercent.toFixed(1)}% of portfolio`
      );
    }
  }

  // Check quantity sanity
  if (quantity <= 0) {
    errors.push("Quantity must be positive");
  }

  if (price !== undefined && price <= 0) {
    errors.push("Price must be positive");
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// ============================================================================
// Risk/Reward Validation
// ============================================================================

export interface RiskRewardInput {
  entryPrice: number;
  stopLossPrice: number;
  takeProfitPrices: number[];
  side: "BUY" | "SELL";
}

/**
 * Validate risk/reward ratio
 */
export function validateRiskReward(input: RiskRewardInput): {
  valid: boolean;
  ratio: number;
  errors: string[];
} {
  const { entryPrice, stopLossPrice, takeProfitPrices, side } = input;
  const errors: string[] = [];

  if (takeProfitPrices.length === 0) {
    errors.push("At least one take-profit level required");
    return { valid: false, ratio: 0, errors };
  }

  // Calculate risk (distance to stop loss)
  const risk = Math.abs(entryPrice - stopLossPrice);

  // Calculate reward (distance to first take profit)
  const firstTP = takeProfitPrices[0]!;
  const reward = Math.abs(firstTP - entryPrice);

  // Validate direction
  if (side === "BUY") {
    if (stopLossPrice >= entryPrice) {
      errors.push("Stop loss must be below entry for BUY orders");
    }
    if (firstTP <= entryPrice) {
      errors.push("Take profit must be above entry for BUY orders");
    }
  } else {
    if (stopLossPrice <= entryPrice) {
      errors.push("Stop loss must be above entry for SELL orders");
    }
    if (firstTP >= entryPrice) {
      errors.push("Take profit must be below entry for SELL orders");
    }
  }

  const ratio = reward / risk;

  // Minimum 1.2:1 risk/reward required
  if (ratio < 1.2) {
    errors.push(`Risk/reward ratio (${ratio.toFixed(2)}) is below minimum 1.2:1`);
  }

  return {
    valid: errors.length === 0,
    ratio,
    errors,
  };
}

// ============================================================================
// Wrapper for Protected Operations
// ============================================================================

/**
 * Wrap a function with input/output guardrails
 */
export async function withGuardrails<T>(
  input: string,
  operation: () => Promise<T>,
  options: { skipInputCheck?: boolean; skipOutputCheck?: boolean } = {}
): Promise<{ result: T; warnings: string[] } | { error: string }> {
  const warnings: string[] = [];

  // Input guardrail
  if (!options.skipInputCheck) {
    const inputCheck = await checkInputGuardrails(input);
    if (!inputCheck.allowed) {
      return { error: inputCheck.reason || "Input blocked by guardrail" };
    }
  }

  // Execute operation
  const result = await operation();

  // Output guardrail (if result is a string)
  if (!options.skipOutputCheck && typeof result === "string") {
    const outputCheck = await checkOutputGuardrails(result);
    warnings.push(...outputCheck.warnings);

    if (outputCheck.blocked) {
      return { error: "Output blocked by guardrail" };
    }

    return { result: outputCheck.sanitized as T, warnings };
  }

  return { result, warnings };
}
