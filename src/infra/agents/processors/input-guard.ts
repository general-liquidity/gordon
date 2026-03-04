/**
 * Gordon Input Guard Processor
 *
 * Wraps the existing checkInputGuardrails() as a native Mastra InputProcessor.
 * Zero-latency regex-based detection (no LLM call) — faster than Mastra's
 * built-in PromptInjectionDetector which requires a model.
 *
 * Detects: prompt injection, safety bypass attempts, YOLO trading,
 * SQL injection, unrealistic amounts.
 */

import type { Processor, ProcessInputArgs, ProcessInputResult } from "@mastra/core/processors";
import { checkInputGuardrails } from "../middleware/guardrails.ts";

export class GordonInputGuard implements Processor<"gordon-input-guard"> {
  readonly id = "gordon-input-guard" as const;
  readonly name = "Gordon Input Guard";
  readonly description = "Regex-based input guardrail for prompt injection, safety bypass, and risky trading patterns";

  async processInput(args: ProcessInputArgs): Promise<ProcessInputResult> {
    const { messages, abort } = args;

    // Find the last user message to check
    const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUserMsg) return messages;

    // Extract text content from message
    const text = extractTextContent(lastUserMsg.content);
    if (!text) return messages;

    // Run regex-based guardrail check
    const check = await checkInputGuardrails(text);
    if (!check.allowed) {
      abort(check.reason || "Input blocked by safety guardrail");
    }

    return messages;
  }
}

/**
 * Extract text from MastraDBMessage content (string or parts array)
 */
function extractTextContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter(
        (part: unknown) =>
          typeof part === "object" &&
          part !== null &&
          "type" in part &&
          (part as Record<string, unknown>).type === "text",
      )
      .map((part: unknown) => (part as { text: string }).text)
      .join(" ");
  }
  return "";
}
