import type { RuntimeTranscriptEntry } from "../contracts/types.ts";
import { TranscriptStore } from "./TranscriptStore.ts";

export class CompactionManager {
  compact(entries: RuntimeTranscriptEntry[], maxEntries: number): RuntimeTranscriptEntry[] {
    if (entries.length <= maxEntries) {
      return entries;
    }

    const overflowCount = entries.length - maxEntries + 1;
    const compactedEntries = entries.slice(0, overflowCount);
    const remainder = entries.slice(overflowCount);
    const summary = compactedEntries
      .map((entry) => `${entry.role}: ${entry.content}`)
      .join("\n")
      .slice(0, 1_500);

    return [
      {
        id: `compaction_${Date.now()}`,
        timestamp: new Date().toISOString(),
        role: "system",
        content: `Compaction summary\n${summary}`,
        metadata: {
          compacted: true,
          compactedCount: compactedEntries.length,
        },
      },
      ...remainder,
    ];
  }

  compactStore(store: TranscriptStore, maxEntries: number): RuntimeTranscriptEntry[] {
    const current = store.list();
    const compacted = this.compact(current, maxEntries);
    return store.replace(compacted, { compacted: compacted.length !== current.length });
  }
}
