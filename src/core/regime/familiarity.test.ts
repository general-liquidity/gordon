import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

import {
  buildFamiliarityReference,
  buildFamiliarityReferences,
  conservativeVerdict,
  euclideanDistanceToCentroid,
  evaluateFamiliarity,
  familiarityPercentile,
  type FamiliarityReference,
  type FeatureVector,
} from "./familiarity.ts";

// Deterministic sampling keeps every assertion reproducible without a seeded fixture file.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussianCloud(
  seed: number,
  count: number,
  centroid: readonly number[],
  sd: number,
): FeatureVector[] {
  const rand = mulberry32(seed);
  const out: FeatureVector[] = [];
  for (let i = 0; i < count; i++) {
    const point: number[] = [];
    for (let d = 0; d < centroid.length; d++) {
      const u = Math.max(rand(), 1e-12);
      const v = rand();
      const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
      point.push(centroid[d]! + z * sd);
    }
    out.push(point);
  }
  return out;
}

function offsetFrom(centroid: readonly number[], deltaFirstAxis: number): FeatureVector {
  return centroid.map((c, i) => (i === 0 ? c + deltaFirstAxis : c));
}

const TRENDING_CENTROID = [30, 0.8, 55] as const;
const RANGING_CENTROID = [12, 0.2, 50] as const;

function standardReferences(): FamiliarityReference[] {
  return buildFamiliarityReferences([
    { label: "trending_up", vectors: gaussianCloud(11, 120, TRENDING_CENTROID, 1) },
    { label: "ranging", vectors: gaussianCloud(29, 120, RANGING_CENTROID, 1) },
  ]);
}

