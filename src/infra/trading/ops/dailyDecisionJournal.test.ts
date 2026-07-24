import { describe, it, expect, beforeEach } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  recordJournalEntry,
  readJournalLog,
  evaluateVerdict,
  formatEntry,
  entryToPayload,
  DECISION_JOURNAL_PATH_ENV,
  type PreMortemChecks,
  type ThesisSection,
  type MathSection,
} from "./dailyDecisionJournal.ts";

let workDir: string;
let logPath: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "journal-"));
  logPath = join(workDir, "journal.jsonl");
});

const cleanup = () => {
  try { rmSync(workDir, { recursive: true, force: true }); } catch { /* ignore */ }
};

const cleanThesis: ThesisSection = {
  narrative: "OPEC+ cuts holding and inventories tightening",
  trigger: "Reclaim of 200-day MA on expanding volume",
  invalidation: "Close below yesterday's low at $75.50",
};

const cleanMath: MathSection = {
  freeCapitalUsd: 100_000,
  riskPercent: 0.01,
  dollarRiskBudget: 1000,
  stopDistance: 0.5,
  positionUnits: 2000,
};

const noFlags: PreMortemChecks = {
  bSetupTrap: false,
  tiltCheck: false,
  eventRisk: false,
  liquidityTrap: false,
  correlationBlindSpot: false,
};

describe("evaluateVerdict — clean entry", () => {
  it("returns go when all sections clean and no pre-mortem flags", () => {
    const r = evaluateVerdict(cleanThesis, cleanMath, noFlags);
    expect(r.verdict).toBe("go");
    expect(r.blockers).toEqual([]);
  });
});

describe("evaluateVerdict — thesis blockers", () => {
  it("blocks on missing narrative", () => {
    const r = evaluateVerdict({ ...cleanThesis, narrative: "" }, cleanMath, noFlags);
    expect(r.verdict).toBe("no_go");
    expect(r.blockers.some((b) => b.includes("narrative"))).toBe(true);
  });

  it("blocks on whitespace-only invalidation", () => {
    const r = evaluateVerdict({ ...cleanThesis, invalidation: "   " }, cleanMath, noFlags);
    expect(r.verdict).toBe("no_go");
    expect(r.blockers.some((b) => b.includes("invalidation"))).toBe(true);
  });
});

describe("evaluateVerdict — math blockers", () => {
  it("blocks on non-positive free capital", () => {
    const r = evaluateVerdict(cleanThesis, { ...cleanMath, freeCapitalUsd: 0 }, noFlags);
    expect(r.verdict).toBe("no_go");
    expect(r.blockers.some((b) => b.includes("free capital"))).toBe(true);
  });

  it("blocks on risk percent out of band", () => {
    expect(
      evaluateVerdict(cleanThesis, { ...cleanMath, riskPercent: 0 }, noFlags).verdict,
    ).toBe("no_go");
    expect(
      evaluateVerdict(cleanThesis, { ...cleanMath, riskPercent: 0.15 }, noFlags).verdict,
    ).toBe("no_go");
    expect(
      evaluateVerdict(cleanThesis, { ...cleanMath, riskPercent: 0.05 }, noFlags).verdict,
    ).toBe("go");
  });

  it("blocks on zero stop distance", () => {
    const r = evaluateVerdict(cleanThesis, { ...cleanMath, stopDistance: 0 }, noFlags);
    expect(r.verdict).toBe("no_go");
  });
});

describe("evaluateVerdict — pre-mortem failures", () => {
  it("blocks on any single pre-mortem flag", () => {
    for (const key of Object.keys(noFlags) as Array<keyof PreMortemChecks>) {
      const flagged: PreMortemChecks = { ...noFlags, [key]: true };
      const r = evaluateVerdict(cleanThesis, cleanMath, flagged);
      expect(r.verdict).toBe("no_go");
      expect(r.blockers.length).toBe(1);
    }
  });

  it("aggregates multiple flags", () => {
    const r = evaluateVerdict(cleanThesis, cleanMath, {
      ...noFlags,
      tiltCheck: true,
      eventRisk: true,
      liquidityTrap: true,
    });
    expect(r.blockers.length).toBe(3);
  });

  it("flags both math and pre-mortem when both fail", () => {
    const r = evaluateVerdict(
      { ...cleanThesis, narrative: "" },
      { ...cleanMath, freeCapitalUsd: -100 },
      { ...noFlags, tiltCheck: true },
    );
    expect(r.blockers.length).toBe(3);
  });
});

