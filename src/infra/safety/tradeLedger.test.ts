import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildExecutionRecord,
  appendExecutionRecord,
  appendExecutionRecordFresh,
  readExecutionRecords,
  getExecutionRecord,
  lastRecordId,
  executionRecordToPayload,
  type ExecutionOperation,
  type ExecutionResult,
} from "./tradeLedger.ts";

const OPS: ExecutionOperation[] = [
  { action: "place_order", symbol: "BTC", side: "buy", qty: 0.5, price: 60000 },
];

const RESULTS: ExecutionResult[] = [
  { operationIndex: 0, status: "filled", filledQty: 0.5, filledPrice: 60010 },
];

const INPUT_BASE = {
  priorRecordId: null,
  rationale: "test rationale meeting min length",
  operations: OPS,
  results: RESULTS,
};

describe("buildExecutionRecord — validation", () => {
  it("throws on rationale shorter than 10 chars", () => {
    expect(() =>
      buildExecutionRecord({ ...INPUT_BASE, rationale: "too short" }),
    ).toThrow();
  });

  it("throws on empty operations array", () => {
    expect(() =>
      buildExecutionRecord({ ...INPUT_BASE, operations: [] }),
    ).toThrow();
  });
});

describe("buildExecutionRecord — fields", () => {
  it("assigns recordId, timestamp, bodyHash automatically", () => {
    const r = buildExecutionRecord(INPUT_BASE);
    expect(r.recordId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(Number.isFinite(r.timestamp)).toBe(true);
    expect(r.bodyHash).toMatch(/^[0-9a-f]{16}$/i);
  });

  it("honors recordIdOverride for deterministic replay", () => {
    const r = buildExecutionRecord({
      ...INPUT_BASE,
      recordIdOverride: "test-id-1234",
      timestamp: 1716240000000,
    });
    expect(r.recordId).toBe("test-id-1234");
    expect(r.timestamp).toBe(1716240000000);
  });

  it("preserves rationale + symbol + planId + acknowledgedRisks", () => {
    const r = buildExecutionRecord({
      ...INPUT_BASE,
      planId: "plan-42",
      symbol: "BTC",
      acknowledgedRisks: ["vol-spike acceptable for 1h horizon"],
    });
    expect(r.planId).toBe("plan-42");
    expect(r.symbol).toBe("BTC");
    expect(r.acknowledgedRisks).toEqual(["vol-spike acceptable for 1h horizon"]);
  });

  it("freezes the returned record", () => {
    const r = buildExecutionRecord(INPUT_BASE);
    expect(Object.isFrozen(r)).toBe(true);
  });

  it("captures stateBefore + stateAfter when provided", () => {
    const r = buildExecutionRecord({
      ...INPUT_BASE,
      stateBefore: { netLiquidationUsd: 10_000 },
      stateAfter: { netLiquidationUsd: 9_998.5 },
    });
    expect(r.stateBefore?.netLiquidationUsd).toBe(10_000);
    expect(r.stateAfter?.netLiquidationUsd).toBe(9_998.5);
  });

  it("array fields are copies — caller mutations don't bleed in", () => {
    const ops: ExecutionOperation[] = [...OPS];
    const r = buildExecutionRecord({ ...INPUT_BASE, operations: ops });
    ops.push({ action: "place_order", symbol: "ETH", side: "buy", qty: 1 });
    expect(r.operations.length).toBe(1);
  });
});

// ---------------- persistence (uses a tmp dir) -----------------

describe("appendExecutionRecord + readExecutionRecords", () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "gordon-ledger-test-"));
    path = join(dir, "ledger.jsonl");
  });

  afterEach(() => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  });

  it("appends a record + reads it back", async () => {
    const r = buildExecutionRecord(INPUT_BASE);
    await appendExecutionRecord(r, path);
    const all = await readExecutionRecords({}, path);
    expect(all.length).toBe(1);
    expect(all[0]!.recordId).toBe(r.recordId);
    expect(all[0]!.bodyHash).toBe(r.bodyHash);
  });

  it("reads empty array when file does not exist", async () => {
    const empty = await readExecutionRecords({}, join(dir, "does-not-exist.jsonl"));
    expect(empty).toEqual([]);
  });

  it("filters by symbol", async () => {
    await appendExecutionRecord(
      buildExecutionRecord({ ...INPUT_BASE, symbol: "BTC" }),
      path,
    );
    await appendExecutionRecord(
      buildExecutionRecord({ ...INPUT_BASE, symbol: "ETH" }),
      path,
    );
    const btc = await readExecutionRecords({ symbol: "BTC" }, path);
    expect(btc.length).toBe(1);
    expect(btc[0]!.symbol).toBe("BTC");
  });

  it("filters by sinceMs (returns only newer)", async () => {
    await appendExecutionRecord(
      buildExecutionRecord({ ...INPUT_BASE, timestamp: 1000, symbol: "A" }),
      path,
    );
    await appendExecutionRecord(
      buildExecutionRecord({ ...INPUT_BASE, timestamp: 5000, symbol: "B" }),
      path,
    );
    const newer = await readExecutionRecords({ sinceMs: 2000 }, path);
    expect(newer.length).toBe(1);
    expect(newer[0]!.symbol).toBe("B");
  });

  it("limit returns the most recent N", async () => {
    for (let i = 0; i < 5; i++) {
      await appendExecutionRecord(
        buildExecutionRecord({ ...INPUT_BASE, symbol: `S${i}`, timestamp: i + 1 }),
        path,
      );
    }
    const last2 = await readExecutionRecords({ limit: 2 }, path);
    expect(last2.length).toBe(2);
    expect(last2.map((r) => r.symbol)).toEqual(["S3", "S4"]);
  });

  it("skips malformed JSONL lines without throwing", async () => {
    const good = buildExecutionRecord({ ...INPUT_BASE, symbol: "GOOD" });
    await appendExecutionRecord(good, path);
    // Append garbage manually
    const { appendFile } = await import("node:fs/promises");
    await appendFile(path, "not-json\n{partial\n", "utf-8");
    // Append another good record
    await appendExecutionRecord(
      buildExecutionRecord({ ...INPUT_BASE, symbol: "AGAIN" }),
      path,
    );
    const all = await readExecutionRecords({}, path);
    expect(all.length).toBe(2);
  });
});

