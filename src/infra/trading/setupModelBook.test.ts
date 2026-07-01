import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  recordCandidate,
  recordOutcome,
  readModelBook,
  computeForwardOutcome,
  cohortStats,
  deriveRuleCandidates,
  type SetupCandidate,
  type SetupModelBookEntry,
} from "./setupModelBook.ts";

let dir: string;
let path: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "gordon-modelbook-"));
  path = join(dir, "book.jsonl");
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function cand(id: string, overrides: Partial<SetupCandidate> = {}): SetupCandidate {
  return {
    id,
    loggedAt: "2026-07-01T00:00:00.000Z",
    symbol: "BTC",
    side: "long",
    entryRef: 100,
    setupTags: ["breakout"],
    ...overrides,
  };
}

// ===================== computeForwardOutcome =====================

describe("computeForwardOutcome", () => {
  it("computes MFE/MAE/close for a long", () => {
    const o = computeForwardOutcome({
      entryRef: 100,
      side: "long",
      horizon: "5d",
      bars: [
        { high: 105, low: 98, close: 103 },
        { high: 110, low: 101, close: 108 },
      ],
    });
    expect(o.mfePct).toBeCloseTo(0.1, 6); // high 110
    expect(o.maePct).toBeCloseTo(-0.02, 6); // low 98
    expect(o.closePct).toBeCloseTo(0.08, 6); // last close 108
    expect(o.outcomeTag).toBe("win");
  });

  it("inverts excursions for a short", () => {
    const o = computeForwardOutcome({
      entryRef: 100,
      side: "short",
      horizon: "3d",
      bars: [{ high: 104, low: 95, close: 96 }],
    });
    expect(o.mfePct).toBeCloseTo(0.05, 6); // low 95 favors short
    expect(o.maePct).toBeCloseTo(-0.04, 6); // high 104 hurts short
    expect(o.closePct).toBeCloseTo(0.04, 6);
    expect(o.outcomeTag).toBe("win");
  });

  it("tags a stop-out (long)", () => {
    const o = computeForwardOutcome({
      entryRef: 100,
      side: "long",
      horizon: "5d",
      stop: 96,
      target: 110,
      bars: [{ high: 101, low: 95, close: 97 }],
    });
    expect(o.outcomeTag).toBe("stopped_out");
  });

  it("tags a target-hit (long) when stop untouched", () => {
    const o = computeForwardOutcome({
      entryRef: 100,
      side: "long",
      horizon: "5d",
      stop: 90,
      target: 108,
      bars: [{ high: 109, low: 99, close: 107 }],
    });
    expect(o.outcomeTag).toBe("target_hit");
  });

  it("resolves adverse-first when both levels touched in one bar", () => {
    const o = computeForwardOutcome({
      entryRef: 100,
      side: "long",
      horizon: "5d",
      stop: 96,
      target: 108,
      bars: [{ high: 109, low: 95, close: 100 }],
    });
    expect(o.outcomeTag).toBe("stopped_out");
  });

  it("tags a scratch inside the band", () => {
    const o = computeForwardOutcome({
      entryRef: 100,
      side: "long",
      horizon: "3d",
      bars: [{ high: 100.2, low: 99.8, close: 100.1 }],
    });
    expect(o.outcomeTag).toBe("scratch");
  });

  it("handles empty bars gracefully", () => {
    const o = computeForwardOutcome({ entryRef: 100, side: "long", horizon: "3d", bars: [] });
    expect(o.outcomeTag).toBe("scratch");
    expect(o.mfePct).toBe(0);
  });
});

// ===================== persistence =====================

