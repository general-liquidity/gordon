import type { RuntimeWorkerRole } from "../contracts/types.ts";

export interface HandoffArtifact {
  id: string;
  fromWorker: RuntimeWorkerRole | "Gordon";
  toWorker: RuntimeWorkerRole | "Gordon";
  timestamp: string;
  reason: string;
  toolName?: string;
  metadata?: Record<string, unknown>;
}

export interface WorkerScratchpadEntry {
  id: string;
  worker: RuntimeWorkerRole | "Gordon";
  timestamp: string;
  kind: "handoff" | "tool_call" | "note";
  content: string;
  metadata?: Record<string, unknown>;
}