describe("getExecutionRecord", () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "gordon-ledger-get-"));
    path = join(dir, "ledger.jsonl");
  });

  afterEach(() => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  });

  it("finds record by id", async () => {
    const r = buildExecutionRecord({
      ...INPUT_BASE,
      recordIdOverride: "find-me",
    });
    await appendExecutionRecord(r, path);
    const got = await getExecutionRecord("find-me", path);
    expect(got?.recordId).toBe("find-me");
  });

  it("returns null when not found", async () => {
    expect(await getExecutionRecord("nope", path)).toBeNull();
  });
});

describe("appendExecutionRecordFresh — chain continuity", () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "gordon-ledger-fresh-"));
    path = join(dir, "ledger.jsonl");
  });

  afterEach(() => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  });

  it("first record gets priorRecordId=null", async () => {
    const r = await appendExecutionRecordFresh(
      { rationale: "first record at min length", operations: OPS, results: RESULTS },
      path,
    );
    expect(r?.priorRecordId).toBeNull();
  });

  it("second record chains to the first", async () => {
    const r1 = await appendExecutionRecordFresh(
      { rationale: "first record at min length", operations: OPS, results: RESULTS },
      path,
    );
    const r2 = await appendExecutionRecordFresh(
      { rationale: "second record at min length", operations: OPS, results: RESULTS },
      path,
    );
    expect(r2?.priorRecordId).toBe(r1?.recordId ?? null);
    expect(await lastRecordId(path)).toBe(r2?.recordId ?? null);
  });

  it("returns null on write failure (best-effort semantics)", async () => {
    // Use a path that can't be created (null char on Windows)
    const r = await appendExecutionRecordFresh(
      { rationale: "boom" + " ".repeat(20), operations: OPS, results: RESULTS },
      " /invalid/path/ledger.jsonl",
    );
    expect(r).toBeNull();
  });
});

describe("executionRecordToPayload", () => {
  it("emits stable shape with delta computation", () => {
    const r = buildExecutionRecord({
      ...INPUT_BASE,
      symbol: "BTC",
      planId: "p1",
      stateBefore: { netLiquidationUsd: 10_000, realizedPnLUsd: 100 },
      stateAfter: { netLiquidationUsd: 9_980, realizedPnLUsd: 80 },
    });
    const p = executionRecordToPayload(r) as {
      kind: string;
      netLiqDelta: number;
      realizedPnLDelta: number;
      symbol: string;
    };
    expect(p.kind).toBe("trade_ledger.recorded");
    expect(p.netLiqDelta).toBeCloseTo(-20, 6);
    expect(p.realizedPnLDelta).toBeCloseTo(-20, 6);
    expect(p.symbol).toBe("BTC");
  });

  it("emits null deltas when state snapshots missing", () => {
    const r = buildExecutionRecord(INPUT_BASE);
    const p = executionRecordToPayload(r) as {
      netLiqDelta: number | null;
      realizedPnLDelta: number | null;
    };
    expect(p.netLiqDelta).toBeNull();
    expect(p.realizedPnLDelta).toBeNull();
  });
});