describe("familiarity gate", () => {
  test("a state drawn from a known regime is recognized and passes the gate", () => {
    const references = standardReferences();
    const window = gaussianCloud(77, 6, TRENDING_CENTROID, 0.3);

    const result = evaluateFamiliarity({ references, window, nowMs: 1_700_000_000_000 });

    expect(result.familiar).toBe(true);
    expect(result.outOfDistribution).toBe(false);
    expect(result.matchedReference).toBe("trending_up");
    expect(result.reason).toBe("matched");
    expect(result.score).toBeGreaterThan(0.5);
    expect(result.verdict).toBeNull();
    expect(result.evaluatedAtMs).toBe(1_700_000_000_000);
  });

  test("a state far from every reference reports that nothing matched instead of a best-of-bad label", () => {
    const references = standardReferences();
    const alien = [500, -40, -900];

    const result = evaluateFamiliarity({
      references,
      window: [alien, alien, alien, alien],
      nowMs: 1,
    });

    expect(result.outOfDistribution).toBe(true);
    expect(result.familiar).toBe(false);
    expect(result.matchedReference).toBeNull();
    expect(result.reason).toBe("out_of_distribution");
    // The per-reference scores are still reported, so the operator sees the near miss
    // without the result ever naming one as the match.
    expect(result.perReference).toHaveLength(2);
    for (const entry of result.perReference) {
      expect(entry.smoothedScore).not.toBeNull();
      expect(Number.isFinite(entry.smoothedScore!)).toBe(true);
    }
  });

  test("familiarity falls monotonically as states drift further from the references and the gate eventually fires", () => {
    const references = standardReferences();
    const scores: number[] = [];
    let firedAt = -1;

    for (let step = 0; step <= 12; step++) {
      const probe = offsetFrom(TRENDING_CENTROID, step * 0.75);
      const result = evaluateFamiliarity({ references, window: [probe], nowMs: 0 });
      scores.push(result.score);
      if (result.outOfDistribution && firedAt === -1) firedAt = step;
    }

    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]!).toBeLessThan(scores[i - 1]!);
    }
    expect(firedAt).toBeGreaterThan(0);
    expect(firedAt).toBeLessThan(12);
  });

  test("one anomalous bar does not fire the gate but a sustained shift does", () => {
    const references = standardReferences();
    const calm = gaussianCloud(101, 7, TRENDING_CENTROID, 0.15);
    const shocked = offsetFrom(TRENDING_CENTROID, 60);

    const spike = evaluateFamiliarity({
      references,
      window: [...calm, shocked],
      nowMs: 0,
    });
    expect(spike.outOfDistribution).toBe(false);
    expect(spike.matchedReference).toBe("trending_up");

    const sustained = evaluateFamiliarity({
      references,
      window: [...calm, ...Array.from({ length: 8 }, () => shocked)],
      nowMs: 0,
    });
    expect(sustained.outOfDistribution).toBe(true);
    expect(sustained.matchedReference).toBeNull();
    expect(sustained.score).toBeLessThan(spike.score);
  });

  test("percentile normalization picks the right reference where a raw distance picks the wrong one", () => {
    const references = buildFamiliarityReferences([
      { label: "tight", vectors: gaussianCloud(5, 100, [0, 0], 0.05) },
      { label: "broad", vectors: gaussianCloud(6, 100, [3, 0], 1) },
    ]);
    const [tight, broad] = references as [FamiliarityReference, FamiliarityReference];
    const probe = [1.4, 0];

    // Raw geometry says "tight": the probe is nearer that centroid in plain units.
    expect(euclideanDistanceToCentroid(tight, probe)!).toBeLessThan(
      euclideanDistanceToCentroid(broad, probe)!,
    );

    // The percentile says "broad", because 1.4 units is 28 standard deviations of the
    // tight dynamic and well under two of the broad one.
    const tightPercentile = familiarityPercentile(tight, probe)!;
    const broadPercentile = familiarityPercentile(broad, probe)!;
    expect(broadPercentile).toBeGreaterThan(tightPercentile);

    const result = evaluateFamiliarity({ references, window: [probe], nowMs: 0 });
    expect(result.matchedReference).toBe("broad");

    // Both live on one shared 0..1 scale despite the twentyfold difference in spread.
    for (const p of [tightPercentile, broadPercentile]) {
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    }
  });

  test("degenerate references abstain instead of producing a distance", () => {
    const empty = buildFamiliarityReference("empty", []);
    const single = buildFamiliarityReference("single", [[1, 2, 3]]);
    const constant = buildFamiliarityReference(
      "constant",
      Array.from({ length: 10 }, () => [1, 2, 3]),
    );
    const ragged = buildFamiliarityReference("ragged", [
      [1, 2],
      [1, 2, 3],
      [1, 2],
      [1, 2],
    ]);

    expect(empty.defect).toBe("empty");
    expect(single.defect).toBe("insufficient_samples");
    expect(constant.defect).toBe("zero_variance");
    expect(ragged.defect).toBe("dimension_mismatch");

    for (const reference of [empty, single, constant, ragged]) {
      expect(familiarityPercentile(reference, [1, 2, 3])).toBeNull();
    }

    const result = evaluateFamiliarity({
      references: [empty, single, constant, ragged],
      window: [[1, 2, 3]],
      nowMs: 42,
    });
    expect(result.reason).toBe("no_usable_reference");
    expect(result.matchedReference).toBeNull();
    expect(result.score).toBe(0);
    expect(Number.isNaN(result.score)).toBe(false);
    expect(result.verdict?.action).toBe("no_new_positions");
  });

  test("an empty state window abstains rather than reporting a match", () => {
    const result = evaluateFamiliarity({
      references: standardReferences(),
      window: [],
      nowMs: 9,
    });
    expect(result.reason).toBe("empty_window");
    expect(result.outOfDistribution).toBe(true);
    expect(result.matchedReference).toBeNull();
    expect(result.verdict).not.toBeNull();
  });

  test("the conservative verdict holds within the drawdown limit, flattens beyond it, and never opens anything new", () => {
    const flat = conservativeVerdict(undefined);
    expect(flat.action).toBe("no_new_positions");

    const within = conservativeVerdict({
      hasOpenPosition: true,
      tradeDrawdownPct: 1.2,
      maxTradeDrawdownPct: 3,
    });
    expect(within.action).toBe("hold_within_limit");

    const breached = conservativeVerdict({
      hasOpenPosition: true,
      tradeDrawdownPct: 4.5,
      maxTradeDrawdownPct: 3,
    });
    expect(breached.action).toBe("flatten");

    for (const verdict of [flat, within, breached]) {
      expect(verdict.allowNewPositions).toBe(false);
    }
  });

  test("the gate returns a decision and carries the position state into it rather than acting", () => {
    const result = evaluateFamiliarity({
      references: standardReferences(),
      window: [[500, -40, -900]],
      nowMs: 0,
      position: { hasOpenPosition: true, tradeDrawdownPct: 0.9, maxTradeDrawdownPct: 2 },
    });
    expect(result.verdict?.action).toBe("hold_within_limit");
    expect(result.verdict?.allowNewPositions).toBe(false);
  });

  test("evaluation is pure and takes its clock from the caller", () => {
    const references = standardReferences();
    const window = gaussianCloud(303, 5, RANGING_CENTROID, 0.4);

    const first = evaluateFamiliarity({ references, window, nowMs: 1000 });
    const second = evaluateFamiliarity({ references, window, nowMs: 1000 });
    expect(second).toEqual(first);

    const later = evaluateFamiliarity({ references, window, nowMs: 2000 });
    expect(later.evaluatedAtMs).toBe(2000);
    expect(later.score).toBe(first.score);

    const source = readFileSync(new URL("./familiarity.ts", import.meta.url), "utf8");
    expect(source).not.toContain("Date.now");
    expect(source).not.toContain("new Date(");
    expect(source).not.toContain("node:fs");
    expect(source).not.toContain("process.env");
  });
});
