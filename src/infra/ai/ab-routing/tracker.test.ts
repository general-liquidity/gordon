import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  recordOutcome,
  readAbTestRecords,
  getAbTestStats,
} from "./tracker.ts";

let tempDir: string;
let ledgerPath: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "gordon-ab-test-"));
  ledgerPath = join(tempDir, "ledger.jsonl");
  delete process.env.GORDON_MODEL_AB_DISABLED;
});

afterEach(() => {
  try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* */ }
  delete process.env.GORDON_MODEL_AB_DISABLED;
});

function seed(records: Array<{ variantId: string; accepted: boolean; testId?: string }>): void {
  const lines = records.map((r, i) => {
    const ts = new Date(Date.now() - (records.length - i) * 1000).toISOString();
    return JSON.stringify({
      timestamp: ts,
      testId: r.testId ?? "main",
      variantId: r.variantId,
      invocationId: `inv-${i}`,
      outcome: { accepted: r.accepted },
    });
  });
  writeFileSync(ledgerPath, lines.join("\n") + "\n");
}

describe("recordOutcome", () => {
  it("appends a JSONL row", () => {
    recordOutcome("t1", "v-a", "inv-1", { accepted: true }, { path: ledgerPath });
    const records = readAbTestRecords("t1", { path: ledgerPath });
    expect(records.length).toBe(1);
    expect(records[0]!.variantId).toBe("v-a");
    expect(records[0]!.outcome.accepted).toBe(true);
  });

  it("records context when supplied", () => {
    recordOutcome("t1", "v-a", "inv-1", { accepted: false, context: "plan-rejected" }, { path: ledgerPath });
    const records = readAbTestRecords("t1", { path: ledgerPath });
    expect(records[0]!.outcome.context).toBe("plan-rejected");
  });

  it("env-disable suppresses writes", () => {
    process.env.GORDON_MODEL_AB_DISABLED = "1";
    recordOutcome("t1", "v-a", "inv-1", { accepted: true }, { path: ledgerPath });
    const records = readAbTestRecords("t1", { path: ledgerPath });
    expect(records.length).toBe(0);
  });

  it("silent on I/O failure (bad path)", () => {
    expect(() =>
      recordOutcome("t1", "v-a", "inv-1", { accepted: true }, { path: "/proc/nope/x.jsonl" }),
    ).not.toThrow();
  });
});

describe("readAbTestRecords", () => {
  it("returns empty when file doesn't exist", () => {
    expect(readAbTestRecords("t1", { path: join(tempDir, "nope.jsonl") })).toEqual([]);
  });

  it("filters by testId", () => {
    seed([
      { variantId: "a", accepted: true, testId: "main" },
      { variantId: "a", accepted: true, testId: "other" },
      { variantId: "b", accepted: false, testId: "main" },
    ]);
    const records = readAbTestRecords("main", { path: ledgerPath });
    expect(records.length).toBe(2);
    expect(records.every((r) => r.testId === "main")).toBe(true);
  });

  it("skips malformed lines", () => {
    writeFileSync(
      ledgerPath,
      JSON.stringify({
        timestamp: "2026-05-23T00:00:00Z",
        testId: "main",
        variantId: "a",
        invocationId: "x",
        outcome: { accepted: true },
      }) +
        "\nnot json\n" +
        JSON.stringify({
          timestamp: "2026-05-23T00:00:01Z",
          testId: "main",
          variantId: "a",
          invocationId: "y",
          outcome: { accepted: false },
        }) +
        "\n",
    );
    expect(readAbTestRecords("main", { path: ledgerPath }).length).toBe(2);
  });

  it("respects sinceIso filter", () => {
    seed([
      { variantId: "a", accepted: true },
      { variantId: "a", accepted: false },
      { variantId: "b", accepted: true },
    ]);
    const allRecords = readAbTestRecords("main", { path: ledgerPath });
    expect(allRecords.length).toBe(3);
    // Filter to only records strictly after the second-most-recent
    const cutoff = allRecords[1]!.timestamp;
    const filtered = readAbTestRecords("main", { path: ledgerPath, sinceIso: cutoff });
    expect(filtered.length).toBeLessThanOrEqual(2);
  });
});

