import { describe, it, expect } from "bun:test";

import {
  isContextAnxietyDetectorEnabled,
  detectAnxiety,
  formatAnxietyVerdict,
  verdictToPayload,
  CONTEXT_ANXIETY_FLAG_ENV,
  type AgentTurn,
} from "./contextAnxietyDetector.ts";

function turn(index: number, text: string, toolCalls = 1): AgentTurn {
  return { index, text, toolCalls };
}

const LONG_TEXT = "I am working through the problem step by step. ".repeat(30);

describe("isContextAnxietyDetectorEnabled", () => {
  it("respects the flag", () => {
    expect(isContextAnxietyDetectorEnabled({})).toBe(false);
    expect(isContextAnxietyDetectorEnabled({ [CONTEXT_ANXIETY_FLAG_ENV]: "1" })).toBe(true);
    expect(isContextAnxietyDetectorEnabled({ [CONTEXT_ANXIETY_FLAG_ENV]: "true" })).toBe(true);
  });
});

describe("detectAnxiety — empty input", () => {
  it("returns clear verdict with zero score", () => {
    const v = detectAnxiety([]);
    expect(v.isAnxious).toBe(false);
    expect(v.anxiety).toBe(0);
    expect(v.signals).toEqual([]);
  });
});

describe("detectAnxiety — wrap-up phrases", () => {
  it("flags 'to summarize' mid-stream", () => {
    const history = [
      turn(1, LONG_TEXT),
      turn(2, LONG_TEXT),
      turn(3, "To summarize: we are done."),
    ];
    const v = detectAnxiety(history);
    expect(v.isAnxious).toBe(true);
    expect(v.signals.some((s) => s.type === "wrap_up_phrase")).toBe(true);
  });

  it("flags 'in conclusion' phrase", () => {
    const v = detectAnxiety([turn(0, LONG_TEXT), turn(1, "In conclusion, this looks good.")]);
    expect(v.signals.some((s) => s.type === "wrap_up_phrase")).toBe(true);
  });

  it("flags 'wrapping this up'", () => {
    const v = detectAnxiety([turn(0, LONG_TEXT), turn(1, "Let me wrap this up now.")]);
    expect(v.signals.some((s) => s.type === "wrap_up_phrase")).toBe(true);
  });

  it("does NOT flag normal text without wrap-up markers", () => {
    const v = detectAnxiety([
      turn(0, "Investigating the order book."),
      turn(1, "Checking the latest prices."),
      turn(2, "Computing the next signal."),
    ]);
    expect(v.signals.some((s) => s.type === "wrap_up_phrase")).toBe(false);
  });
});

describe("detectAnxiety — context self-reference (strongest signal)", () => {
  it("flags 'running low on context'", () => {
    const v = detectAnxiety([turn(0, "I'm running low on context, so I'll be brief.")]);
    expect(v.isAnxious).toBe(true);
    expect(v.signals.some((s) => s.type === "context_self_ref")).toBe(true);
  });

  it("flags 'to save tokens'", () => {
    const v = detectAnxiety([turn(0, "To save tokens, I'll skip the verification.")]);
    expect(v.signals.some((s) => s.type === "context_self_ref")).toBe(true);
  });

  it("flags 'context window'", () => {
    const v = detectAnxiety([turn(0, "Given the context window, I should stop.")]);
    expect(v.signals.some((s) => s.type === "context_self_ref")).toBe(true);
  });

  it("context self-ref drives a strong recommendation", () => {
    const v = detectAnxiety([turn(0, "Running low on context.")]);
    expect(v.recommendation).toContain("clean context window");
  });
});

describe("detectAnxiety — output length drop", () => {
  it("flags sharp drop in average output length", () => {
    const history: AgentTurn[] = [];
    for (let i = 0; i < 5; i++) history.push(turn(i, LONG_TEXT));
    history.push(turn(5, "Done."));
    history.push(turn(6, "OK."));
    history.push(turn(7, "Bye."));
    const v = detectAnxiety(history);
    expect(v.signals.some((s) => s.type === "output_length_drop")).toBe(true);
  });

  it("does NOT flag steady output", () => {
    const history: AgentTurn[] = [];
    for (let i = 0; i < 8; i++) history.push(turn(i, LONG_TEXT));
    const v = detectAnxiety(history);
    expect(v.signals.some((s) => s.type === "output_length_drop")).toBe(false);
  });
});

describe("detectAnxiety — tool density drop", () => {
  it("flags sharp drop in tool-call density", () => {
    const history: AgentTurn[] = [];
    for (let i = 0; i < 5; i++) history.push(turn(i, "x", 5));
    for (let i = 5; i < 8; i++) history.push(turn(i, "x", 0));
    const v = detectAnxiety(history);
    expect(v.signals.some((s) => s.type === "tool_density_drop")).toBe(true);
  });

  it("does NOT flag stable tool usage", () => {
    const history: AgentTurn[] = [];
    for (let i = 0; i < 8; i++) history.push(turn(i, "x", 3));
    const v = detectAnxiety(history);
    expect(v.signals.some((s) => s.type === "tool_density_drop")).toBe(false);
  });
});

describe("detectAnxiety — breadth bonus", () => {
  it("scores higher when multiple distinct signal types fire", () => {
    const v = detectAnxiety([
      turn(0, "I am running low on context. Let me wrap this up."),
    ]);
    expect(v.signals.length).toBeGreaterThanOrEqual(2);
    expect(v.anxiety).toBeGreaterThan(0.85);
  });
});

describe("detectAnxiety — threshold override", () => {
  it("respects custom threshold", () => {
    const history = [turn(0, LONG_TEXT), turn(1, "To summarize, done.")];
    // Below threshold
    const strict = detectAnxiety(history, { threshold: 0.95 });
    expect(strict.isAnxious).toBe(false);
    // Above threshold
    const lenient = detectAnxiety(history, { threshold: 0.3 });
    expect(lenient.isAnxious).toBe(true);
  });
});

describe("detectAnxiety — recommendation routing", () => {
  it("clean-context recommendation when self-ref is the dominant signal", () => {
    const v = detectAnxiety([turn(0, "I'm running low on context.")]);
    expect(v.recommendation).toContain("clean context");
  });

  it("interrupt recommendation when wrap-up is the dominant signal", () => {
    const v = detectAnxiety([turn(0, LONG_TEXT), turn(1, "To summarize, this works.")]);
    expect(v.recommendation).toMatch(/interrupt|wrap-up/i);
  });

  it("no action when no signals fire", () => {
    const v = detectAnxiety([turn(0, "Investigating the order book.")]);
    expect(v.recommendation).toContain("no action");
  });
});

describe("formatAnxietyVerdict", () => {
  it("includes verdict + per-signal lines + recommendation", () => {
    const v = detectAnxiety([turn(0, "Running low on context.")]);
    const out = formatAnxietyVerdict(v);
    expect(out).toContain("DETECTED");
    expect(out).toContain("context_self_ref");
    expect(out).toContain("recommendation");
  });
});

describe("verdictToPayload", () => {
  it("emits stable shape", () => {
    const v = detectAnxiety([turn(0, "To summarize, done.")]);
    const p = verdictToPayload(v);
    expect(p.kind).toBe("context_anxiety.verdict_recorded");
    expect(p.isAnxious).toBe(true);
    expect(Array.isArray(p.signalTypes)).toBe(true);
  });
});
