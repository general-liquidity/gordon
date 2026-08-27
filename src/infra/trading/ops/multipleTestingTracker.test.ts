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
import { normalCdf } from "../../../core/numerics/index.ts";

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
    recordAttempt({ family: "x", codeHash: "h", observedSharpe: 0, verdict: "errored" }, nested);
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
      {
        family: "x",
        codeHash: "h1",
        observedSharpe: 1,
        verdict: "rejected",
        now: "2026-01-01T00:00:00.000Z",
      },
      logPath,
    );
    recordAttempt(
      {
        family: "x",
        codeHash: "h2",
        observedSharpe: 1,
        verdict: "rejected",
        now: "2026-02-01T00:00:00.000Z",
      },
      logPath,
    );
    const out = readAttempts({}, logPath);
    expect(out[0]!.codeHash).toBe("h2");
    expect(out[1]!.codeHash).toBe("h1");
  });

  it("filters by family", () => {
    recordAttempt(
      { family: "mom", codeHash: "a", observedSharpe: 1, verdict: "rejected" },
      logPath,
    );
    recordAttempt(
      { family: "rev", codeHash: "b", observedSharpe: 1, verdict: "rejected" },
      logPath,
    );
    expect(readAttempts({ family: "mom" }, logPath).length).toBe(1);
  });

  it("filters by sinceMs", () => {
    recordAttempt(
      {
        family: "x",
        codeHash: "old",
        observedSharpe: 1,
        verdict: "rejected",
        now: "2025-01-01T00:00:00.000Z",
      },
      logPath,
    );
    recordAttempt(
      {
        family: "x",
        codeHash: "new",
        observedSharpe: 1,
        verdict: "rejected",
        now: "2026-01-01T00:00:00.000Z",
      },
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
    recordAttempt(
      { family: "mom", codeHash: "a", observedSharpe: 1, verdict: "rejected" },
      logPath,
    );
    recordAttempt(
      { family: "rev", codeHash: "b", observedSharpe: 1, verdict: "rejected" },
      logPath,
    );
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

// ============================================================================
// Dimensional correctness of the deflated-Sharpe gate (Tier-0 Group B, item 2)
// ============================================================================

describe("dynamicDeflatedThreshold: dimensional correctness", () => {
  const base = {
    family: "dimensional/BTCUSD",
    observedSharpeAnnualized: 2,
    annualization: 252,
    trialCountOverride: 99,
  } as const;

  it("null benchmark shrinks as the track record lengthens", () => {
    const short = dynamicDeflatedThreshold({ ...base, periods: 63 });
    const long = dynamicDeflatedThreshold({ ...base, periods: 2520 });

    // E[max Z] is dimensionless; the per-period null benchmark is E[max Z]/sqrt(n).
    // Before the fix this divided by sqrt(annualization), so the benchmark was
    // IDENTICAL for both track lengths.
    expect(long.expectedMaxSharpeNullAnnualized).toBeLessThan(
      short.expectedMaxSharpeNullAnnualized,
    );
    // A 40x longer track must shrink the bar by sqrt(40) ~ 6.3x.
    expect(
      short.expectedMaxSharpeNullAnnualized / long.expectedMaxSharpeNullAnnualized,
    ).toBeCloseTo(Math.sqrt(2520 / 63), 6);
  });

  it("null benchmark equals E[max Z]/sqrt(periods), annualized", () => {
    const periods = 1000;
    const ann = 252;
    const r = dynamicDeflatedThreshold({ ...base, periods, annualization: ann });
    const eMaxZ = expectedMaxSharpeUnderNull(base.trialCountOverride + 1);

    expect(r.expectedMaxSharpeNullAnnualized).toBeCloseTo(
      (eMaxZ / Math.sqrt(periods)) * Math.sqrt(ann),
      10,
    );
    // The mis-scaled version was eMaxZ (dimensionless) all the way through.
    expect(r.expectedMaxSharpeNullAnnualized).not.toBeCloseTo(eMaxZ, 3);
  });

  it("a longer track with the same Sharpe never faces a higher bar", () => {
    let prevBenchmark = Infinity;
    let prevP = -Infinity;
    for (const periods of [63, 126, 252, 504, 1260, 2520]) {
      const r = dynamicDeflatedThreshold({ ...base, periods });
      expect(r.expectedMaxSharpeNullAnnualized).toBeLessThan(prevBenchmark);
      expect(r.dsrPValue).toBeGreaterThanOrEqual(prevP);
      prevBenchmark = r.expectedMaxSharpeNullAnnualized;
      prevP = r.dsrPValue;
    }
  });

  it("p-value matches Bailey and Lopez de Prado on raw kurtosis, via an exact normal CDF", () => {
    const periods = 500;
    const ann = 252;
    const skewness = -0.4;
    const excessKurtosis = 1.5; // raw gamma4 = 4.5
    const r = dynamicDeflatedThreshold({
      ...base,
      periods,
      annualization: ann,
      skewness,
      excessKurtosis,
    });

    const eMaxZ = expectedMaxSharpeUnderNull(base.trialCountOverride + 1);
    const srPer = base.observedSharpeAnnualized / Math.sqrt(ann);
    const sr0Per = eMaxZ / Math.sqrt(periods);
    // (gamma4 - 1)/4 on RAW kurtosis == (excess + 2)/4. For a normal this is
    // 0.5, not 0; the old (excess/4) form deleted the term entirely.
    const kurtTerm = (excessKurtosis + 2) / 4;
    const den = Math.sqrt(1 - skewness * srPer + kurtTerm * srPer * srPer);
    const z = ((srPer - sr0Per) * Math.sqrt(periods - 1)) / den;

    expect(r.dsrPValue).toBeCloseTo(normalCdf(z), 12);
  });

  it("the non-normality term survives for normal returns (excess kurtosis 0)", () => {
    const periods = 500;
    const ann = 252;
    // Two calls whose ONLY difference is the kurtosis term contributing 0.5 vs 0.
    const normalCase = dynamicDeflatedThreshold({
      ...base,
      periods,
      annualization: ann,
      excessKurtosis: 0,
    });
    const termDeleted = dynamicDeflatedThreshold({
      ...base,
      periods,
      annualization: ann,
      excessKurtosis: -2, // drives kurtTerm to exactly 0
    });
    // A normal must carry a +0.5*SR^2 penalty, so its denominator is larger and
    // its p-value strictly lower. Before the fix these two were swapped.
    expect(normalCase.dsrPValue).toBeLessThan(termDeleted.dsrPValue);
  });

  it("normal CDF is exact, not the mis-scaled A&S 7.1.26 variant", () => {
    // The old hand-rolled CDF applied erf coefficients with t = 1/(1+p|x|) but
    // exp(-x^2/2), substituting the /sqrt(2) in the exponent only. Peak error
    // ~0.037 near x = 0.57, biased HIGH, which inflates every DSR p-value.
    const misScaled = (x: number): number => {
      const a1 = 0.254829592,
        a2 = -0.284496736,
        a3 = 1.421413741;
      const a4 = -1.453152027,
        a5 = 1.061405429,
        p = 0.3275911;
      const sign = x < 0 ? -1 : 1;
      const t = 1.0 / (1.0 + p * Math.abs(x));
      const y = 1.0 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-(x * x) / 2);
      return 0.5 * (1.0 + sign * y);
    };

    // The mis-scaled function really is that far off, and biased HIGH.
    expect(misScaled(0.567) - normalCdf(0.567)).toBeGreaterThan(0.03);
    // At the 0.95 decision point it reports 0.961 for a true 0.95, so a gate
    // set at "p > 0.95" was passing tracks that had not cleared it.
    expect(misScaled(1.6448536269514722)).toBeGreaterThan(0.96);

    // The module's own p-value now agrees with the exact CDF at every z it
    // produces, including the band where the mis-scaled variant was worst.
    for (const periods of [40, 50, 60, 80, 120, 500]) {
      const r = dynamicDeflatedThreshold({ ...base, periods, observedSharpeAnnualized: 1.2 });
      const eMaxZ = expectedMaxSharpeUnderNull(base.trialCountOverride + 1);
      const srPer = 1.2 / Math.sqrt(252);
      const sr0Per = eMaxZ / Math.sqrt(periods);
      const den = Math.sqrt(1 + 0.5 * srPer * srPer);
      const z = ((srPer - sr0Per) * Math.sqrt(periods - 1)) / den;
      expect(r.dsrPValue).toBeCloseTo(normalCdf(z), 12);
    }
  });
});
