import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TradeOutcome } from "./feedbackLoop.ts";

// GORDON_DIR is resolved at module load — point it at a temp dir BEFORE importing.
const tmpHome = mkdtempSync(join(tmpdir(), "gordon-feedback-test-"));
const prevHome = process.env.GORDON_HOME;
process.env.GORDON_HOME = tmpHome;

const {
  recordTradeOutcome,
  getPatternConfidence,
  getPatternStats,
  getAllPatternStats,
  formatFeedbackForPrompt,
} = await import("./feedbackLoop.ts");

afterAll(() => {
  if (prevHome !== undefined) process.env.GORDON_HOME = prevHome;
  else delete process.env.GORDON_HOME;
  rmSync(tmpHome, { recursive: true, force: true });
});

let seq = 0;
function outcome(
  pattern: string,
  result: TradeOutcome["result"],
  pnlPct?: number,
): TradeOutcome {
  seq++;
  return {
    id: `t${seq}`,
    pattern,
    symbol: "BTC/USDT",
    result,
    pnlUsd: result === "win" ? 50 : result === "loss" ? -50 : 0,
    pnlPct: pnlPct ?? (result === "win" ? 2 : result === "loss" ? -2 : 0),
    holdDurationMs: 60_000,
    closedAt: new Date().toISOString(),
  };
}

function record(pattern: string, results: Array<TradeOutcome["result"]>) {
  let stats;
  for (const r of results) stats = recordTradeOutcome(outcome(pattern, r));
  return stats!;
}

describe("feedbackLoop", () => {
  test("prompt injection is empty before any outcomes exist", () => {
    expect(formatFeedbackForPrompt()).toBe("");
  });

  test("unknown pattern defaults to neutral confidence and null stats", () => {
    expect(getPatternConfidence("never-traded")).toBe(1.0);
    expect(getPatternStats("never-traded")).toBeNull();
  });

  test("fewer than 5 trades stays neutral regardless of results", () => {
    const stats = record("cold-start", ["loss", "loss", "loss", "loss"]);
    expect(stats.totalTrades).toBe(4);
    expect(stats.confidenceMultiplier).toBe(1.0);
  });

  test("5 straight wins upweights to the 1.3 cap path", () => {
    const stats = record("hot-hand", ["win", "win", "win", "win", "win"]);
    expect(stats.streak).toBe(5);
    expect(stats.winRate).toBe(1);
    expect(stats.confidenceMultiplier).toBe(1.3);
  });

  test("20-loss streak floors at 0.4 (streak rule) and never breaches the 0.2 clamp", () => {
    const stats = record("blowup", new Array(20).fill("loss"));
    expect(stats.streak).toBe(-20);
    expect(stats.losses).toBe(20);
    expect(stats.winRate).toBe(0);
    expect(stats.confidenceMultiplier).toBe(0.4);
    expect(stats.confidenceMultiplier).toBeGreaterThanOrEqual(0.2);
  });

  test("low recent win rate without a 3-loss streak downweights to 0.5", () => {
    const stats = record("leaky", ["loss", "loss", "win", "loss", "loss", "win", "loss", "loss"]);
    expect(stats.streak).toBe(-2);
    expect(stats.confidenceMultiplier).toBe(0.5);
  });

  test("3-win streak lifts a mediocre win rate to the 1.2 floor", () => {
    const stats = record("comeback", ["loss", "loss", "loss", "loss", "win", "win", "win"]);
    expect(stats.streak).toBe(3);
    expect(stats.confidenceMultiplier).toBe(1.2);
  });

  test("breakeven resets the streak and is excluded from win rate", () => {
    const stats = record("scratch", ["win", "win", "breakeven"]);
    expect(stats.streak).toBe(0);
    expect(stats.breakevens).toBe(1);
    expect(stats.winRate).toBe(1);
    expect(stats.totalTrades).toBe(3);
  });

  test("recentOutcomes window is capped at 10", () => {
    const stats = record("busy", new Array(12).fill("win"));
    expect(stats.recentOutcomes).toHaveLength(10);
    expect(stats.totalTrades).toBe(12);
  });

  test("winRate is wins over decided trades only", () => {
    const stats = record("decided", ["win", "loss", "loss", "breakeven", "win", "win"]);
    expect(stats.wins).toBe(3);
    expect(stats.losses).toBe(2);
    expect(stats.winRate).toBeCloseTo(3 / 5, 12);
  });

  test("avgPnlPct is an EWMA with alpha 0.15", () => {
    const first = recordTradeOutcome(outcome("ewma", "win", 10));
    expect(first.avgPnlPct).toBeCloseTo(1.5, 12);
    const second = recordTradeOutcome(outcome("ewma", "win", 10));
    expect(second.avgPnlPct).toBeCloseTo(1.5 * 0.85 + 10 * 0.15, 12);
  });

  test("multiplier stays clamped to [0.2, 1.5] across a mixed history", () => {
    const results: Array<TradeOutcome["result"]> = [];
    for (let i = 0; i < 30; i++) {
      results.push(i % 3 === 0 ? "win" : i % 3 === 1 ? "loss" : "breakeven");
    }
    record("churn", results);
    for (const s of getAllPatternStats()) {
      expect(s.confidenceMultiplier).toBeGreaterThanOrEqual(0.2);
      expect(s.confidenceMultiplier).toBeLessThanOrEqual(1.5);
    }
  });

  test("getPatternConfidence reflects the persisted multiplier", () => {
    expect(getPatternConfidence("blowup")).toBe(0.4);
    expect(getPatternConfidence("hot-hand")).toBe(1.3);
  });

  test("getAllPatternStats sorts by trade count descending", () => {
    const all = getAllPatternStats();
    for (let i = 1; i < all.length; i++) {
      expect(all[i - 1]!.totalTrades).toBeGreaterThanOrEqual(all[i]!.totalTrades);
    }
  });

  test("prompt injection surfaces only strong signals, labeled by direction", () => {
    const prompt = formatFeedbackForPrompt();
    expect(prompt).toContain("[GORDON_PATTERN_FEEDBACK]");
    expect(prompt).toContain("blowup: WEAK");
    expect(prompt).toContain("hot-hand: STRONG");
    // 4 trades < the 5-trade notability threshold
    expect(prompt).not.toContain("cold-start");
  });
});
