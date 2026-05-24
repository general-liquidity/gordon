import { describe, expect, test } from "bun:test";
import {
  classifyVolumePatternEdge,
  formatVolumePatternEdge,
  type VolumePatternBar,
} from "./volume-pattern-edge.ts";

function bar(volume: number, open = 100, close = 100): VolumePatternBar {
  return {
    open,
    high: Math.max(open, close) + 0.5,
    low: Math.min(open, close) - 0.5,
    close,
    volume,
  };
}

describe("classifyVolumePatternEdge", () => {
  test("too few bars → insufficient_data", () => {
    const bars = [bar(1000), bar(1100)];
    const r = classifyVolumePatternEdge(bars);
    expect(r.edgeActivation).toBe("insufficient_data");
  });

  test("increasing volume → momentum_favorable", () => {
    const bars: VolumePatternBar[] = [];
    for (let i = 0; i < 20; i++) bars.push(bar(1000 + i * 100));
    const r = classifyVolumePatternEdge(bars);
    expect(r.pattern).toBe("increasing");
    expect(r.edgeActivation).toBe("momentum_favorable");
  });

  test("decreasing volume → no_edge", () => {
    const bars: VolumePatternBar[] = [];
    for (let i = 0; i < 20; i++) bars.push(bar(3000 - i * 100));
    const r = classifyVolumePatternEdge(bars);
    expect(r.pattern).toBe("decreasing");
    expect(r.edgeActivation).toBe("no_edge");
  });

  test("flat volume → mean_reversion_favorable", () => {
    const bars: VolumePatternBar[] = [];
    for (let i = 0; i < 20; i++) bars.push(bar(1000 + (i % 3) * 10));
    const r = classifyVolumePatternEdge(bars);
    expect(r.pattern).toBe("flat");
    expect(r.edgeActivation).toBe("mean_reversion_favorable");
  });

  test("spike with price expansion → reversal_setup", () => {
    const bars: VolumePatternBar[] = [];
    for (let i = 0; i < 19; i++) bars.push(bar(1000));
    // Terminal: 4× mean volume + 5% body
    bars.push({ open: 100, high: 106, low: 99, close: 105, volume: 4000 });
    const r = classifyVolumePatternEdge(bars);
    expect(r.pattern).toBe("spike_with_price");
    expect(r.edgeActivation).toBe("reversal_setup");
  });

  test("spike WITHOUT price expansion → no_edge (isolated spike)", () => {
    const bars: VolumePatternBar[] = [];
    for (let i = 0; i < 19; i++) bars.push(bar(1000));
    // Terminal: 4× mean volume but tiny 0.1% body (absorption, not expansion)
    bars.push({ open: 100, high: 100.5, low: 99.5, close: 100.1, volume: 4000 });
    const r = classifyVolumePatternEdge(bars);
    expect(r.pattern).toBe("spike_isolated");
    expect(r.edgeActivation).toBe("no_edge");
  });

  test("terminalVolumeMultiple = terminalVolume / meanVolume", () => {
    const bars: VolumePatternBar[] = [];
    for (let i = 0; i < 20; i++) bars.push(bar(1000));
    const r = classifyVolumePatternEdge(bars);
    expect(r.terminalVolumeMultiple).toBeCloseTo(1.0, 4);
  });

  test("custom spike multiple changes spike threshold", () => {
    const bars: VolumePatternBar[] = [];
    for (let i = 0; i < 19; i++) bars.push(bar(1000));
    bars.push({ open: 100, high: 105, low: 99, close: 104, volume: 1800 });
    const def = classifyVolumePatternEdge(bars); // default 2.5× → not a spike
    const loose = classifyVolumePatternEdge(bars, { spikeMultiple: 1.5 });
    expect(def.pattern).not.toBe("spike_with_price");
    expect(def.pattern).not.toBe("spike_isolated");
    expect(loose.pattern).toBe("spike_with_price");
  });

  test("custom slope threshold reclassifies borderline trends", () => {
    const bars: VolumePatternBar[] = [];
    for (let i = 0; i < 20; i++) bars.push(bar(1000 + i * 10));
    const def = classifyVolumePatternEdge(bars);
    const strict = classifyVolumePatternEdge(bars, { trendingSlopePctPerBar: 0.15 });
    if (def.pattern === "increasing") {
      expect(strict.pattern).not.toBe("increasing");
    }
  });

  test("window cap respected", () => {
    const bars: VolumePatternBar[] = [];
    for (let i = 0; i < 60; i++) bars.push(bar(1000 + i * 10));
    const r = classifyVolumePatternEdge(bars, { window: 10 });
    expect(r.windowUsed).toBe(10);
  });

  test("patternScore in [0, 1] for every verdict", () => {
    const inputs: VolumePatternBar[][] = [];
    // increasing
    const inc: VolumePatternBar[] = [];
    for (let i = 0; i < 20; i++) inc.push(bar(1000 + i * 100));
    inputs.push(inc);
    // flat
    const flat: VolumePatternBar[] = [];
    for (let i = 0; i < 20; i++) flat.push(bar(1000));
    inputs.push(flat);
    // spike_with_price
    const sp: VolumePatternBar[] = [];
    for (let i = 0; i < 19; i++) sp.push(bar(1000));
    sp.push({ open: 100, high: 106, low: 99, close: 105, volume: 4000 });
    inputs.push(sp);
    for (const xs of inputs) {
      const r = classifyVolumePatternEdge(xs);
      expect(r.patternScore).toBeGreaterThanOrEqual(0);
      expect(r.patternScore).toBeLessThanOrEqual(1);
    }
  });

  test("zero mean volume → insufficient_data", () => {
    const bars: VolumePatternBar[] = [];
    for (let i = 0; i < 20; i++) bars.push(bar(0));
    const r = classifyVolumePatternEdge(bars);
    expect(r.edgeActivation).toBe("insufficient_data");
  });
});

describe("formatVolumePatternEdge", () => {
  test("renders verdict + diagnostic rows", () => {
    const bars: VolumePatternBar[] = [];
    for (let i = 0; i < 20; i++) bars.push(bar(1000 + i * 100));
    const r = classifyVolumePatternEdge(bars);
    const text = formatVolumePatternEdge(r);
    expect(text).toContain("Volume-Pattern Edge");
    expect(text).toContain("Pattern");
    expect(text).toContain("Slope");
  });
});
