import { describe, it, expect, beforeEach } from "bun:test";
import { mkdtempSync, existsSync, readFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  defaultAttemptsLogPath,
  recordAttempt,
  readAttempts,
  countTrials,
  expectedMaxSharpeUnderNull,
  dynamicDeflatedThreshold,
  attemptToPayload,
  resetAttemptCounterForTesting,
  ATTEMPTS_LOG_PATH_ENV,
} from "./multipleTestingTracker.ts";

let tempDir: string;
let logPath: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "gordon-mtt-test-"));
  logPath = join(tempDir, "attempts.jsonl");
  resetAttemptCounterForTesting();
});

describe("defaultAttemptsLogPath", () => {
  it("honors env override", () => {
    expect(defaultAttemptsLogPath({ [ATTEMPTS_LOG_PATH_ENV]: "/x/y.jsonl" })).toBe("/x/y.jsonl");
  });
  it("falls back to home-dir default", () => {
    expect(defaultAttemptsLogPath({})).toContain("strategy-attempts.jsonl");
  });
});

describe("recordAttempt", () => {
  it("appends a JSONL line", () => {
    recordAttempt(
      {
        family: "momentum/equities",
        codeHash: "hash-1",
        observedSharpe: 1.2,
        verdict: "rejected",
        now: "2026-05-13T10:00:00.000Z",
      },
      logPath,
    );
    expect(existsSync(logPath)).toBe(true);
    const parsed = JSON.parse(readFileSync(logPath, "utf8").trim());
    expect(parsed.family).toBe("momentum/equities");
    expect(parsed.observedSharpe).toBe(1.2);
  });

  it("creates parent directory if missing", () => {
    const nested = join(tempDir, "a", "b", "c.jsonl");
    recordAttempt(
      { family: "x", codeHash: "h", observedSharpe: 0, verdict: "errored" },
      nested,
    );
    expect(existsSync(nested)).toBe(true);
  });

  it("assigns a monotonic attemptId", () => {
    const a = recordAttempt(
      { family: "x", codeHash: "h1", observedSharpe: 1, verdict: "rejected" },
      logPath,
    );
    const b = recordAttempt(
      { family: "x", codeHash: "h2", observedSharpe: 1, verdict: "rejected" },
      logPath,
    );
    expect(a.attemptId).not.toBe(b.attemptId);
  });
});

describe("readAttempts", () => {
  it("returns empty for missing file", () => {
    expect(readAttempts({}, join(tempDir, "no.jsonl"))).toEqual([]);
  });

  it("returns newest-first", () => {
    recordAttempt(
      { family: "x", codeHash: "h1", observedSharpe: 1, verdict: "rejected", now: "2026-01-01T00:00:00.000Z" },
      logPath,
    );
    recordAttempt(
      { family: "x", codeHash: "h2", observedSharpe: 1, verdict: "rejected", now: "2026-02-01T00:00:00.000Z" },
      logPath,
    );
    const out = readAttempts({}, logPath);
    expect(out[0]!.codeHash).toBe("h2");
    expect(out[1]!.codeHash).toBe("h1");
  });

  it("filters by family", () => {
    recordAttempt({ family: "mom", codeHash: "a", observedSharpe: 1, verdict: "rejected" }, logPath);
    recordAttempt({ family: "rev", codeHash: "b", observedSharpe: 1, verdict: "rejected" }, logPath);
    expect(readAttempts({ family: "mom" }, logPath).length).toBe(1);
  });

  it("filters by sinceMs", () => {
    recordAttempt(
      { family: "x", codeHash: "old", observedSharpe: 1, verdict: "rejected", now: "2025-01-01T00:00:00.000Z" },
      logPath,
    );
    recordAttempt(
      { family: "x", codeHash: "new", observedSharpe: 1, verdict: "rejected", now: "2026-01-01T00:00:00.000Z" },
      logPath,
    );
    const cutoff = Date.parse("2025-06-01T00:00:00.000Z");
    expect(readAttempts({ sinceMs: cutoff }, logPath).map((a) => a.codeHash)).toEqual(["new"]);
  });

  it("respects limit", () => {
    for (let i = 0; i < 5; i++) {
      recordAttempt(
        { family: "x", codeHash: `h${i}`, observedSharpe: 1, verdict: "rejected" },
        logPath,
      );
    }
    expect(readAttempts({ limit: 2 }, logPath).length).toBe(2);
  });

  it("tolerates malformed lines", () => {
    recordAttempt({ family: "x", codeHash: "a", observedSharpe: 1, verdict: "rejected" }, logPath);
    appendFileSync(logPath, "not-json{\n");
    recordAttempt({ family: "x", codeHash: "b", observedSharpe: 1, verdict: "rejected" }, logPath);
    expect(readAttempts({}, logPath).length).toBe(2);
  });
});

