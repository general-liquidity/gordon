import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  computeExpectancyReport,
  extractRecordPnl,
  wilsonInterval,
  readLedgerRecords,
} from "./expectancyByTag.ts";
import type { ExecutionRecord } from "./tradeLedger.ts";

function makeRecord(
  overrides: Partial<ExecutionRecord> & { pnl?: number; symbol?: string },
): ExecutionRecord {
  const pnl = overrides.pnl ?? 0;
  // Use `in` checks so callers can explicitly set stateBefore/stateAfter
  // to undefined to test missing-snapshot paths. The `??` operator
  // would otherwise fall through to the default for explicit undefined.
  const stateBefore = "stateBefore" in overrides
    ? overrides.stateBefore
    : { realizedPnLUsd: 0 };
  const stateAfter = "stateAfter" in overrides
    ? overrides.stateAfter
    : { realizedPnLUsd: pnl };
  const base: ExecutionRecord = {
    recordId: overrides.recordId ?? `r-${Math.random().toString(36).slice(2, 10)}`,
    priorRecordId: overrides.priorRecordId ?? null,
    timestamp: overrides.timestamp ?? Date.now(),
    symbol: overrides.symbol ?? "BTCUSDT",
    rationale: overrides.rationale ?? "test",
    operations: overrides.operations ?? [{ action: "place_order" }],
    results: overrides.results ?? [],
    stateBefore,
    stateAfter,
    bodyHash: overrides.bodyHash ?? "test-hash",
  };
  return base;
}

describe("extractRecordPnl", () => {
  it("returns delta of realized P&L", () => {
    const record = makeRecord({
      stateBefore: { realizedPnLUsd: 100 },
      stateAfter: { realizedPnLUsd: 150 },
    });
    expect(extractRecordPnl(record)).toBe(50);
  });

  it("returns null when stateBefore is missing realized P&L", () => {
    const record = makeRecord({
      stateBefore: {},
      stateAfter: { realizedPnLUsd: 100 },
    });
    expect(extractRecordPnl(record)).toBeNull();
  });

  it("returns null when stateAfter is missing", () => {
    const record = makeRecord({
      stateBefore: { realizedPnLUsd: 100 },
      stateAfter: undefined,
    });
    expect(extractRecordPnl(record)).toBeNull();
  });

  it("returns null for non-finite values", () => {
    const record = makeRecord({
      stateBefore: { realizedPnLUsd: Infinity },
      stateAfter: { realizedPnLUsd: 100 },
    });
    expect(extractRecordPnl(record)).toBeNull();
  });
});

describe("wilsonInterval", () => {
  it("returns [0, 1] for zero sample size", () => {
    const ci = wilsonInterval(0, 0);
    expect(ci.lower).toBe(0);
    expect(ci.upper).toBe(1);
  });

  it("narrower CI for larger sample", () => {
    const small = wilsonInterval(5, 10);
    const large = wilsonInterval(50, 100);
    expect(large.upper - large.lower).toBeLessThan(small.upper - small.lower);
  });

  it("CI bounds in [0, 1]", () => {
    const ci = wilsonInterval(30, 50);
    expect(ci.lower).toBeGreaterThanOrEqual(0);
    expect(ci.upper).toBeLessThanOrEqual(1);
  });
});

describe("computeExpectancyReport — basic shape", () => {
  it("returns empty report when no records", () => {
    const report = computeExpectancyReport([]);
    expect(report.totalRowsRead).toBe(0);
    expect(report.byTag.length).toBe(0);
    expect(report.bestTag).toBeNull();
    expect(report.worstTag).toBeNull();
  });

  it("groups by symbol by default", () => {
    const records = [
      makeRecord({ symbol: "BTCUSDT", pnl: 100 }),
      makeRecord({ symbol: "BTCUSDT", pnl: -50 }),
      makeRecord({ symbol: "ETHUSDT", pnl: 30 }),
    ];
    const report = computeExpectancyReport(records);
    expect(report.byTag.length).toBe(2);
    const tags = report.byTag.map((t) => t.tag).sort();
    expect(tags).toEqual(["BTCUSDT", "ETHUSDT"]);
  });

  it("computes win/loss counts correctly", () => {
    const records = [
      makeRecord({ symbol: "X", pnl: 100 }),
      makeRecord({ symbol: "X", pnl: 50 }),
      makeRecord({ symbol: "X", pnl: -25 }),
      makeRecord({ symbol: "X", pnl: 0 }), // breakeven
    ];
    const report = computeExpectancyReport(records);
    const tagX = report.byTag.find((t) => t.tag === "X")!;
    expect(tagX.winCount).toBe(2);
    expect(tagX.lossCount).toBe(1);
    expect(tagX.breakevenCount).toBe(1);
    expect(tagX.sampleSize).toBe(4);
  });

  it("computes expectancy formula correctly", () => {
    const records = [
      makeRecord({ symbol: "X", pnl: 100 }),
      makeRecord({ symbol: "X", pnl: 100 }),
      makeRecord({ symbol: "X", pnl: -50 }),
    ];
    const report = computeExpectancyReport(records);
    const tagX = report.byTag.find((t) => t.tag === "X")!;
    // winRate = 2/3, lossRate = 1/3, avgWin = 100, avgLoss = 50
    // expectancy = (2/3)*100 - (1/3)*50 ≈ 50
    expect(tagX.expectancy).toBeCloseTo(50, 2);
  });
});

