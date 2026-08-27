import { describe, it, expect } from "bun:test";
import { TurnSummaryRingBuffer, buildTurnSummary } from "./turnSummary.ts";

const NOW = 1_700_000_000_000;

describe("buildTurnSummary", () => {
  it("captures the user prompt head and assistant head", () => {
    const s = buildTurnSummary(
      { role: "user", content: "What's the regime on ETH right now?" },
      { role: "assistant", content: "ETH is in a ranging regime with low volatility." },
      { now: () => NOW },
    );
    expect(s.userPrompt).toBe("What's the regime on ETH right now?");
    expect(s.assistantHead).toBe("ETH is in a ranging regime with low volatility.");
    expect(s.completedAt).toBe(NOW);
  });

  it("truncates long prompts and replies with ellipsis", () => {
    const long = "x".repeat(500);
    const s = buildTurnSummary(
      { role: "user", content: long },
      { role: "assistant", content: long },
      { now: () => NOW },
    );
    expect(s.userPrompt.length).toBeLessThanOrEqual(80);
    expect(s.userPrompt.endsWith("…")).toBe(true);
    expect(s.assistantHead.length).toBeLessThanOrEqual(120);
  });

  it("classifies intent — long / short / scan / question / other", () => {
    const long = buildTurnSummary(
      { role: "user", content: "Buy 0.1 BTC" },
      { role: "assistant", content: "" },
    );
    expect(long.intent).toBe("long");

    const short = buildTurnSummary(
      { role: "user", content: "Sell my ETH position" },
      { role: "assistant", content: "" },
    );
    expect(short.intent).toBe("short");

    const scan = buildTurnSummary(
      { role: "user", content: "Scan top movers today" },
      { role: "assistant", content: "" },
    );
    expect(scan.intent).toBe("scan");

    const question = buildTurnSummary(
      { role: "user", content: "What is the current regime?" },
      { role: "assistant", content: "" },
    );
    expect(question.intent).toBe("question");

    const other = buildTurnSummary(
      { role: "user", content: "ok" },
      { role: "assistant", content: "" },
    );
    expect(other.intent).toBe("other");
  });

  it("counts tool calls and picks the dominant tool", () => {
    const content = "Calling [tool:get_price]; then [tool:get_price]; then [tool:get_chart]";
    const s = buildTurnSummary({ role: "user", content: "x" }, { role: "assistant", content });
    expect(s.toolCallCount).toBe(3);
    expect(s.dominantTool).toBe("get_price");
  });

  it("returns no dominantTool when content has no tool calls", () => {
    const s = buildTurnSummary(
      { role: "user", content: "x" },
      { role: "assistant", content: "just prose" },
    );
    expect(s.toolCallCount).toBe(0);
    expect(s.dominantTool).toBeUndefined();
  });
});

describe("TurnSummaryRingBuffer", () => {
  it("returns newest-first via list()", () => {
    const buf = new TurnSummaryRingBuffer(10);
    for (let i = 0; i < 3; i++) {
      buf.push(
        buildTurnSummary(
          { role: "user", content: `msg ${i}` },
          { role: "assistant", content: "" },
          { now: () => NOW + i },
        ),
      );
    }
    const ordered = buf.list();
    expect(ordered.length).toBe(3);
    expect(ordered[0]?.userPrompt).toBe("msg 2");
    expect(ordered[2]?.userPrompt).toBe("msg 0");
  });

  it("respects capacity (oldest dropped)", () => {
    const buf = new TurnSummaryRingBuffer(2);
    for (let i = 0; i < 5; i++) {
      buf.push(
        buildTurnSummary(
          { role: "user", content: `msg ${i}` },
          { role: "assistant", content: "" },
          { now: () => NOW + i },
        ),
      );
    }
    expect(buf.size()).toBe(2);
    const ordered = buf.list();
    expect(ordered[0]?.userPrompt).toBe("msg 4");
    expect(ordered[1]?.userPrompt).toBe("msg 3");
  });

  it("find() walks newest-first, case-insensitive across prompt + reply", () => {
    const buf = new TurnSummaryRingBuffer();
    buf.push(
      buildTurnSummary(
        { role: "user", content: "scan BTC" },
        { role: "assistant", content: "ranging" },
      ),
    );
    buf.push(
      buildTurnSummary(
        { role: "user", content: "scan ETH" },
        { role: "assistant", content: "trending up" },
      ),
    );
    expect(buf.find("ETH")?.userPrompt).toContain("ETH");
    expect(buf.find("trending")?.assistantHead).toContain("trending");
    expect(buf.find("nope")).toBeUndefined();
  });

  it("limit on list()", () => {
    const buf = new TurnSummaryRingBuffer();
    for (let i = 0; i < 5; i++) {
      buf.push(
        buildTurnSummary(
          { role: "user", content: `m${i}` },
          { role: "assistant", content: "" },
          { now: () => NOW + i },
        ),
      );
    }
    expect(buf.list(2).length).toBe(2);
  });
});
