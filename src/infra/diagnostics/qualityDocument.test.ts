import { describe, it, expect, beforeEach } from "bun:test";
import { mkdtempSync, readFileSync, existsSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  isQualityDocEnabled,
  defaultQualitySnapshotsPath,
  createQualitySnapshot,
  recordQualitySnapshot,
  readQualitySnapshots,
  computeTrend,
  computeTrendSeries,
  formatQualitySnapshot,
  snapshotToPayload,
  QUALITY_LAYERS,
  QUALITY_FLAG_ENV,
  QUALITY_PATH_ENV,
  type QualitySnapshotInput,
} from "./qualityDocument.ts";

const buildInput = (overrides: Partial<QualitySnapshotInput> = {}): QualitySnapshotInput => ({
  label: "t1",
  instructions: { score: 2, rationale: "CLAUDE.md complete" },
  tools: { score: 1, rationale: "limits not tuned per family" },
  environment: { score: 2, rationale: "Bun + all providers green" },
  state: { score: 2, rationale: "action-log + memory + decisions all wired" },
  feedback: { score: 1, rationale: "termination layers not enforced in execute_plan yet" },
  now: "2026-05-13T10:00:00.000Z",
  ...overrides,
});

let tempDir: string;
let logPath: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "gordon-quality-test-"));
  logPath = join(tempDir, "quality.jsonl");
});

describe("isQualityDocEnabled", () => {
  it("respects the flag", () => {
    expect(isQualityDocEnabled({})).toBe(false);
    expect(isQualityDocEnabled({ [QUALITY_FLAG_ENV]: "1" })).toBe(true);
    expect(isQualityDocEnabled({ [QUALITY_FLAG_ENV]: "true" })).toBe(true);
  });
});

describe("defaultQualitySnapshotsPath", () => {
  it("honors override env var", () => {
    expect(defaultQualitySnapshotsPath({ [QUALITY_PATH_ENV]: "/x.jsonl" })).toBe("/x.jsonl");
  });
  it("falls back to home-dir default", () => {
    expect(defaultQualitySnapshotsPath({})).toContain("quality-snapshots.jsonl");
  });
});

describe("QUALITY_LAYERS", () => {
  it("contains all five layers in canonical order", () => {
    expect(QUALITY_LAYERS).toEqual(["instructions", "tools", "environment", "state", "feedback"]);
  });
});

