import { describe, it, expect } from "bun:test";

import {
  HARNESS_FLAGS,
  pickNextFlag,
  recordOutcome,
  renderReport,
  formatStatus,
} from "./harness-simplification.ts";

describe("HARNESS_FLAGS", () => {
  it("has unique flag names", () => {
    const names = HARNESS_FLAGS.map((f) => f.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("each entry has a non-empty description", () => {
    for (const f of HARNESS_FLAGS) {
      expect(f.description.length).toBeGreaterThan(0);
    }
  });

  it("all names start with GORDON_", () => {
    for (const f of HARNESS_FLAGS) {
      expect(f.name).toMatch(/^GORDON_/);
    }
  });
});

describe("pickNextFlag", () => {
  it("returns the first untested flag when state is empty", () => {
    const next = pickNextFlag({ entries: [] });
    expect(next).not.toBeNull();
    expect(HARNESS_FLAGS.map((f) => f.name)).toContain(next?.name ?? "");
  });

  it("prefers never-tested flags over tested ones", () => {
    // Seed every-flag-except-one as recently tested (within 30 days)
    const recentTs = new Date().toISOString();
    const except = HARNESS_FLAGS[5]?.name;
    expect(except).toBeDefined();
    const entries = HARNESS_FLAGS.filter((f) => f.name !== except).map((f) => ({
      flag: f.name,
      lastTestedAt: recentTs,
      outcome: "keep" as const,
    }));
    const next = pickNextFlag({ entries });
    expect(next?.name).toBe(except);
  });

  it("skips flags marked 'remove'", () => {
    const removed = HARNESS_FLAGS[0]!.name;
    const entries = [
      { flag: removed, lastTestedAt: new Date().toISOString(), outcome: "remove" as const },
    ];
    const next = pickNextFlag({ entries });
    expect(next?.name).not.toBe(removed);
  });

  it("re-tests 'keep' flags after 30 days", () => {
    const oldTs = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
    const target = HARNESS_FLAGS[2]!.name;
    // Mark every other flag tested recently
    const recentTs = new Date().toISOString();
    const entries = HARNESS_FLAGS.map((f, _i) =>
      f.name === target
        ? { flag: f.name, lastTestedAt: oldTs, outcome: "keep" as const }
        : { flag: f.name, lastTestedAt: recentTs, outcome: "keep" as const },
    );
    // Strip the target from "tested recently" list so only it's eligible
    const filtered = entries.filter((e) => e.flag === target || e.lastTestedAt === recentTs);
    const next = pickNextFlag({ entries: filtered });
    expect(next?.name).toBe(target);
  });

  it("re-tests 'replace' flags after 90 days", () => {
    const recentTs = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const oldTs = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString();
    const replaceFlag = HARNESS_FLAGS[1]!.name;
    const entries = [
      { flag: replaceFlag, lastTestedAt: oldTs, outcome: "replace" as const },
      // mark every other flag tested recently so they don't surface
      ...HARNESS_FLAGS.filter((f) => f.name !== replaceFlag).map((f) => ({
        flag: f.name,
        lastTestedAt: recentTs,
        outcome: "keep" as const,
      })),
    ];
    const next = pickNextFlag({ entries });
    expect(next?.name).toBe(replaceFlag);
  });

  it("returns null when nothing is eligible", () => {
    const recentTs = new Date().toISOString();
    const entries = HARNESS_FLAGS.map((f) => ({
      flag: f.name,
      lastTestedAt: recentTs,
      outcome: "keep" as const,
    }));
    expect(pickNextFlag({ entries })).toBeNull();
  });
});

describe("recordOutcome", () => {
  it("appends a new entry for a never-tested flag", () => {
    const next = recordOutcome({ entries: [] }, HARNESS_FLAGS[0]!.name, "keep");
    expect(next.entries).toHaveLength(1);
    expect(next.entries[0]?.flag).toBe(HARNESS_FLAGS[0]!.name);
    expect(next.entries[0]?.outcome).toBe("keep");
  });

  it("replaces an existing entry instead of appending", () => {
    const flag = HARNESS_FLAGS[0]!.name;
    const prior = {
      entries: [{ flag, lastTestedAt: "2020-01-01T00:00:00.000Z", outcome: "keep" as const }],
    };
    const next = recordOutcome(prior, flag, "remove", "deprecated");
    expect(next.entries).toHaveLength(1);
    expect(next.entries[0]?.outcome).toBe("remove");
    expect(next.entries[0]?.notes).toBe("deprecated");
  });

  it("throws on unknown flag", () => {
    expect(() => recordOutcome({ entries: [] }, "GORDON_NOT_A_REAL_FLAG", "keep")).toThrow();
  });
});

describe("renderReport", () => {
  it("includes the flag name, procedure, and decision matrix", () => {
    const report = renderReport(HARNESS_FLAGS[0]!);
    expect(report).toContain(HARNESS_FLAGS[0]!.name);
    expect(report).toContain("Procedure");
    expect(report).toContain("Decision Matrix");
    expect(report).toContain("--record-outcome");
  });
});

describe("formatStatus", () => {
  it("indicates next-up when entries exist", () => {
    const status = formatStatus({
      entries: [
        { flag: HARNESS_FLAGS[0]!.name, lastTestedAt: new Date().toISOString(), outcome: "keep" },
      ],
    });
    expect(status).toContain("Next up:");
  });

  it("notes empty state", () => {
    const status = formatStatus({ entries: [] });
    expect(status).toContain("no flags");
  });
});
