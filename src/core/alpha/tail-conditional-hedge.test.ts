import { describe, expect, test } from "bun:test";
import {
  classifyTailConditionalHedges,
  formatTailConditionalHedge,
  type HedgeCandidate,
} from "./tail-conditional-hedge.ts";

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rng: () => number): number {
  const u1 = Math.max(rng(), 1e-12);
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/**
 * Build a target return series with normal periods (low vol) interspersed
 * with crisis periods (high vol + large drawdowns).
 */
function buildTargetWithRegimes(n: number, seed: number): number[] {
  const rng = mulberry32(seed);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    // Every 50 steps inject a crisis window of ~10 steps
    const inCrisis = (i % 50) >= 40;
    const vol = inCrisis ? 0.04 : 0.008;
    const drift = inCrisis ? -0.005 : 0.0005;
    out.push(drift + vol * gaussian(rng));
  }
  return out;
}

/** Hedge that hedges well in normal times but breaks down in tail. */
function buildPeaceTimeHedge(target: number[], seed: number): number[] {
  const rng = mulberry32(seed);
  const out: number[] = [];
  for (let i = 0; i < target.length; i++) {
    const inCrisis = (i % 50) >= 40;
    if (inCrisis) {
      // In crisis, the hedge moves WITH the target — fails as a hedge
      out.push(0.5 * target[i]! + 0.005 * gaussian(rng));
    } else {
      // In peace, the hedge moves against the target — works
      out.push(-0.7 * target[i]! + 0.002 * gaussian(rng));
    }
  }
  return out;
}

/** Hedge that holds up in both regimes. */
function buildRobustHedge(target: number[], seed: number): number[] {
  const rng = mulberry32(seed);
  return target.map((t) => -0.8 * t + 0.002 * gaussian(rng));
}

/** Hedge that moves with the target (wrong sign). */
function buildAntiHedge(target: number[], seed: number): number[] {
  const rng = mulberry32(seed);
  return target.map((t) => 0.6 * t + 0.005 * gaussian(rng));
}

/** Hedge with random noise — no real signal. */
function buildNoiseHedge(n: number, seed: number): number[] {
  const rng = mulberry32(seed);
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(0.015 * gaussian(rng));
  return out;
}

