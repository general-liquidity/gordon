import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import type { HandoffArtifact, WorkerScratchpadEntry } from "./HandoffArtifact.ts";

export class ScratchpadStore {
  private readonly emitter = new EventEmitter();
  private readonly handoffs: HandoffArtifact[] = [];
  private readonly entries: WorkerScratchpadEntry[] = [];

  subscribe(listener: () => void): () => void {
    this.emitter.on("change", listener);
    return () => {
      this.emitter.off("change", listener);
    };
  }

  appendEntry(entry: Omit<WorkerScratchpadEntry, "id" | "timestamp"> & Partial<Pick<WorkerScratchpadEntry, "id" | "timestamp">>): WorkerScratchpadEntry {
    const nextEntry: WorkerScratchpadEntry = {
      id: entry.id ?? randomUUID(),
      timestamp: entry.timestamp ?? new Date().toISOString(),
      worker: entry.worker,
      kind: entry.kind,
      content: entry.content,
      metadata: entry.metadata,
    };
    this.entries.push(nextEntry);
    this.emit();
    return nextEntry;
  }

  recordHandoff(artifact: Omit<HandoffArtifact, "id" | "timestamp"> & Partial<Pick<HandoffArtifact, "id" | "timestamp">>): HandoffArtifact {
    const nextArtifact: HandoffArtifact = {
      id: artifact.id ?? randomUUID(),
      timestamp: artifact.timestamp ?? new Date().toISOString(),
      fromWorker: artifact.fromWorker,
      toWorker: artifact.toWorker,
      reason: artifact.reason,
      toolName: artifact.toolName,
      metadata: artifact.metadata,
    };
    this.handoffs.push(nextArtifact);
    this.appendEntry({
      worker: artifact.toWorker,
      kind: "handoff",
      content: `${artifact.fromWorker} -> ${artifact.toWorker}: ${artifact.reason}`,
      metadata: {
        handoffId: nextArtifact.id,
        toolName: artifact.toolName,
        ...artifact.metadata,
      },
    });
    this.emit();
    return nextArtifact;
  }

  listEntries(worker?: string): WorkerScratchpadEntry[] {
    const source = worker ? this.entries.filter((entry) => entry.worker === worker) : this.entries;
    return [...source];
  }

  listHandoffs(): HandoffArtifact[] {
    return [...this.handoffs];
  }

  replaceState(next: {
    entries?: WorkerScratchpadEntry[];
    handoffs?: HandoffArtifact[];
  }): void {
    this.entries.length = 0;
    this.handoffs.length = 0;
    if (next.entries) {
      this.entries.push(...next.entries);
    }
    if (next.handoffs) {
      this.handoffs.push(...next.handoffs);
    }
    this.emit();
  }

  private emit(): void {
    this.emitter.emit("change");
  }
}