describe("getAbTestStats — aggregation", () => {
  it("returns empty stats when no records", () => {
    const stats = getAbTestStats("nothing", { path: ledgerPath });
    expect(stats.totalRecords).toBe(0);
    expect(stats.variants).toEqual([]);
    expect(stats.significantWinner).toBeNull();
  });

  it("aggregates per-variant counts + acceptance rate", () => {
    seed([
      { variantId: "a", accepted: true },
      { variantId: "a", accepted: true },
      { variantId: "a", accepted: false },
      { variantId: "b", accepted: false },
      { variantId: "b", accepted: false },
    ]);
    const stats = getAbTestStats("main", { path: ledgerPath });
    const a = stats.variants.find((v) => v.variantId === "a")!;
    const b = stats.variants.find((v) => v.variantId === "b")!;
    expect(a.totalInvocations).toBe(3);
    expect(a.acceptedCount).toBe(2);
    expect(a.acceptanceRate).toBeCloseTo(2 / 3, 4);
    expect(b.totalInvocations).toBe(2);
    expect(b.acceptedCount).toBe(0);
    expect(b.acceptanceRate).toBe(0);
  });

  it("sorts variants by acceptance rate descending", () => {
    seed([
      { variantId: "loser", accepted: false },
      { variantId: "loser", accepted: false },
      { variantId: "winner", accepted: true },
      { variantId: "winner", accepted: true },
    ]);
    const stats = getAbTestStats("main", { path: ledgerPath });
    expect(stats.variants[0]!.variantId).toBe("winner");
    expect(stats.variants[1]!.variantId).toBe("loser");
  });
});

describe("getAbTestStats — significant winner", () => {
  it("returns null when CIs overlap (small sample)", () => {
    seed([
      { variantId: "a", accepted: true },
      { variantId: "a", accepted: false },
      { variantId: "b", accepted: true },
      { variantId: "b", accepted: false },
    ]);
    const stats = getAbTestStats("main", { path: ledgerPath });
    expect(stats.significantWinner).toBeNull();
  });

  it("returns null when only one variant has records", () => {
    seed([{ variantId: "a", accepted: true }, { variantId: "a", accepted: true }]);
    const stats = getAbTestStats("main", { path: ledgerPath });
    expect(stats.significantWinner).toBeNull();
  });

  it("returns winner id when CI separation is clear with sufficient n", () => {
    const recs: Array<{ variantId: string; accepted: boolean }> = [];
    for (let i = 0; i < 50; i++) recs.push({ variantId: "winner", accepted: true });
    for (let i = 0; i < 50; i++) recs.push({ variantId: "loser", accepted: false });
    seed(recs);
    const stats = getAbTestStats("main", { path: ledgerPath });
    expect(stats.significantWinner).toBe("winner");
  });

  it("requires minimum sample size (≥10) before declaring winner", () => {
    seed([
      { variantId: "a", accepted: true },
      { variantId: "a", accepted: true },
      { variantId: "b", accepted: false },
    ]);
    const stats = getAbTestStats("main", { path: ledgerPath });
    // Even though a's 2/2 = 100% and b's 0/1 = 0%, small sample = no winner declared
    expect(stats.significantWinner).toBeNull();
  });
});

describe("getAbTestStats — summary text", () => {
  it("includes test id + variant breakdown", () => {
    seed([
      { variantId: "a", accepted: true },
      { variantId: "a", accepted: false },
      { variantId: "b", accepted: true },
    ]);
    const stats = getAbTestStats("main", { path: ledgerPath });
    expect(stats.summary).toContain("main");
    expect(stats.summary).toContain("a");
    expect(stats.summary).toContain("b");
    expect(stats.summary).toContain("no significant winner");
  });

  it("notes the significant winner when present", () => {
    const recs: Array<{ variantId: string; accepted: boolean }> = [];
    for (let i = 0; i < 40; i++) recs.push({ variantId: "winner", accepted: true });
    for (let i = 0; i < 40; i++) recs.push({ variantId: "loser", accepted: false });
    seed(recs);
    const stats = getAbTestStats("main", { path: ledgerPath });
    expect(stats.summary).toContain("winner: winner");
  });

  it("handles empty record set", () => {
    const stats = getAbTestStats("absent", { path: ledgerPath });
    expect(stats.summary).toContain("no records yet");
  });
});