describe("countTrials", () => {
  it("returns zero for unknown family", () => {
    const c = countTrials("never-seen", logPath);
    expect(c.distinctCount).toBe(0);
    expect(c.totalCount).toBe(0);
  });

  it("counts distinct codeHashes, not duplicates", () => {
    recordAttempt({ family: "x", codeHash: "a", observedSharpe: 1, verdict: "rejected" }, logPath);
    recordAttempt({ family: "x", codeHash: "a", observedSharpe: 1, verdict: "rejected" }, logPath);
    recordAttempt({ family: "x", codeHash: "b", observedSharpe: 1, verdict: "rejected" }, logPath);
    const c = countTrials("x", logPath);
    expect(c.distinctCount).toBe(2);
    expect(c.totalCount).toBe(3);
  });

  it("scopes counts per family", () => {
    recordAttempt({ family: "mom", codeHash: "a", observedSharpe: 1, verdict: "rejected" }, logPath);
    recordAttempt({ family: "rev", codeHash: "b", observedSharpe: 1, verdict: "rejected" }, logPath);
    expect(countTrials("mom", logPath).distinctCount).toBe(1);
    expect(countTrials("rev", logPath).distinctCount).toBe(1);
  });
});

describe("expectedMaxSharpeUnderNull", () => {
  it("returns 0 for n<=1 (no max of one draw)", () => {
    expect(expectedMaxSharpeUnderNull(0)).toBe(0);
    expect(expectedMaxSharpeUnderNull(1)).toBe(0);
  });

  it("grows with trial count", () => {
    const s10 = expectedMaxSharpeUnderNull(10);
    const s100 = expectedMaxSharpeUnderNull(100);
    const s1000 = expectedMaxSharpeUnderNull(1000);
    expect(s100).toBeGreaterThan(s10);
    expect(s1000).toBeGreaterThan(s100);
  });

  it("Bailey-LdP approximation: 10000 trials yields ~3.5-4.0 (annualized units)", () => {
    const v = expectedMaxSharpeUnderNull(10_000);
    expect(v).toBeGreaterThan(3.5);
    expect(v).toBeLessThan(4.5);
  });
});

describe("dynamicDeflatedThreshold", () => {
  it("fails when track record is too short", () => {
    const r = dynamicDeflatedThreshold({
      family: "x",
      observedSharpeAnnualized: 2.0,
      periods: 10,
    });
    expect(r.passes).toBe(false);
  });

  it("passes a clean Sharpe with low trial count", () => {
    const r = dynamicDeflatedThreshold({
      family: "x",
      observedSharpeAnnualized: 2.5,
      periods: 252,
      trialCountOverride: 1,
    });
    expect(r.passes).toBe(true);
  });

  it("rejects the same Sharpe at high trial count", () => {
    const sharpe = 2.5;
    const easyCase = dynamicDeflatedThreshold({
      family: "x",
      observedSharpeAnnualized: sharpe,
      periods: 252,
      trialCountOverride: 1,
    });
    const hardCase = dynamicDeflatedThreshold({
      family: "x",
      observedSharpeAnnualized: sharpe,
      periods: 252,
      trialCountOverride: 10_000,
    });
    expect(easyCase.dsrPValue).toBeGreaterThan(hardCase.dsrPValue);
    expect(easyCase.passes).toBe(true);
    expect(hardCase.passes).toBe(false);
  });

  it("expected-max-Sharpe-under-null grows with effective trial count", () => {
    const a = dynamicDeflatedThreshold({
      family: "x",
      observedSharpeAnnualized: 1.0,
      periods: 252,
      trialCountOverride: 10,
    });
    const b = dynamicDeflatedThreshold({
      family: "x",
      observedSharpeAnnualized: 1.0,
      periods: 252,
      trialCountOverride: 1000,
    });
    expect(b.expectedMaxSharpeNullAnnualized).toBeGreaterThan(a.expectedMaxSharpeNullAnnualized);
  });

  it("uses log when no trialCountOverride is supplied", () => {
    recordAttempt({ family: "x", codeHash: "a", observedSharpe: 1, verdict: "rejected" }, logPath);
    recordAttempt({ family: "x", codeHash: "b", observedSharpe: 1, verdict: "rejected" }, logPath);
    recordAttempt({ family: "x", codeHash: "c", observedSharpe: 1, verdict: "rejected" }, logPath);
    const r = dynamicDeflatedThreshold({
      family: "x",
      observedSharpeAnnualized: 1.0,
      periods: 252,
      attemptsLogPath: logPath,
    });
    expect(r.trialCount).toBe(3);
  });

  it("includes the current attempt in the effective trial count (+1)", () => {
    const zero = dynamicDeflatedThreshold({
      family: "x",
      observedSharpeAnnualized: 1.0,
      periods: 252,
      trialCountOverride: 0,
    });
    // With trialCountOverride=0, effective=1, +1 = 2 -> non-zero expected max
    expect(zero.expectedMaxSharpeNullAnnualized).toBeGreaterThan(0);
  });

  it("respects annualization parameter", () => {
    const daily = dynamicDeflatedThreshold({
      family: "x",
      observedSharpeAnnualized: 2.5,
      periods: 252,
      annualization: 252,
      trialCountOverride: 1,
    });
    const crypto = dynamicDeflatedThreshold({
      family: "x",
      observedSharpeAnnualized: 2.5,
      periods: 365,
      annualization: 365,
      trialCountOverride: 1,
    });
    // Both should pass at low trial count with a strong annualized Sharpe.
    expect(daily.passes).toBe(true);
    expect(crypto.passes).toBe(true);
  });
});

describe("attemptToPayload", () => {
  it("emits stable shape", () => {
    const attempt = recordAttempt(
      { family: "x", codeHash: "h", observedSharpe: 1.2, verdict: "rejected" },
      logPath,
    );
    const p = attemptToPayload(attempt);
    expect(p.kind).toBe("multiple_testing.attempt_recorded");
    expect(p.family).toBe("x");
  });
});
