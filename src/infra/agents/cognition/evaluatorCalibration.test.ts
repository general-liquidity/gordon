import { describe, it, expect, beforeEach } from "bun:test";
import { mkdtempSync, existsSync, readFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  isEvaluatorCalibrationEnabled,
  defaultEvaluatorCalibrationPath,
  registerCalibrationExample,
  loadCalibrationSet,
  selectRelevantExamples,
  buildCalibrationBlock,
  detectDrift,
  formatDriftReport,
  driftToPayload,
  EVALUATOR_CALIBRATION_FLAG_ENV,
  EVALUATOR_CALIBRATION_PATH_ENV,
  type CalibrationExample,
} from "./evaluatorCalibration.ts";

let tempDir: string;
let logPath: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "gordon-cal-test-"));
  logPath = join(tempDir, "calibration.jsonl");
});

function ex(
  id: string,
  overrides: Partial<Omit<CalibrationExample, "registeredAt">> = {},
): Omit<CalibrationExample, "registeredAt"> {
  return {
    id,
    description: `example ${id}`,
    inputSummary: `input ${id}`,
    expectedScores: { correctness: 2, safety: 2 },
    rationale: "because gold",
    ...overrides,
  };
}

describe("isEvaluatorCalibrationEnabled", () => {
  it("respects the flag", () => {
    expect(isEvaluatorCalibrationEnabled({})).toBe(false);
    expect(
      isEvaluatorCalibrationEnabled({ [EVALUATOR_CALIBRATION_FLAG_ENV]: "1" }),
    ).toBe(true);
    expect(
      isEvaluatorCalibrationEnabled({ [EVALUATOR_CALIBRATION_FLAG_ENV]: "true" }),
    ).toBe(true);
  });
});

describe("defaultEvaluatorCalibrationPath", () => {
  it("honors env override", () => {
    expect(
      defaultEvaluatorCalibrationPath({ [EVALUATOR_CALIBRATION_PATH_ENV]: "/x.jsonl" }),
    ).toBe("/x.jsonl");
  });
  it("falls back to home-dir default", () => {
    expect(defaultEvaluatorCalibrationPath({})).toContain("evaluator-calibration.jsonl");
  });
});

describe("registerCalibrationExample / loadCalibrationSet", () => {
  it("round-trips through disk", () => {
    registerCalibrationExample(ex("a"), { path: logPath, now: "2026-05-13T00:00:00.000Z" });
    registerCalibrationExample(ex("b", { tags: ["venue:binance"] }), { path: logPath });
    const set = loadCalibrationSet(logPath);
    expect(set.length).toBe(2);
    expect(set[0]!.id).toBe("a");
    expect(set[1]!.tags).toEqual(["venue:binance"]);
  });

  it("creates parent dir if missing", () => {
    const nested = join(tempDir, "deep", "deeper", "cal.jsonl");
    registerCalibrationExample(ex("a"), { path: nested });
    expect(existsSync(nested)).toBe(true);
  });

  it("returns empty for missing file", () => {
    expect(loadCalibrationSet(join(tempDir, "no.jsonl"))).toEqual([]);
  });

  it("tolerates malformed lines", () => {
    registerCalibrationExample(ex("a"), { path: logPath });
    appendFileSync(logPath, "not-json{\n");
    registerCalibrationExample(ex("b"), { path: logPath });
    expect(loadCalibrationSet(logPath).length).toBe(2);
  });
});

