import { describe, it, expect } from "bun:test";
import {
  isFisherTransformEnabled,
  computeFisherTransform,
  computeInverseFisher,
  fisherToPayload,
  FISHER_TRANSFORM_FLAG_ENV,
} from "./fisherTransform.ts";

describe("isFisherTransformEnabled", () => {
  it("respects the flag", () => {
    expect(isFisherTransformEnabled({})).toBe(false);
    expect(isFisherTransformEnabled({ [FISHER_TRANSFORM_FLAG_ENV]: "1" })).toBe(true);
  });
});

describe("computeFisherTransform", () => {
  it("short series → NaN current value", () => {
    const r = computeFisherTransform({ prices: [1, 2, 3] });
    expect(Number.isNaN(r.currentFisher)).toBe(true);
  });

  it("monotone rise produces large positive fisher near series end", () => {
    const prices = Array.from({ length: 30 }, (_, i) => 100 + i);
    const r = computeFisherTransform({ prices });
    expect(r.currentFisher).toBeGreaterThan(0.5);
  });

  it("monotone fall produces large negative fisher near series end", () => {
    const prices = Array.from({ length: 30 }, (_, i) => 100 - i);
    const r = computeFisherTransform({ prices });
    expect(r.currentFisher).toBeLessThan(-0.5);
  });

  it("does not produce non-finite values in normal operation", () => {
    const prices = Array.from({ length: 30 }, (_, i) => 100 + Math.sin(i / 3));
    const r = computeFisherTransform({ prices });
    for (let i = 10; i < r.fisher.length; i++) {
      expect(Number.isFinite(r.fisher[i]!)).toBe(true);
    }
  });
});

describe("computeInverseFisher", () => {
  it("bounds output to (-1, 1)", () => {
    const r = computeInverseFisher({ values: [-100, -10, 0, 10, 100] });
    for (const v of r.inverse) {
      expect(v).toBeGreaterThan(-1.0001);
      expect(v).toBeLessThan(1.0001);
    }
  });

  it("zero input → zero output", () => {
    const r = computeInverseFisher({ values: [0, 0, 0] });
    for (const v of r.inverse) expect(v).toBeCloseTo(0, 5);
  });

  it("positive input → positive output", () => {
    const r = computeInverseFisher({ values: [5] });
    expect(r.inverse[0]!).toBeGreaterThan(0);
  });
});

describe("fisherToPayload", () => {
  it("emits a stable shape", () => {
    const r = computeFisherTransform({
      prices: Array.from({ length: 30 }, (_, i) => 100 + i),
    });
    const p = fisherToPayload(r) as { kind: string; currentFisher: number };
    expect(p.kind).toBe("fisher_transform.computed");
    expect(typeof p.currentFisher).toBe("number");
  });
});
