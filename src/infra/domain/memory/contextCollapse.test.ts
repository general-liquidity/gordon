import { describe, it, expect } from "bun:test";
import type { Message } from "../../ai/llm/types.ts";
import { collapseContext, reinflateBlock } from "./contextCollapse.ts";

function bigJson(seed: string, len: number): string {
  // Build a JSON-shaped string with the given seed and total length ~len.
  const filler = "x".repeat(Math.max(0, len - seed.length - 32));
  return `{"hint":"${seed}","payload":"${filler}"}`;
}

describe("collapseContext", () => {
  it("leaves recent messages untouched", () => {
    const msgs: Message[] = [
      { role: "assistant", content: bigJson("old1", 2000) },
      { role: "assistant", content: bigJson("old2", 2000) },
      { role: "user", content: "What's next?" },
      { role: "assistant", content: "Recent reply" },
    ];
    const r = collapseContext(msgs, { recentMessagesToKeep: 2, minLengthToCollapse: 1000 });
    expect(r.projected[2]).toBe(msgs[2]); // identity preserved
    expect(r.projected[3]).toBe(msgs[3]);
  });

  it("collapses old large tool-result-ish assistant messages", () => {
    const msgs: Message[] = [
      { role: "assistant", content: bigJson("snapshot-1", 3000) },
      { role: "assistant", content: "short reply" },
      { role: "user", content: "ok" },
      { role: "assistant", content: "next" },
    ];
    const r = collapseContext(msgs, { recentMessagesToKeep: 2, minLengthToCollapse: 1000 });
    expect(r.collapsedBlocks.length).toBe(1);
    expect(r.collapsedBlocks[0]?.messageIndex).toBe(0);
    expect(r.projected[0]?.content.startsWith("[CONTEXT_COLLAPSED")).toBe(true);
    expect(r.projected[1]?.content).toBe("short reply");
    expect(r.bytesReduced).toBeGreaterThan(2000);
  });

  it("does not collapse short messages even if old", () => {
    const msgs: Message[] = Array.from({ length: 10 }, (_, i) => ({
      role: "assistant" as const,
      content: `short message ${i}`,
    }));
    const r = collapseContext(msgs, { recentMessagesToKeep: 2 });
    expect(r.collapsedBlocks.length).toBe(0);
    expect(r.bytesReduced).toBe(0);
  });

  it("does not collapse free-prose assistant text (no tool-result heuristic match)", () => {
    const longProse =
      "This is a long piece of trading commentary discussing the macro outlook, " +
      "elaborating on positioning, drawing analogies to past cycles. ".repeat(40);
    const msgs: Message[] = [
      { role: "assistant", content: longProse },
      { role: "user", content: "thanks" },
      { role: "assistant", content: "yw" },
    ];
    const r = collapseContext(msgs, { recentMessagesToKeep: 1, minLengthToCollapse: 1000 });
    expect(r.collapsedBlocks.length).toBe(0);
  });

  it("respects the user-message opt-out by default", () => {
    const msgs: Message[] = [
      { role: "user", content: bigJson("user-paste", 3000) },
      { role: "assistant", content: "ok" },
      { role: "user", content: "next" },
    ];
    const r = collapseContext(msgs, { recentMessagesToKeep: 1, minLengthToCollapse: 1000 });
    expect(r.collapsedBlocks.length).toBe(0);
    const r2 = collapseContext(msgs, {
      recentMessagesToKeep: 1,
      minLengthToCollapse: 1000,
      collapseUserMessages: true,
    });
    expect(r2.collapsedBlocks.length).toBe(1);
  });

  it("placeholder is bounded by placeholderMaxChars", () => {
    const msgs: Message[] = [
      { role: "assistant", content: bigJson("really-long-hint-line".repeat(20), 5000) },
      { role: "assistant", content: "fresh" },
    ];
    const r = collapseContext(msgs, { recentMessagesToKeep: 1, placeholderMaxChars: 80 });
    expect(r.projected[0]!.content.length).toBeLessThanOrEqual(80 + 100); // placeholder + metadata header
  });

  it("reinflateBlock recovers original content by hash", () => {
    const original = bigJson("recoverable", 2500);
    const msgs: Message[] = [
      { role: "assistant", content: original },
      { role: "assistant", content: "later" },
    ];
    const r = collapseContext(msgs, { recentMessagesToKeep: 1, minLengthToCollapse: 1000 });
    const hash = r.collapsedBlocks[0]?.hash;
    expect(hash).toBeDefined();
    expect(reinflateBlock(r.collapsedBlocks, hash!)).toBe(original);
    expect(reinflateBlock(r.collapsedBlocks, "deadbeef")).toBeUndefined();
  });

  it("hash is stable for identical content", () => {
    const content = bigJson("same", 2000);
    const a = collapseContext(
      [{ role: "assistant", content }, { role: "user", content: "x" }],
      { recentMessagesToKeep: 1 },
    );
    const b = collapseContext(
      [{ role: "assistant", content }, { role: "user", content: "y" }],
      { recentMessagesToKeep: 1 },
    );
    expect(a.collapsedBlocks[0]?.hash).toBe(b.collapsedBlocks[0]?.hash);
  });
});