describe("selectRelevantExamples", () => {
  it("returns all when no criteria supplied (capped by k)", () => {
    const pool = [
      { ...ex("a"), registeredAt: "2026-01-01T00:00:00Z" },
      { ...ex("b"), registeredAt: "2026-02-01T00:00:00Z" },
      { ...ex("c"), registeredAt: "2026-03-01T00:00:00Z" },
      { ...ex("d"), registeredAt: "2026-04-01T00:00:00Z" },
    ];
    expect(selectRelevantExamples(pool, { k: 2 }).length).toBe(2);
  });

  it("ranks by overlapping tags (+2 each)", () => {
    const pool = [
      { ...ex("matchy", { tags: ["venue:binance", "asset:btc"] }), registeredAt: "2026-01-01T00:00:00Z" },
      { ...ex("other"), registeredAt: "2026-02-01T00:00:00Z" },
    ];
    const out = selectRelevantExamples(pool, {
      tags: ["venue:binance"],
    });
    expect(out[0]!.id).toBe("matchy");
  });

  it("ranks by keyword overlap (+1 each)", () => {
    const pool = [
      { ...ex("desc-match", { description: "momentum strategy on ETH" }), registeredAt: "2026-01-01T00:00:00Z" },
      { ...ex("nope"), registeredAt: "2026-02-01T00:00:00Z" },
    ];
    const out = selectRelevantExamples(pool, { keywords: ["momentum"] });
    expect(out[0]!.id).toBe("desc-match");
  });

  it("drops zero-score entries when criteria were supplied", () => {
    const pool = [
      { ...ex("matchy", { tags: ["x"] }), registeredAt: "2026-01-01T00:00:00Z" },
      { ...ex("zero"), registeredAt: "2026-02-01T00:00:00Z" },
    ];
    const out = selectRelevantExamples(pool, { tags: ["x"] });
    expect(out.map((e) => e.id)).toEqual(["matchy"]);
  });

  it("breaks ties on recency", () => {
    const pool = [
      { ...ex("older", { tags: ["x"] }), registeredAt: "2026-01-01T00:00:00Z" },
      { ...ex("newer", { tags: ["x"] }), registeredAt: "2026-04-01T00:00:00Z" },
    ];
    const out = selectRelevantExamples(pool, { tags: ["x"], k: 2 });
    expect(out[0]!.id).toBe("newer");
  });
});

describe("buildCalibrationBlock", () => {
  it("returns empty string for empty examples", () => {
    expect(buildCalibrationBlock([])).toBe("");
  });

  it("formats each example with dimensions inline", () => {
    const block = buildCalibrationBlock([
      { ...ex("a"), registeredAt: "2026-01-01T00:00:00Z" },
    ]);
    expect(block).toContain("CALIBRATION EXAMPLES");
    expect(block).toContain("Example a");
    expect(block).toContain("correctness=2");
    expect(block).toContain("safety=2");
    expect(block).toContain("because gold");
  });
});

describe("detectDrift", () => {
  const example: CalibrationExample = {
    ...ex("a", { expectedScores: { correctness: 2, safety: 2, scope: 1 } }),
    registeredAt: "2026-01-01T00:00:00Z",
  };

  it("flags drift when any dimension exceeds tolerance", () => {
    const report = detectDrift({ correctness: 2, safety: 0, scope: 1 }, example, 0.5);
    expect(report.hasDrift).toBe(true);
    expect(report.maxDrift).toBe(2);
  });

  it("no drift when all dimensions are within tolerance", () => {
    const report = detectDrift(
      { correctness: 2.2, safety: 1.8, scope: 1 },
      example,
      0.5,
    );
    expect(report.hasDrift).toBe(false);
    expect(report.maxDrift).toBeCloseTo(0.2);
  });

  it("computes total drift across dimensions", () => {
    const report = detectDrift(
      { correctness: 1, safety: 1, scope: 0 },
      example,
      0.5,
    );
    expect(report.totalDrift).toBe(3);
  });

  it("ignores dimensions missing in observed", () => {
    const report = detectDrift({ correctness: 2 }, example, 0.5);
    expect(report.dimensions.length).toBe(1);
  });

  it("respects tolerance parameter", () => {
    const lenient = detectDrift({ correctness: 1, safety: 2, scope: 1 }, example, 2);
    expect(lenient.hasDrift).toBe(false);
    const strict = detectDrift({ correctness: 1, safety: 2, scope: 1 }, example, 0.1);
    expect(strict.hasDrift).toBe(true);
  });
});

describe("formatDriftReport", () => {
  it("includes drift summary and per-dimension lines", () => {
    const example: CalibrationExample = {
      ...ex("a", { expectedScores: { correctness: 2 } }),
      registeredAt: "2026-01-01T00:00:00Z",
    };
    const report = detectDrift({ correctness: 0 }, example, 0.5);
    const out = formatDriftReport(report);
    expect(out).toContain("DRIFT");
    expect(out).toContain("correctness");
  });
});

describe("driftToPayload", () => {
  it("emits stable shape", () => {
    const example: CalibrationExample = {
      ...ex("a", { expectedScores: { correctness: 2 } }),
      registeredAt: "2026-01-01T00:00:00Z",
    };
    const report = detectDrift({ correctness: 0 }, example, 0.5);
    const p = driftToPayload(report);
    expect(p.kind).toBe("evaluator_calibration.drift_recorded");
    expect(p.hasDrift).toBe(true);
    expect(Array.isArray(p.drifters)).toBe(true);
  });
});
