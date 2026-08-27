import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import type { RuntimeTranscriptEntry } from "../contracts/types.ts";

export interface TranscriptStoreOptions {
  maxEntries?: number;
}

export class TranscriptStore {
  private readonly emitter = new EventEmitter();
  private readonly maxEntries: number;
  private entries: RuntimeTranscriptEntry[] = [];
  private compactionCount = 0;

  constructor(options: TranscriptStoreOptions = {}) {
    this.maxEntries = options.maxEntries ?? 200;
  }

  list(): RuntimeTranscriptEntry[] {
    return [...this.entries];
  }

  subscribe(listener: (entries: RuntimeTranscriptEntry[]) => void): () => void {
    this.emitter.on("change", listener);
    return () => {
      this.emitter.off("change", listener);
    };
  }

  append(
    entry: Omit<RuntimeTranscriptEntry, "id" | "timestamp"> &
      Partial<Pick<RuntimeTranscriptEntry, "id" | "timestamp">>,
  ): RuntimeTranscriptEntry {
    const nextEntry: RuntimeTranscriptEntry = {
      id: entry.id ?? randomUUID(),
      timestamp: entry.timestamp ?? new Date().toISOString(),
      role: entry.role,
      content: entry.content,
      metadata: entry.metadata,
    };
    this.entries.push(nextEntry);
    this.compactIfNeeded();
    this.emit();
    return nextEntry;
  }

  replace(
    entries: RuntimeTranscriptEntry[],
    options: { compacted?: boolean } = {},
  ): RuntimeTranscriptEntry[] {
    this.entries = [...entries];
    if (options.compacted) {
      this.compactionCount += 1;
    }
    this.emit();
    return this.list();
  }

  getCompactionCount(): number {
    return this.compactionCount;
  }

  private compactIfNeeded(): void {
    if (this.entries.length <= this.maxEntries) {
      return;
    }

    const overflowCount = this.entries.length - this.maxEntries + 1;
    const compactedEntries = this.entries.splice(0, overflowCount);
    const summary = compactedEntries
      .map((entry) => `${entry.role}: ${entry.content}`.trim())
      .join("\n")
      .slice(0, 1_500);

    this.entries.unshift({
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      role: "system",
      content: `Compacted ${compactedEntries.length} transcript entries.\n${summary}`,
      metadata: {
        compacted: true,
      },
    });
    this.compactionCount += 1;
  }

  private emit(): void {
    this.emitter.emit("change", this.list());
  }
}