describe("computeExpectancyReport — significance gating", () => {
  it("labels < 30 samples as insufficient", () => {
    const records = Array.from({ length: 20 }, (_, i) =>
      makeRecord({ symbol: "X", pnl: i % 2 === 0 ? 10 : -5 }),
    );
    const report = computeExpectancyReport(records);
    expect(report.byTag[0]!.significance).toBe("insufficient");
  });

  it("labels 30..49 samples as preliminary", () => {
    const records = Array.from({ length: 35 }, (_, i) =>
      makeRecord({ symbol: "X", pnl: i % 2 === 0 ? 10 : -5 }),
    );
    const report = computeExpectancyReport(records);
    expect(report.byTag[0]!.significance).toBe("preliminary");
  });

  it("labels ≥ 50 samples as robust", () => {
    const records = Array.from({ length: 60 }, (_, i) =>
      makeRecord({ symbol: "X", pnl: i % 2 === 0 ? 10 : -5 }),
    );
    const report = computeExpectancyReport(records);
    expect(report.byTag[0]!.significance).toBe("robust");
  });
});

describe("computeExpectancyReport — best/worst tags", () => {
  it("identifies best and worst tags among robust tiers", () => {
    const records = [
      // Tag A: 50 wins of 10, no losses
      ...Array.from({ length: 50 }, () =>
        makeRecord({ symbol: "A", pnl: 10 }),
      ),
      // Tag B: 50 losses of 5, no wins
      ...Array.from({ length: 50 }, () =>
        makeRecord({ symbol: "B", pnl: -5 }),
      ),
    ];
    const report = computeExpectancyReport(records);
    expect(report.bestTag!.tag).toBe("A");
    expect(report.worstTag!.tag).toBe("B");
  });

  it("excludes insufficient-tier tags from best/worst selection", () => {
    const records = [
      // Tag A: 5 samples (insufficient)
      ...Array.from({ length: 5 }, () =>
        makeRecord({ symbol: "A", pnl: 1000 }),
      ),
      // Tag B: 50 samples (robust), moderately profitable
      ...Array.from({ length: 50 }, () =>
        makeRecord({ symbol: "B", pnl: 5 }),
      ),
    ];
    const report = computeExpectancyReport(records);
    expect(report.bestTag!.tag).toBe("B"); // A is excluded for insufficiency
  });
});

describe("computeExpectancyReport — custom tag function", () => {
  it("groups by custom tag extractor", () => {
    const records = [
      makeRecord({
        operations: [{ action: "place_order" }],
        pnl: 100,
      }),
      makeRecord({
        operations: [{ action: "close_position" }],
        pnl: -20,
      }),
    ];
    const report = computeExpectancyReport(records, {
      getTag: (r) => r.operations[0]?.action ?? "unknown",
    });
    const tags = report.byTag.map((t) => t.tag).sort();
    expect(tags).toContain("place_order");
    expect(tags).toContain("close_position");
  });
});

describe("computeExpectancyReport — missing P&L", () => {
  it("counts rows without P&L separately", () => {
    const records = [
      makeRecord({ symbol: "X", pnl: 100 }),
      makeRecord({
        symbol: "X",
        stateBefore: {},
        stateAfter: { realizedPnLUsd: 50 },
      }),
    ];
    const report = computeExpectancyReport(records);
    expect(report.rowsWithPnl).toBe(1);
    expect(report.rowsMissingPnl).toBe(1);
  });
});

describe("computeExpectancyReport — filter option", () => {
  it("respects pre-filter", () => {
    const records = [
      makeRecord({ symbol: "X", pnl: 100, operations: [{ action: "close_position" }] }),
      makeRecord({ symbol: "X", pnl: -10, operations: [{ action: "place_order" }] }),
    ];
    const report = computeExpectancyReport(records, {
      filter: (r) => r.operations[0]?.action === "close_position",
    });
    expect(report.rowsWithPnl).toBe(1);
    expect(report.byTag[0]!.totalPnl).toBe(100);
  });
});

// ===================== file I/O tests =====================

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "gordon-expectancy-test-"));
});

afterEach(() => {
  try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* */ }
});

describe("readLedgerRecords", () => {
  it("returns empty array when file doesn't exist", () => {
    const records = readLedgerRecords(join(tempDir, "does-not-exist.jsonl"));
    expect(records).toEqual([]);
  });

  it("reads JSONL records", () => {
    const path = join(tempDir, "test-ledger.jsonl");
    const records = [
      makeRecord({ symbol: "BTC", pnl: 10 }),
      makeRecord({ symbol: "ETH", pnl: -5 }),
    ];
    writeFileSync(path, records.map((r) => JSON.stringify(r)).join("\n") + "\n");
    const read = readLedgerRecords(path);
    expect(read.length).toBe(2);
  });

  it("skips malformed JSONL lines silently", () => {
    const path = join(tempDir, "mixed.jsonl");
    writeFileSync(
      path,
      JSON.stringify(makeRecord({ symbol: "X", pnl: 10 })) +
        "\nnot json\n" +
        JSON.stringify(makeRecord({ symbol: "X", pnl: 5 })) +
        "\n",
    );
    const records = readLedgerRecords(path);
    expect(records.length).toBe(2);
  });
});

describe("computeExpectancyReport — summary text", () => {
  it("summary includes trade count + tag count + overall expectancy", () => {
    const records = Array.from({ length: 60 }, (_, i) =>
      makeRecord({ symbol: "X", pnl: i % 2 === 0 ? 10 : -5 }),
    );
    const report = computeExpectancyReport(records);
    expect(report.summary).toContain("60 trades");
    expect(report.summary).toContain("1 tags");
    expect(report.summary).toContain("Overall expectancy");
    expect(report.summary).toContain("Best tag");
  });
});
