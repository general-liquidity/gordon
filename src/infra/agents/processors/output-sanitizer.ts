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

// Strip emojis from output — trading CLI should use plain text
// Matches most emoji ranges including emoticons, symbols, flags, skin tones
const EMOJI_RE = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{200D}\u{20E3}\u{E0020}-\u{E007F}]+/gu;

function stripEmojis(text: string): string {
  // Only collapse runs of SPACES (not all whitespace) — the previous
  // /\s{2,}/g regex ate newlines because \s matches \n too, which caused
  // markdown headers and paragraph breaks to merge into their surrounding
  // text. Preserving \n is essential for the markdown parser downstream.
  return text.replace(EMOJI_RE, "").replace(/ {2,}/g, " ");
}

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

    // Strip emojis — Gordon is a trading CLI, not a chat app
    const deEmojied = stripEmojis(text);

    // Run sanitization and return modified chunk if needed
    return checkOutputGuardrails(deEmojied).then((check) => {
      if (check.sanitized !== text && payload) {
        return {
          ...part,
          payload: { ...payload, text: check.sanitized },
        } as ChunkType;
      }
      if (deEmojied !== text && payload) {
        return {
          ...part,
          payload: { ...payload, text: deEmojied },
        } as ChunkType;
      }
      return part;
    });
  }
}
