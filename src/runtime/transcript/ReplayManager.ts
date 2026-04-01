import type { RuntimeTranscriptEntry } from "../contracts/types.ts";

export interface ReplayFrame {
  index: number;
  role: RuntimeTranscriptEntry["role"];
  content: string;
  timestamp: string;
}

export class ReplayManager {
  buildFrames(entries: RuntimeTranscriptEntry[]): ReplayFrame[] {
    return entries.map((entry, index) => ({
      index,
      role: entry.role,
      content: entry.content,
      timestamp: entry.timestamp,
    }));
  }
}
