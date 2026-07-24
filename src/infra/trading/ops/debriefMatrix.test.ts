import { describe, it, expect, beforeEach } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  classifyDebrief,
  recordDebrief,
  readDebriefLog,
  aggregateQuadrants,
  formatDebrief,
  debriefToPayload,
  DEBRIEF_MATRIX_PATH_ENV,
  type DebriefEntry,
} from "./debriefMatrix.ts";

let workDir: string;
let logPath: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "debrief-"));
  logPath = join(workDir, "debriefs.jsonl");
});

const cleanup = () => {
  try { rmSync(workDir, { recursive: true, force: true }); } catch { /* ignore */ }
};

describe("classifyDebrief — four quadrants", () => {
  it("good process + good outcome → deserved_success / reinforce", () => {
    const r = classifyDebrief({ processScore: 8, outcomeScore: 9 });
    expect(r.quadrant).toBe("deserved_success");
    expect(r.action).toBe("reinforce");
    expect(r.processGood).toBe(true);
    expect(r.outcomeGood).toBe(true);
  });

  it("good process + bad outcome → bad_luck / resilience", () => {
    const r = classifyDebrief({ processScore: 8, outcomeScore: 3 });
    expect(r.quadrant).toBe("bad_luck");
    expect(r.action).toBe("resilience");
  });

  it("bad process + good outcome → dumb_luck / treat_as_failure", () => {
    const r = classifyDebrief({ processScore: 3, outcomeScore: 8 });
    expect(r.quadrant).toBe("dumb_luck");
    expect(r.action).toBe("treat_as_failure");
  });

  it("bad process + bad outcome → poetic_justice / learn", () => {
    const r = classifyDebrief({ processScore: 2, outcomeScore: 3 });
    expect(r.quadrant).toBe("poetic_justice");
    expect(r.action).toBe("learn");
  });
});

describe("classifyDebrief — threshold + clamping", () => {
  it("default threshold is 6", () => {
    expect(classifyDebrief({ processScore: 6, outcomeScore: 6 }).quadrant).toBe("deserved_success");
    expect(classifyDebrief({ processScore: 5, outcomeScore: 6 }).quadrant).toBe("dumb_luck");
  });

  it("respects custom threshold", () => {
    expect(
      classifyDebrief({ processScore: 4, outcomeScore: 4, goodThreshold: 4 }).quadrant,
    ).toBe("deserved_success");
  });

  it("clamps out-of-range scores", () => {
    const r = classifyDebrief({ processScore: -2, outcomeScore: 15 });
    expect(r.processScore).toBe(1);
    expect(r.outcomeScore).toBe(10);
    expect(r.quadrant).toBe("dumb_luck");
  });
});

describe("recordDebrief", () => {
  it("writes JSONL", () => {
    const env = {};
    const r = recordDebrief(
      {
        tradeId: "t1",
        symbol: "BTC",
        pnlUsd: 250,
        processScore: 8,
        outcomeScore: 9,
        notes: "clean execution",
        now: "2026-05-17T15:00:00Z",
      },
      env,
      logPath,
    );
    expect(r?.quadrant).toBe("deserved_success");
    expect(r?.pnlUsd).toBe(250);
    expect(r?.notes).toBe("clean execution");
    const lines = readFileSync(logPath, "utf8").trim().split("\n");
    expect(lines.length).toBe(1);
    cleanup();
  });

  it("respects path override", () => {
    const customPath = join(workDir, "custom.jsonl");
    const env = {
      [DEBRIEF_MATRIX_PATH_ENV]: customPath,
    };
    recordDebrief(
      { tradeId: "t1", symbol: "BTC", pnlUsd: 0, processScore: 7, outcomeScore: 7 },
      env,
    );
    expect(existsSync(customPath)).toBe(true);
    cleanup();
  });
});

const makeEntry = (
  tradeId: string,
  processScore: number,
  outcomeScore: number,
): DebriefEntry => {
  const c = classifyDebrief({ processScore, outcomeScore });
  return {
    ...c,
    id: `dbr-${tradeId}`,
    recordedAt: "2026-05-17T10:00:00Z",
    tradeId,
    symbol: "BTC",
    pnlUsd: outcomeScore >= 6 ? 100 : -100,
  };
};

describe("aggregateQuadrants", () => {
  it("counts and fractions add up", () => {
    const entries = [
      makeEntry("a", 8, 8),
      makeEntry("b", 8, 8),
      makeEntry("c", 8, 3),
      makeEntry("d", 3, 8),
      makeEntry("e", 2, 2),
    ];
    const agg = aggregateQuadrants(entries);
    expect(agg.total).toBe(5);
    expect(agg.counts.deserved_success).toBe(2);
    expect(agg.counts.bad_luck).toBe(1);
    expect(agg.counts.dumb_luck).toBe(1);
    expect(agg.counts.poetic_justice).toBe(1);
    expect(agg.fractions.deserved_success).toBeCloseTo(0.4, 5);
  });

  it("returns zeros for empty input", () => {
    const agg = aggregateQuadrants([]);
    expect(agg.total).toBe(0);
    expect(agg.fractions.deserved_success).toBe(0);
    expect(agg.toxicAlphaAlarm).toBe(false);
  });

  it("toxicAlphaAlarm fires when dumb_luck > 20% of wins", () => {
    const entries = [
      makeEntry("a", 8, 8),
      makeEntry("b", 8, 8),
      makeEntry("c", 8, 8),
      makeEntry("d", 3, 8),
      makeEntry("e", 8, 2),
    ];
    const agg = aggregateQuadrants(entries);
    expect(agg.counts.dumb_luck).toBe(1);
    expect(agg.toxicAlphaAlarm).toBe(true);
  });

  it("does not fire when wins are all earned", () => {
    const entries = [makeEntry("a", 8, 8), makeEntry("b", 8, 8), makeEntry("c", 8, 3)];
    const agg = aggregateQuadrants(entries);
    expect(agg.toxicAlphaAlarm).toBe(false);
  });
});

describe("readDebriefLog + formatDebrief + debriefToPayload", () => {
  it("reads what was written", () => {
    const env = {};
    recordDebrief(
      { tradeId: "t1", symbol: "BTC", pnlUsd: 100, processScore: 8, outcomeScore: 8 },
      env,
      logPath,
    );
    const entries = readDebriefLog(logPath);
    expect(entries.length).toBe(1);
    expect(formatDebrief(entries[0]!)).toContain("deserved_success");
    expect(debriefToPayload(entries[0]!).kind).toBe("debrief_matrix.classified");
    cleanup();
  });

  it("returns empty for missing log", () => {
    expect(readDebriefLog(join(workDir, "ghost.jsonl"))).toEqual([]);
    cleanup();
  });
});

describe("Wright Ch 15 'hate bad profits' scenario", () => {
  it("classifies a winning rule-break as treat_as_failure (poisoned alpha)", () => {
    const r = classifyDebrief({ processScore: 3, outcomeScore: 9 });
    expect(r.quadrant).toBe("dumb_luck");
    expect(r.action).toBe("treat_as_failure");
  });

  it("classifies a losing rule-follow as resilience (variance)", () => {
    const r = classifyDebrief({ processScore: 9, outcomeScore: 2 });
    expect(r.quadrant).toBe("bad_luck");
    expect(r.action).toBe("resilience");
  });
});