describe("model-book persistence", () => {
  it("round-trips candidates and outcomes, last-write-wins per horizon", () => {
    recordCandidate(cand("c1"), path);
    recordCandidate(cand("c2", { symbol: "ETH" }), path);
    recordOutcome("c1", {
      horizon: "3d",
      computedAt: "2026-07-04T00:00:00.000Z",
      mfePct: 0.05,
      maePct: -0.01,
      closePct: 0.03,
      outcomeTag: "win",
    }, path);
    // superseding 3d outcome for c1
    recordOutcome("c1", {
      horizon: "3d",
      computedAt: "2026-07-04T12:00:00.000Z",
      mfePct: 0.07,
      maePct: -0.01,
      closePct: 0.06,
      outcomeTag: "win",
    }, path);

    const book = readModelBook(path);
    expect(book).toHaveLength(2);
    const c1 = book.find((e) => e.candidate.id === "c1")!;
    expect(c1.outcomes).toHaveLength(1);
    expect(c1.outcomes[0]!.mfePct).toBeCloseTo(0.07, 6); // last write won
  });

  it("skips orphan outcomes with no candidate", () => {
    recordOutcome("ghost", {
      horizon: "5d",
      computedAt: "2026-07-06T00:00:00.000Z",
      mfePct: 0.1,
      maePct: 0,
      closePct: 0.1,
      outcomeTag: "win",
    }, path);
    expect(readModelBook(path)).toHaveLength(0);
  });

  it("returns empty for a missing file", () => {
    expect(readModelBook(join(dir, "nope.jsonl"))).toEqual([]);
  });
});

// ===================== cohort stats + rules =====================

function makeEntry(
  id: string,
  tags: string[],
  closePct: number,
  extra: Partial<{ mfePct: number; maePct: number; tag: "win" | "loss" | "target_hit" | "stopped_out" | "scratch" }> = {},
): SetupModelBookEntry {
  return {
    candidate: cand(id, { setupTags: tags }),
    outcomes: [
      {
        horizon: "5d",
        computedAt: "2026-07-06T00:00:00.000Z",
        mfePct: extra.mfePct ?? Math.max(closePct, 0.02),
        maePct: extra.maePct ?? -0.01,
        closePct,
        outcomeTag: extra.tag ?? (closePct > 0 ? "win" : "loss"),
      },
    ],
  };
}

describe("cohortStats + deriveRuleCandidates", () => {
  it("aggregates per-tag win-rate and MFE/MAE ratio", () => {
    const entries = [
      makeEntry("a", ["breakout"], 0.04, { mfePct: 0.06, maePct: -0.02 }),
      makeEntry("b", ["breakout"], -0.02, { mfePct: 0.01, maePct: -0.03 }),
    ];
    const stats = cohortStats(entries, { horizon: "5d" });
    const breakout = stats.find((s) => s.tag === "breakout")!;
    expect(breakout.n).toBe(2);
    expect(breakout.matured).toBe(2);
    expect(breakout.winRate).toBeCloseTo(0.5, 6);
    expect(breakout.mfeToMaeRatio).toBeGreaterThan(0);
  });

  it("counts a candidate toward every one of its tags", () => {
    const entries = [makeEntry("a", ["breakout", "high-volume"], 0.03)];
    const stats = cohortStats(entries);
    expect(stats.map((s) => s.tag).sort()).toEqual(["breakout", "high-volume"]);
  });

  it("ignores outcomes at a non-matching horizon", () => {
    const e = makeEntry("a", ["breakout"], 0.03);
    e.outcomes[0]!.horizon = "3d";
    const stats = cohortStats([e], { horizon: "5d" });
    expect(stats[0]!.matured).toBe(0);
    expect(stats[0]!.n).toBe(1);
  });

  it("mints a 'prefer' rule for a strong cohort past min sample", () => {
    const entries = Array.from({ length: 10 }, (_, i) =>
      makeEntry(`w${i}`, ["momentum"], 0.05, { mfePct: 0.08, maePct: -0.02 }),
    );
    const rules = deriveRuleCandidates(cohortStats(entries));
    const rule = rules.find((r) => r.tag === "momentum")!;
    expect(rule.kind).toBe("prefer");
  });

  it("mints an 'avoid' rule for a weak cohort past min sample", () => {
    const entries = Array.from({ length: 10 }, (_, i) =>
      makeEntry(`l${i}`, ["fade-gap"], -0.03, { mfePct: 0.01, maePct: -0.05 }),
    );
    const rules = deriveRuleCandidates(cohortStats(entries));
    const rule = rules.find((r) => r.tag === "fade-gap")!;
    expect(rule.kind).toBe("avoid");
  });

  it("mints no rule below the minimum sample", () => {
    const entries = Array.from({ length: 3 }, (_, i) =>
      makeEntry(`w${i}`, ["thin"], 0.05, { mfePct: 0.08, maePct: -0.02 }),
    );
    expect(deriveRuleCandidates(cohortStats(entries))).toHaveLength(0);
  });
});