describe("createQualitySnapshot", () => {
  it("computes total and weakest layers", () => {
    const snap = createQualitySnapshot(buildInput());
    expect(snap.total).toBe(2 + 1 + 2 + 2 + 1);
    expect(snap.weakestLayers).toEqual(["tools", "feedback"]);
  });

  it("captures capturedAt", () => {
    const snap = createQualitySnapshot(buildInput({ now: "2026-01-01T00:00:00.000Z" }));
    expect(snap.capturedAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("preserves layer order", () => {
    const snap = createQualitySnapshot(buildInput());
    expect(snap.scores.map((s) => s.layer)).toEqual([
      "instructions", "tools", "environment", "state", "feedback",
    ]);
  });

  it("returns all-2 as 10/10 with no weakest tied to lowest 2", () => {
    const allTwos = createQualitySnapshot({
      label: "perfect",
      instructions: { score: 2, rationale: "x" },
      tools: { score: 2, rationale: "x" },
      environment: { score: 2, rationale: "x" },
      state: { score: 2, rationale: "x" },
      feedback: { score: 2, rationale: "x" },
    });
    expect(allTwos.total).toBe(10);
    expect(allTwos.weakestLayers.length).toBe(5);
  });
});

describe("recordQualitySnapshot", () => {
  it("appends a JSONL line", () => {
    const snap = createQualitySnapshot(buildInput());
    recordQualitySnapshot(snap, logPath);
    expect(existsSync(logPath)).toBe(true);
    const parsed = JSON.parse(readFileSync(logPath, "utf8").trim());
    expect(parsed.label).toBe("t1");
    expect(parsed.total).toBe(8);
  });

  it("creates parent dir if missing", () => {
    const nested = join(tempDir, "a", "b", "c", "quality.jsonl");
    recordQualitySnapshot(createQualitySnapshot(buildInput()), nested);
    expect(existsSync(nested)).toBe(true);
  });
});

describe("readQualitySnapshots", () => {
  it("returns empty array for missing file", () => {
    expect(readQualitySnapshots({}, join(tempDir, "missing.jsonl"))).toEqual([]);
  });

  it("returns snapshots newest-first", () => {
    recordQualitySnapshot(createQualitySnapshot(buildInput({ label: "v1", now: "2026-01-01T00:00:00.000Z" })), logPath);
    recordQualitySnapshot(createQualitySnapshot(buildInput({ label: "v2", now: "2026-02-01T00:00:00.000Z" })), logPath);
    const snaps = readQualitySnapshots({}, logPath);
    expect(snaps.map((s) => s.label)).toEqual(["v2", "v1"]);
  });

  it("filters by labelContains", () => {
    recordQualitySnapshot(createQualitySnapshot(buildInput({ label: "alpha-1" })), logPath);
    recordQualitySnapshot(createQualitySnapshot(buildInput({ label: "beta-1" })), logPath);
    expect(readQualitySnapshots({ labelContains: "alpha" }, logPath).length).toBe(1);
  });

  it("respects limit", () => {
    for (let i = 0; i < 5; i++) {
      recordQualitySnapshot(
        createQualitySnapshot(buildInput({ label: `s${i}`, now: `2026-01-0${i + 1}T00:00:00.000Z` })),
        logPath,
      );
    }
    expect(readQualitySnapshots({ limit: 2 }, logPath).length).toBe(2);
  });

  it("tolerates malformed lines", () => {
    recordQualitySnapshot(createQualitySnapshot(buildInput()), logPath);
    appendFileSync(logPath, "not-json{\n");
    recordQualitySnapshot(createQualitySnapshot(buildInput({ label: "second" })), logPath);
    expect(readQualitySnapshots({}, logPath).length).toBe(2);
  });
});

describe("computeTrend", () => {
  it("reports zero deltas for identical snapshots", () => {
    const a = createQualitySnapshot(buildInput());
    const b = createQualitySnapshot(buildInput());
    const trend = computeTrend(a, b);
    expect(trend.totalDelta).toBe(0);
    expect(trend.regressedLayers).toEqual([]);
    expect(trend.improvedLayers).toEqual([]);
  });

  it("identifies regressions and improvements", () => {
    const prev = createQualitySnapshot(buildInput({
      instructions: { score: 2, rationale: "x" },
      feedback: { score: 1, rationale: "x" },
    }));
    const curr = createQualitySnapshot(buildInput({
      instructions: { score: 1, rationale: "x" }, // regression
      feedback: { score: 2, rationale: "x" },     // improvement
    }));
    const trend = computeTrend(prev, curr);
    expect(trend.regressedLayers).toContain("instructions");
    expect(trend.improvedLayers).toContain("feedback");
    expect(trend.perLayerDelta.instructions).toBe(-1);
    expect(trend.perLayerDelta.feedback).toBe(1);
    expect(trend.totalDelta).toBe(0);
  });
});

describe("computeTrendSeries", () => {
  it("returns empty array for <2 snapshots", () => {
    const snap = createQualitySnapshot(buildInput());
    expect(computeTrendSeries([])).toEqual([]);
    expect(computeTrendSeries([snap])).toEqual([]);
  });

  it("returns N-1 adjacent trends in chronological order", () => {
    const snaps = [
      createQualitySnapshot(buildInput({ label: "a", now: "2026-01-01T00:00:00.000Z" })),
      createQualitySnapshot(buildInput({ label: "b", now: "2026-01-02T00:00:00.000Z" })),
      createQualitySnapshot(buildInput({ label: "c", now: "2026-01-03T00:00:00.000Z" })),
    ];
    const trends = computeTrendSeries(snaps);
    expect(trends.length).toBe(2);
    expect(trends[0]!.previous.label).toBe("a");
    expect(trends[0]!.current.label).toBe("b");
  });
});

describe("formatQualitySnapshot", () => {
  it("emits one line per layer with score and rationale", () => {
    const out = formatQualitySnapshot(createQualitySnapshot(buildInput()));
    expect(out).toContain("instructions");
    expect(out).toContain("CLAUDE.md complete");
    expect(out).toContain("Total: 8/10");
  });
});

describe("snapshotToPayload", () => {
  it("emits stable shape", () => {
    const p = snapshotToPayload(createQualitySnapshot(buildInput()));
    expect(p.kind).toBe("quality.snapshot_recorded");
    expect(p.total).toBe(8);
  });
});
