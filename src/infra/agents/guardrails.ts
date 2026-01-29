/**
 * Guardrails for Gordon Agent
 * Input and output validation to ensure safe operation
 */

import type { InputGuardrail, OutputGuardrail } from "@openai/agents";
import { createModuleLogger } from "../logger/index.ts";
import { emitEvent } from "../../events/index.ts";

const logger = createModuleLogger("guardrails");

/**
 * Extract text content from agent input
 */
function extractTextFromInput(input: unknown): string {
  if (typeof input === "string") {
    return input;
  }
  if (Array.isArray(input)) {
    return input
      .filter((item): item is { content: string } =>
        typeof item === "object" &&
        item !== null &&
        "content" in item &&
        typeof (item as Record<string, unknown>).content === "string"
      )
      .map((item) => item.content)
      .join(" ");
  }
  return String(input);
}

// ============================================================================
// Input Guardrails
// ============================================================================

/**
 * Validates that user input doesn't contain dangerous commands
 */
const dangerousCommandGuardrail: InputGuardrail = {
  name: "dangerous_command_check",
  execute: async ({ input }): Promise<{ tripwireTriggered: boolean; outputInfo: string }> => {
    const text = extractTextFromInput(input);
    const lowerText = text.toLowerCase();

    // Check for attempts to bypass safety
    const dangerousPatterns = [
      "ignore previous instructions",
      "ignore all instructions",
      "disregard safety",
      "bypass safe mode",
      "override safety",
      "execute without approval",
      "skip confirmation",
    ];

    for (const pattern of dangerousPatterns) {
      if (lowerText.includes(pattern)) {
        logger.warn("Dangerous command pattern detected", { pattern });
        await emitEvent("guardrail:blocked", { guardrailType: "input", reason: "dangerous_pattern", pattern });
        return {
          tripwireTriggered: true,
          outputInfo: `I can't process requests that try to bypass safety measures. Please rephrase your request.`,
        };
      }
    }

    return { tripwireTriggered: false, outputInfo: "" };
  },
};

/**
 * Validates input length to prevent prompt injection via very long inputs
 */
const inputLengthGuardrail: InputGuardrail = {
  name: "input_length_check",
  execute: async ({ input }): Promise<{ tripwireTriggered: boolean; outputInfo: string }> => {
    const text = extractTextFromInput(input);
    const MAX_INPUT_LENGTH = 10000; // 10k characters

    if (text.length > MAX_INPUT_LENGTH) {
      logger.warn("Input too long", { length: text.length, max: MAX_INPUT_LENGTH });
      await emitEvent("guardrail:blocked", { guardrailType: "input", reason: "too_long", length: text.length });
      return {
        tripwireTriggered: true,
        outputInfo: `Your message is too long (${text.length} characters). Please keep it under ${MAX_INPUT_LENGTH} characters.`,
      };
    }

    return { tripwireTriggered: false, outputInfo: "" };
  },
};

// ============================================================================
// Output Guardrails
// ============================================================================

/**
 * Ensures Gordon doesn't leak sensitive information
 */
const sensitiveInfoGuardrail: OutputGuardrail = {
  name: "sensitive_info_check",
  execute: async ({ agentOutput }): Promise<{ tripwireTriggered: boolean; outputInfo: string }> => {
    const output = String(agentOutput);

    // Check for potential API key leakage
    const sensitivePatterns = [
      /sk-[a-zA-Z0-9]{20,}/, // OpenAI API keys
      /[a-zA-Z0-9]{64}/, // Potential Binance secrets (64 char hex)
      /-----BEGIN.*PRIVATE KEY-----/, // Private keys
    ];

    for (const pattern of sensitivePatterns) {
      if (pattern.test(output)) {
        logger.error("Sensitive information detected in output");
        await emitEvent("guardrail:blocked", { guardrailType: "output", reason: "sensitive_info" });
        return {
          tripwireTriggered: true,
          outputInfo: "I encountered an issue generating a safe response. Please try again.",
        };
      }
    }

    return { tripwireTriggered: false, outputInfo: "" };
  },
};

/**
 * Ensures trading recommendations include risk warnings (logging only, no blocking)
 */
const riskWarningGuardrail: OutputGuardrail = {
  name: "risk_warning_check",
  execute: async ({ agentOutput }): Promise<{ tripwireTriggered: boolean; outputInfo: string }> => {
    const output = String(agentOutput).toLowerCase();

    // If the output contains trading action words but no risk mention
    const tradingWords = ["buy", "sell", "execute", "place order", "trade"];
    const riskWords = ["risk", "stop loss", "careful", "caution", "warning", "note"];

    const hasTradingContent = tradingWords.some((word) => output.includes(word));
    const hasRiskMention = riskWords.some((word) => output.includes(word));

    // Only log if it's clearly a trading recommendation without risk context
    if (hasTradingContent && !hasRiskMention && output.length > 200) {
      logger.debug("Trading content without explicit risk warning");
    }

    return { tripwireTriggered: false, outputInfo: "" };
  },
};

// ============================================================================
// Export Guardrail Arrays
// ============================================================================

export const inputGuardrails: InputGuardrail[] = [
  dangerousCommandGuardrail,
  inputLengthGuardrail,
];

export const outputGuardrails: OutputGuardrail[] = [
  sensitiveInfoGuardrail,
  riskWarningGuardrail,
];