describe("classifyTailConditionalHedges", () => {
  test("insufficient data → insufficient_data verdict", () => {
    const target = buildTargetWithRegimes(20, 1);
    const r = classifyTailConditionalHedges({
      targetReturns: target,
      candidateHedges: [{ symbol: "X", returns: target.map((t) => -t) }],
    });
    expect(r.verdict).toBe("insufficient_data");
  });

  test("robust hedge identified", () => {
    const target = buildTargetWithRegimes(252, 1);
    const robust: HedgeCandidate = {
      symbol: "ROBUST",
      returns: buildRobustHedge(target, 2),
    };
    const r = classifyTailConditionalHedges({
      targetReturns: target,
      candidateHedges: [robust],
    });
    expect(r.verdict).toBe("ranked");
    const cls = r.hedges.find((h) => h.symbol === "ROBUST")!;
    expect(cls.reliability).toBe("robust");
  });

  test("peace-time hedge identified (Matt's Treasury-style)", () => {
    const target = buildTargetWithRegimes(252, 3);
    const peaceTime: HedgeCandidate = {
      symbol: "TREASURY",
      returns: buildPeaceTimeHedge(target, 4),
    };
    const r = classifyTailConditionalHedges({
      targetReturns: target,
      candidateHedges: [peaceTime],
    });
    const cls = r.hedges.find((h) => h.symbol === "TREASURY")!;
    // Should be peace_time, fair_weather, or volatile — anything but robust
    expect(cls.reliability).not.toBe("robust");
    expect(["peace_time", "fair_weather", "volatile"]).toContain(cls.reliability);
  });

  test("anti-hedge flagged (positive correlation)", () => {
    const target = buildTargetWithRegimes(252, 5);
    const anti: HedgeCandidate = {
      symbol: "WRONG_SIGN",
      returns: buildAntiHedge(target, 6),
    };
    const r = classifyTailConditionalHedges({
      targetReturns: target,
      candidateHedges: [anti],
    });
    const cls = r.hedges.find((h) => h.symbol === "WRONG_SIGN")!;
    expect(cls.reliability).toBe("anti_hedge");
  });

  test("ranking puts robust first, anti-hedge last", () => {
    const target = buildTargetWithRegimes(252, 7);
    const candidates: HedgeCandidate[] = [
      { symbol: "ANTI", returns: buildAntiHedge(target, 8) },
      { symbol: "NOISE", returns: buildNoiseHedge(target.length, 9) },
      { symbol: "ROBUST", returns: buildRobustHedge(target, 10) },
      { symbol: "PEACE", returns: buildPeaceTimeHedge(target, 11) },
    ];
    const r = classifyTailConditionalHedges({
      targetReturns: target,
      candidateHedges: candidates,
    });
    expect(r.hedges[0]!.symbol).toBe("ROBUST");
    expect(r.hedges[r.hedges.length - 1]!.symbol).toBe("ANTI");
    expect(r.bestRobustHedge).toBe("ROBUST");
  });

  test("length-mismatch hedge flagged insufficient", () => {
    const target = buildTargetWithRegimes(252, 12);
    const bad: HedgeCandidate = {
      symbol: "MISMATCHED",
      returns: target.slice(0, 100),
    };
    const r = classifyTailConditionalHedges({
      targetReturns: target,
      candidateHedges: [bad],
    });
    const cls = r.hedges.find((h) => h.symbol === "MISMATCHED")!;
    expect(cls.reliability).toBe("insufficient");
  });

  test("custom thresholds respected", () => {
    const target = buildTargetWithRegimes(252, 13);
    const robust = buildRobustHedge(target, 14);
    const strict = classifyTailConditionalHedges({
      targetReturns: target,
      candidateHedges: [{ symbol: "R", returns: robust }],
      strongCorrThreshold: 0.99, // impossibly strict
    });
    const lax = classifyTailConditionalHedges({
      targetReturns: target,
      candidateHedges: [{ symbol: "R", returns: robust }],
      strongCorrThreshold: 0.1,
    });
    // Under impossible strictness, even good hedges shouldn't be "robust"
    expect(strict.hedges[0]!.reliability).not.toBe("robust");
    expect(lax.hedges[0]!.reliability).toBe("robust");
  });

  test("regime observations are roughly correct given default quantiles", () => {
    const target = buildTargetWithRegimes(252, 15);
    const r = classifyTailConditionalHedges({
      targetReturns: target,
      candidateHedges: [{ symbol: "R", returns: buildRobustHedge(target, 16) }],
    });
    // Default: top 10% tail, bottom 50% peace
    const valid = target.length - 19;
    expect(r.tailObservations).toBeGreaterThan(valid * 0.05);
    expect(r.tailObservations).toBeLessThan(valid * 0.20);
    expect(r.peaceObservations).toBeGreaterThan(valid * 0.40);
    expect(r.peaceObservations).toBeLessThan(valid * 0.60);
  });

  test("Matt's Treasury hedge anecdote: peace-time correlation strong, tail-time fails", () => {
    const target = buildTargetWithRegimes(500, 17);
    const treasury: HedgeCandidate = {
      symbol: "TREASURY",
      returns: buildPeaceTimeHedge(target, 18),
    };
    const r = classifyTailConditionalHedges({
      targetReturns: target,
      candidateHedges: [treasury],
    });
    const cls = r.hedges.find((h) => h.symbol === "TREASURY")!;
    expect(cls.peaceTimeCorrelation).not.toBeNull();
    expect(cls.tailTimeCorrelation).not.toBeNull();
    // Peace correlation should be strongly negative; tail should be less so
    expect(cls.peaceTimeCorrelation!).toBeLessThan(-0.3);
    expect(cls.tailTimeCorrelation!).toBeGreaterThan(cls.peaceTimeCorrelation!);
  });
});

describe("formatTailConditionalHedge", () => {
  test("renders header + per-hedge classifications", () => {
    const target = buildTargetWithRegimes(252, 19);
    const r = classifyTailConditionalHedges({
      targetReturns: target,
      candidateHedges: [
        { symbol: "A", returns: buildRobustHedge(target, 20) },
        { symbol: "B", returns: buildAntiHedge(target, 21) },
      ],
    });
    const text = formatTailConditionalHedge(r);
    expect(text).toContain("Tail-Conditional Hedge");
    expect(text).toContain("Candidates");
    expect(text).toContain("peace=");
    expect(text).toContain("tail=");
  });
});
