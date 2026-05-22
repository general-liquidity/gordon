import { describe, it, expect } from "bun:test";
import {
  selectVariant,
  selectVariantWithCounterpart,
  makeSeededRng,
} from "./router.ts";
import type { AbTestConfig } from "./types.ts";

const baseConfig: AbTestConfig = {
  testId: "test",
  variantA: { id: "a", modelId: "model-a" },
  variantB: { id: "b", modelId: "model-b" },
};

describe("selectVariant — basic", () => {
  it("returns variantA when rng draws below split", () => {
    const v = selectVariant({ ...baseConfig, trafficSplit: 0.5 }, () => 0.3);
    expect(v.id).toBe("a");
  });

  it("returns variantB when rng draws above split", () => {
    const v = selectVariant({ ...baseConfig, trafficSplit: 0.5 }, () => 0.8);
    expect(v.id).toBe("b");
  });

  it("defaults to 50/50 split when trafficSplit omitted", () => {
    const v1 = selectVariant(baseConfig, () => 0.49);
    const v2 = selectVariant(baseConfig, () => 0.51);
    expect(v1.id).toBe("a");
    expect(v2.id).toBe("b");
  });
});

describe("selectVariant — edge cases", () => {
  it("trafficSplit=1 always returns variantA", () => {
    expect(selectVariant({ ...baseConfig, trafficSplit: 1 }, () => 0.99).id).toBe("a");
    expect(selectVariant({ ...baseConfig, trafficSplit: 1 }, () => 0).id).toBe("a");
  });

  it("trafficSplit=0 always returns variantB", () => {
    expect(selectVariant({ ...baseConfig, trafficSplit: 0 }, () => 0).id).toBe("b");
    expect(selectVariant({ ...baseConfig, trafficSplit: 0 }, () => 0.99).id).toBe("b");
  });

  it("clamps out-of-range trafficSplit silently", () => {
    expect(selectVariant({ ...baseConfig, trafficSplit: 1.5 }, () => 0.5).id).toBe("a");
    expect(selectVariant({ ...baseConfig, trafficSplit: -0.5 }, () => 0).id).toBe("b");
  });
});

describe("selectVariant — seeded determinism", () => {
  it("identical seeds produce identical sequences", () => {
    const rng1 = makeSeededRng(42);
    const rng2 = makeSeededRng(42);
    const seq1 = Array.from({ length: 20 }, () => selectVariant(baseConfig, rng1).id);
    const seq2 = Array.from({ length: 20 }, () => selectVariant(baseConfig, rng2).id);
    expect(seq1).toEqual(seq2);
  });

  it("different seeds produce different sequences", () => {
    const rng1 = makeSeededRng(1);
    const rng2 = makeSeededRng(999);
    const seq1 = Array.from({ length: 30 }, () => selectVariant(baseConfig, rng1).id);
    const seq2 = Array.from({ length: 30 }, () => selectVariant(baseConfig, rng2).id);
    expect(seq1).not.toEqual(seq2);
  });

  it("over many draws approximates the configured split", () => {
    const rng = makeSeededRng(12345);
    let aCount = 0;
    const N = 1000;
    for (let i = 0; i < N; i++) {
      if (selectVariant({ ...baseConfig, trafficSplit: 0.3 }, rng).id === "a") aCount++;
    }
    const ratio = aCount / N;
    expect(ratio).toBeGreaterThan(0.25);
    expect(ratio).toBeLessThan(0.35);
  });
});

describe("selectVariantWithCounterpart", () => {
  it("returns the other variant alongside the chosen one", () => {
    const { chosen, other } = selectVariantWithCounterpart(baseConfig, () => 0.1);
    expect(chosen.id).toBe("a");
    expect(other.id).toBe("b");
  });

  it("flips the pair when other variant is chosen", () => {
    const { chosen, other } = selectVariantWithCounterpart(baseConfig, () => 0.9);
    expect(chosen.id).toBe("b");
    expect(other.id).toBe("a");
  });
});
