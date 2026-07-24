import { describe, it, expect } from "bun:test";
import {
  evaluateTripleScreen,
  tripleScreenToPayload,
} from "./tripleScreen.ts";

describe("evaluateTripleScreen — gating", () => {
  it("flat major trend → no_trade", () => {
    const r = evaluateTripleScreen({
      majorTrend: "flat",
      oscillator: "oversold",
      entryTrigger: "buy",
    });
    expect(r.verdict).toBe("no_trade");
    expect(r.blockedBy).toBe("trend");
  });

  it("up + overbought → no_trade (late buy refused)", () => {
    const r = evaluateTripleScreen({
      majorTrend: "up",
      oscillator: "overbought",
      entryTrigger: "buy",
    });
    expect(r.verdict).toBe("no_trade");
    expect(r.blockedBy).toBe("oscillator");
  });

  it("up + neutral → wait", () => {
    const r = evaluateTripleScreen({
      majorTrend: "up",
      oscillator: "neutral",
      entryTrigger: "buy",
    });
    expect(r.verdict).toBe("wait");
  });

  it("up + oversold + no trigger → wait", () => {
    const r = evaluateTripleScreen({
      majorTrend: "up",
      oscillator: "oversold",
      entryTrigger: "none",
    });
    expect(r.verdict).toBe("wait");
    expect(r.blockedBy).toBe("trigger");
  });

  it("up + oversold + buy trigger → long_entry", () => {
    const r = evaluateTripleScreen({
      majorTrend: "up",
      oscillator: "oversold",
      entryTrigger: "buy",
    });
    expect(r.verdict).toBe("long_entry");
    expect(r.blockedBy).toBeNull();
  });

  it("down + oversold → no_trade (late short refused)", () => {
    const r = evaluateTripleScreen({
      majorTrend: "down",
      oscillator: "oversold",
      entryTrigger: "sell",
    });
    expect(r.verdict).toBe("no_trade");
    expect(r.blockedBy).toBe("oscillator");
  });

  it("down + overbought + sell trigger → short_entry", () => {
    const r = evaluateTripleScreen({
      majorTrend: "down",
      oscillator: "overbought",
      entryTrigger: "sell",
    });
    expect(r.verdict).toBe("short_entry");
  });

  it("up trend with sell trigger blocks at trigger stage", () => {
    const r = evaluateTripleScreen({
      majorTrend: "up",
      oscillator: "oversold",
      entryTrigger: "sell",
    });
    expect(r.verdict).toBe("wait");
    expect(r.blockedBy).toBe("trigger");
  });
});

describe("tripleScreenToPayload", () => {
  it("emits a stable shape", () => {
    const r = evaluateTripleScreen({
      majorTrend: "up",
      oscillator: "oversold",
      entryTrigger: "buy",
    });
    const p = tripleScreenToPayload(r) as { kind: string; verdict: string };
    expect(p.kind).toBe("triple_screen.evaluated");
    expect(p.verdict).toBe("long_entry");
  });
});
