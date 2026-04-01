import { describe, expect, it } from "bun:test";
import { CompactionManager } from "./CompactionManager.ts";
import { ReplayManager } from "./ReplayManager.ts";
import { TranscriptProjector } from "./TranscriptProjector.ts";

const entries = [
  { id: "1", timestamp: "2026-01-01T00:00:00.000Z", role: "user" as const, content: "hello" },
  { id: "2", timestamp: "2026-01-01T00:00:01.000Z", role: "assistant" as const, content: "hi" },
  { id: "3", timestamp: "2026-01-01T00:00:02.000Z", role: "tool" as const, content: "scan_market" },
];

describe("transcript managers", () => {
  it("projects plain text", () => {
    const projector = new TranscriptProjector();
    expect(projector.toPlainText(entries)).toContain("user: hello");
  });

  it("builds replay frames", () => {
    const replay = new ReplayManager();
    expect(replay.buildFrames(entries)).toHaveLength(3);
  });

  it("compacts long transcripts", () => {
    const compacted = new CompactionManager().compact(entries, 2);
    expect(compacted[0]?.role).toBe("system");
  });
});
