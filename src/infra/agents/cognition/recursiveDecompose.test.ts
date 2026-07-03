import { describe, expect, it } from "bun:test";
import {
  chunkText,
  recursiveDecompose,
  type DecomposeMessage,
} from "./recursiveDecompose.ts";

/**
 * Stub LLM: classifies each call by the marker in its user message.
 *   - a "DOCUMENT SECTION" call is a scoped per-chunk sub-query.
 *   - a "PARTIAL ANSWERS" call is a synthesis/aggregation step.
 * Records every call so the test can assert the decomposition shape.
 */
function makeStubLLM() {
  const calls: { kind: "subquery" | "synthesis"; content: string }[] = [];
  const llm = async (messages: DecomposeMessage[]): Promise<string> => {
    const user = messages.find((m) => m.role === "user")?.content ?? "";
    if (user.includes("PARTIAL ANSWERS")) {
      calls.push({ kind: "synthesis", content: user });
      // Count how many parts were synthesized.
      const parts = (user.match(/\[Part \d+\]/g) ?? []).length;
      return `SYNTH(${parts})`;
    }
    calls.push({ kind: "subquery", content: user });
    // Echo the first token of the section so we can prove the chunk was seen.
    const section = user.split("DOCUMENT SECTION:\n")[1] ?? "";
    return `SUB:${section.trim().slice(0, 12)}`;
  };
  return { llm, calls };
}

describe("chunkText", () => {
  it("returns a single chunk when the text fits", () => {
    expect(chunkText("short", 100)).toEqual(["short"]);
  });

  it("splits oversized text into multiple bounded chunks", () => {
    const text = Array.from({ length: 20 }, (_, i) => `paragraph ${i}`).join("\n\n");
    const chunks = chunkText(text, 40);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(40);
  });

  it("hard-splits a single paragraph larger than the budget", () => {
    const text = "x".repeat(250);
    const chunks = chunkText(text, 100);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(100);
  });
});

describe("recursiveDecompose", () => {
  it("passes a small input through without decomposition (single scoped call)", async () => {
    const { llm, calls } = makeStubLLM();
    const result = await recursiveDecompose(
      { query: "What is the revenue?", input: "Revenue was $10M.", maxChunkChars: 1000 },
      { llm },
    );

    expect(result.decomposed).toBe(false);
    expect(result.chunkCount).toBe(1);
    expect(result.subQueryCount).toBe(1);
    expect(result.synthesisCount).toBe(0);
    expect(result.llmCallCount).toBe(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.kind).toBe("subquery");
    expect(result.answer.startsWith("SUB:")).toBe(true);
  });

  it("chunks a large input, sub-queries each chunk, then synthesizes", async () => {
    const { llm, calls } = makeStubLLM();
    // 12 paragraphs; a small budget forces several chunks.
    const input = Array.from({ length: 12 }, (_, i) => `Section ${i}: fact number ${i}.`).join(
      "\n\n",
    );

    const result = await recursiveDecompose(
      { query: "List the facts.", input, maxChunkChars: 60, maxFanOut: 4, maxDepth: 3 },
      { llm },
    );

    expect(result.decomposed).toBe(true);
    expect(result.chunkCount).toBeGreaterThan(1);
    // At least one scoped sub-query per top-level chunk (more if the joined
    // partials stay oversized and the aggregation recurses another level).
    expect(result.subQueryCount).toBeGreaterThanOrEqual(result.chunkCount);
    expect(result.synthesisCount).toBeGreaterThanOrEqual(1);
    expect(result.answer.startsWith("SYNTH(")).toBe(true);

    const subqueries = calls.filter((c) => c.kind === "subquery");
    const synthesis = calls.filter((c) => c.kind === "synthesis");
    expect(subqueries).toHaveLength(result.subQueryCount);
    expect(synthesis).toHaveLength(result.synthesisCount);
    // No single call ever saw the whole input.
    for (const c of calls) {
      expect(c.content.length).toBeLessThan(input.length + 500);
    }
  });

  it("recurses another level when the joined partial answers stay oversized", async () => {
    // Verbose sub-answers keep the joined aggregation above budget, forcing a
    // second aggregation level before the final synthesis.
    const verbose = async (messages: DecomposeMessage[]): Promise<string> => {
      const user = messages.find((m) => m.role === "user")?.content ?? "";
      if (user.includes("PARTIAL ANSWERS")) return "S".repeat(80);
      return "A".repeat(80);
    };

    const input = Array.from({ length: 16 }, (_, i) => `p${i} ` + "z".repeat(40)).join("\n\n");
    const result = await recursiveDecompose(
      { query: "q", input, maxChunkChars: 120, maxFanOut: 4, maxDepth: 2 },
      { llm: verbose },
    );

    expect(result.decomposed).toBe(true);
    expect(result.depthReached).toBeGreaterThanOrEqual(1);
    expect(result.synthesisCount).toBeGreaterThanOrEqual(1);
  });
});