describe("recordJournalEntry", () => {
  it("writes JSONL", () => {
    const env = {};
    const entry = recordJournalEntry(
      {
        symbol: "CL",
        direction: "short",
        tradeId: "tr-1",
        thesis: cleanThesis,
        math: cleanMath,
        preMortem: noFlags,
        now: "2026-05-17T10:00:00Z",
      },
      env,
      logPath,
    );
    expect(entry?.verdict).toBe("go");
    expect(entry?.tradeId).toBe("tr-1");
    expect(entry?.recordedAt).toBe("2026-05-17T10:00:00Z");
    const lines = readFileSync(logPath, "utf8").trim().split("\n");
    expect(lines.length).toBe(1);
    cleanup();
  });

  it("records no_go verdict + blockers when pre-mortem fails", () => {
    const env = {};
    const entry = recordJournalEntry(
      {
        symbol: "CL",
        direction: "short",
        thesis: cleanThesis,
        math: cleanMath,
        preMortem: { ...noFlags, tiltCheck: true },
      },
      env,
      logPath,
    );
    expect(entry?.verdict).toBe("no_go");
    expect(entry?.blockers.some((b) => b.includes("Tilt"))).toBe(true);
    cleanup();
  });

  it("respects path override", () => {
    const customPath = join(workDir, "custom.jsonl");
    const env = {
      [DECISION_JOURNAL_PATH_ENV]: customPath,
    };
    recordJournalEntry(
      {
        symbol: "CL",
        direction: "short",
        thesis: cleanThesis,
        math: cleanMath,
        preMortem: noFlags,
      },
      env,
    );
    expect(existsSync(customPath)).toBe(true);
    cleanup();
  });
});

describe("readJournalLog + formatEntry + entryToPayload", () => {
  it("reads what was written and formats it", () => {
    const env = {};
    recordJournalEntry(
      {
        symbol: "CL",
        direction: "short",
        thesis: cleanThesis,
        math: cleanMath,
        preMortem: noFlags,
      },
      env,
      logPath,
    );
    const entries = readJournalLog(logPath);
    expect(entries.length).toBe(1);
    const out = formatEntry(entries[0]!);
    expect(out).toContain("Decision Journal CL SHORT");
    expect(out).toContain("Narrative:");
    expect(out).toContain("Math:");
    const p = entryToPayload(entries[0]!);
    expect(p.kind).toBe("decision_journal.recorded");
    expect(p.verdict).toBe("go");
    cleanup();
  });

  it("returns empty for missing log file", () => {
    expect(readJournalLog(join(workDir, "ghost.jsonl"))).toEqual([]);
    cleanup();
  });
});

describe("Wright Ch 16 Protocol 1 scenario", () => {
  it("end-to-end: clean crude oil short → go verdict", () => {
    const env = {};
    const entry = recordJournalEntry(
      {
        symbol: "CL",
        direction: "short",
        thesis: {
          narrative: "Saudis selling into rally despite OPEC+ jawboning; supply tightening",
          trigger: "Failure at resistance cluster with bearish divergence on hourly",
          invalidation: "Above $76.21 — invalidates higher-low structure",
        },
        math: {
          freeCapitalUsd: 112_000,
          riskPercent: 0.01,
          dollarRiskBudget: 1120,
          stopDistance: 0.39,
          positionUnits: 1120 / 0.39,
        },
        preMortem: noFlags,
      },
      env,
      logPath,
    );
    expect(entry?.verdict).toBe("go");
    expect(entry?.math.positionUnits).toBeCloseTo(2872, 0);
    cleanup();
  });
});
