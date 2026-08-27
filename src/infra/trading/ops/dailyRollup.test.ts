import { describe, it, expect, beforeEach } from "bun:test";
import { appendFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildRollup, formatRollup, rollupToPayload } from "./dailyRollup.ts";

let workDir: string;
let decPath: string;
let debPath: string;
let fricPath: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "rollup-"));
  decPath = join(workDir, "decisions.jsonl");
  debPath = join(workDir, "debriefs.jsonl");
  fricPath = join(workDir, "friction.jsonl");
});

const cleanup = () => {
  try {
    rmSync(workDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
};

const writeRow = (path: string, row: Record<string, unknown>) =>
  appendFileSync(path, `${JSON.stringify(row)}\n`, "utf8");

describe("buildRollup — empty inputs", () => {
  it("returns zero counts when no files exist", () => {
    const r = buildRollup({ nowMs: Date.now() });
    expect(r.decisionCount).toBe(0);
    expect(r.frictionUsdTotal).toBe(0);
    expect(r.toxicAlphaWarning).toBe(false);
  });
});

describe("buildRollup — window filtering", () => {
  it("includes rows within window, excludes older", () => {
    const now = 1_700_000_000_000;
    const inside = new Date(now - 6 * 60 * 60_000).toISOString();
    const outside = new Date(now - 48 * 60 * 60_000).toISOString();
    writeRow(decPath, { recordedAt: inside, category: "execution" });
    writeRow(decPath, { recordedAt: outside, category: "execution" });
    const r = buildRollup({ decisionsPath: decPath, nowMs: now });
    expect(r.decisionCount).toBe(1);
    cleanup();
  });
});

describe("buildRollup — debrief aggregation", () => {
  it("counts quadrants and emits reinforce/fix recommendations", () => {
    const now = 1_700_000_000_000;
    const recent = new Date(now - 3 * 60 * 60_000).toISOString();
    writeRow(debPath, {
      recordedAt: recent,
      quadrant: "deserved_success",
      symbol: "BTC",
      tradeId: "t1",
    });
    writeRow(debPath, {
      recordedAt: recent,
      quadrant: "deserved_success",
      symbol: "ETH",
      tradeId: "t2",
    });
    writeRow(debPath, { recordedAt: recent, quadrant: "dumb_luck", symbol: "SOL", tradeId: "t3" });
    writeRow(debPath, {
      recordedAt: recent,
      quadrant: "poetic_justice",
      symbol: "DOGE",
      tradeId: "t4",
    });
    const r = buildRollup({ debriefsPath: debPath, nowMs: now });
    expect(r.debriefCounts.deserved_success).toBe(2);
    expect(r.debriefCounts.dumb_luck).toBe(1);
    expect(r.reinforcements.length).toBe(2);
    expect(r.fixes.length).toBe(2);
    expect(r.fixes.some((f) => f.includes("extinguish"))).toBe(true);
    cleanup();
  });

  it("toxic alpha alarm fires when dumb_luck > 20% of wins", () => {
    const now = Date.now();
    const recent = new Date(now - 1 * 60 * 60_000).toISOString();
    writeRow(debPath, {
      recordedAt: recent,
      quadrant: "deserved_success",
      symbol: "BTC",
      tradeId: "t1",
    });
    writeRow(debPath, {
      recordedAt: recent,
      quadrant: "deserved_success",
      symbol: "ETH",
      tradeId: "t2",
    });
    writeRow(debPath, { recordedAt: recent, quadrant: "dumb_luck", symbol: "SOL", tradeId: "t3" });
    const r = buildRollup({ debriefsPath: debPath, nowMs: now });
    expect(r.toxicAlphaWarning).toBe(true);
    cleanup();
  });
});

describe("buildRollup — friction aggregation", () => {
  it("sums costUsd across friction rows in window", () => {
    const now = Date.now();
    const recent = new Date(now - 1 * 60 * 60_000).toISOString();
    writeRow(fricPath, { recordedAt: recent, costUsd: 25 });
    writeRow(fricPath, { recordedAt: recent, costUsd: 12.5 });
    writeRow(fricPath, { recordedAt: recent, costUsd: 7.25 });
    const r = buildRollup({ frictionPath: fricPath, nowMs: now });
    expect(r.frictionUsdTotal).toBeCloseTo(44.75, 2);
    cleanup();
  });
});

describe("buildRollup — custom window", () => {
  it("respects windowHours override", () => {
    const now = 1_700_000_000_000;
    const sixHoursAgo = new Date(now - 6 * 60 * 60_000).toISOString();
    writeRow(decPath, { recordedAt: sixHoursAgo, category: "execution" });
    const r = buildRollup({ decisionsPath: decPath, nowMs: now, windowHours: 4 });
    expect(r.decisionCount).toBe(0);
    cleanup();
  });
});

describe("formatRollup + rollupToPayload", () => {
  it("formats summary and emits stable payload", () => {
    const now = Date.now();
    const recent = new Date(now - 1 * 60 * 60_000).toISOString();
    writeRow(debPath, {
      recordedAt: recent,
      quadrant: "deserved_success",
      symbol: "BTC",
      tradeId: "t1",
    });
    const r = buildRollup({ debriefsPath: debPath, nowMs: now });
    const out = formatRollup(r);
    expect(out).toContain("Daily rollup");
    expect(out).toContain("Reinforce:");
    const p = rollupToPayload(r) as { kind: string };
    expect(p.kind).toBe("daily_rollup.summarized");
    cleanup();
  });
});
