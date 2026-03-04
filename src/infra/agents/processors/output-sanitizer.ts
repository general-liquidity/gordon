/**
 * Gordon Output Sanitizer Processor
 *
 * Wraps the existing checkOutputGuardrails() as a native Mastra OutputProcessor.
 * Runs per-chunk during streaming via processOutputStream() to redact
 * sensitive data (API keys, secrets) in real-time.
 */

import type {
  Processor,
  ProcessOutputStreamArgs,
} from "@mastra/core/processors";
import type { ChunkType } from "@mastra/core/stream";
import { checkOutputGuardrails } from "../middleware/guardrails.ts";

export class GordonOutputSanitizer
  implements Processor<"gordon-output-sanitizer">
{
  readonly id = "gordon-output-sanitizer" as const;
  readonly name = "Gordon Output Sanitizer";
  readonly description =
    "Per-chunk output sanitization for API keys, secrets, and sensitive data";

  processOutputStream(
    args: ProcessOutputStreamArgs,
  ): Promise<ChunkType | null | undefined> {
    const { part } = args;

    // Only process text-delta chunks
    if (part.type !== "text-delta") return Promise.resolve(part);

    // Mastra text-delta chunks use payload.text
    const payload = (part as unknown as { payload?: { text?: string } })
      .payload;
    const text = payload?.text;
    if (!text) return Promise.resolve(part);

    // Run sanitization and return modified chunk if needed
    return checkOutputGuardrails(text).then((check) => {
      if (check.sanitized !== text && payload) {
        return {
          ...part,
          payload: { ...payload, text: check.sanitized },
        } as ChunkType;
      }
      return part;
    });
  }
}
