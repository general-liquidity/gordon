import type { RuntimeTranscriptEntry } from "../contracts/types.ts";

export class TranscriptProjector {
  toPlainText(entries: RuntimeTranscriptEntry[]): string {
    return entries
      .map((entry) => `[${entry.timestamp}] ${entry.role}: ${entry.content}`)
      .join("\n");
  }
}
