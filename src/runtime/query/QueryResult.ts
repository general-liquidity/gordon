import type { RuntimeToolSpec, RuntimeTranscriptEntry, RuntimeWorkerRole } from "../contracts/types.ts";

export interface QueryResult<T> {
  data: T;
  transcript: RuntimeTranscriptEntry[];
  activeWorker?: RuntimeWorkerRole;
  toolsUsed: RuntimeToolSpec[];
}
