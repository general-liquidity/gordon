import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  PerformanceMonitor,
  RingBuffer,
  atomicAppendJsonl,
  computeHistogram,
  getPerformanceMonitor,
  resetPerformanceMonitor,
  type FrameEvent,
} from "./performanceMonitor.ts";

describe("RingBuffer", () => {
  test("wraps correctly once full, preserving order", () => {
    const rb = new RingBuffer<number>(3);
    rb.push(1);
    rb.push(2);
    rb.push(3);
    expect(rb.toArray()).toEqual([1, 2, 3]);
    expect(rb.length()).toBe(3);

    // Fourth push should overwrite the oldest (1).
    rb.push(4);
    expect(rb.toArray()).toEqual([2, 3, 4]);
    expect(rb.length()).toBe(3);

    // Totals keep climbing even as the buffer wraps.
    rb.push(5);
    rb.push(6);
    expect(rb.toArray()).toEqual([4, 5, 6]);
    expect(rb.totalCount()).toBe(6);
    expect(rb.getCapacity()).toBe(3);
  });

  test("rejects non-positive capacity", () => {
    expect(() => new RingBuffer<number>(0)).toThrow();
    expect(() => new RingBuffer<number>(-1)).toThrow();
  });

  test("clear drops contents but keeps capacity", () => {
    const rb = new RingBuffer<number>(2);
    rb.push(1);
    rb.push(2);
    rb.clear();
    expect(rb.length()).toBe(0);
    expect(rb.toArray()).toEqual([]);
    rb.push(7);
    expect(rb.toArray()).toEqual([7]);
    expect(rb.getCapacity()).toBe(2);
  });
});

describe("computeHistogram", () => {
  test("returns zeros for empty / single-sample input", () => {
    const empty = computeHistogram([]);
    expect(empty.samples).toBe(0);
    expect(empty.p50Ms).toBe(0);
    expect(empty.p95Ms).toBe(0);
    expect(empty.p99Ms).toBe(0);

    const single: FrameEvent = { kind: "frame", ts: 10, bytes: 100, writeMs: 1 };
    const one = computeHistogram([single]);
    expect(one.samples).toBe(1);
    expect(one.meanBytes).toBe(100);
    expect(one.p50Ms).toBe(0); // no delta with one sample
  });

  test("computes percentiles over known input", () => {
    // Synthesize 101 frames so we get 100 deltas. The first 95 deltas are 10ms,
    // the last 5 are 100ms. With the "floor((n-1)*p)" percentile pick:
    //   p50 → sorted[floor(99*0.5)] = sorted[49] = 10
    //   p95 → sorted[floor(99*0.95)] = sorted[94] = 10
    //   p99 → sorted[floor(99*0.99)] = sorted[98] = 100
    // This exercises the rank-based percentile path with >1 large sample.
    const frames: FrameEvent[] = [];
    let t = 0;
    for (let i = 0; i < 96; i++) {
      t += 10;
      frames.push({ kind: "frame", ts: t, bytes: 50, writeMs: 0.1 });
    }
    for (let i = 0; i < 5; i++) {
      t += 100;
      frames.push({ kind: "frame", ts: t, bytes: 50, writeMs: 0.1 });
    }

    const h = computeHistogram(frames);
    expect(h.samples).toBe(101);
    expect(h.p50Ms).toBe(10);
    // p99 should fall inside the "slow" outlier region.
    expect(h.p99Ms).toBe(100);
    expect(h.meanBytes).toBe(50);
    // Mean of 100 deltas: (95*10 + 5*100) / 100 = 14.5
    expect(h.meanMs).toBeCloseTo(14.5, 5);
  });

  test("ignores negative deltas (clock skew safety)", () => {
    const frames: FrameEvent[] = [
      { kind: "frame", ts: 100, bytes: 1, writeMs: 0 },
      { kind: "frame", ts: 90, bytes: 1, writeMs: 0 }, // negative delta
      { kind: "frame", ts: 120, bytes: 1, writeMs: 0 },
    ];
    const h = computeHistogram(frames);
    // Only one valid delta (30), so p50=p95=p99=30.
    expect(h.p50Ms).toBe(30);
  });
});

describe("PerformanceMonitor — lifecycle + events", () => {
  afterEach(() => {
    resetPerformanceMonitor();
  });

  test("records frame / render / memory events into the snapshot", () => {
    const mon = new PerformanceMonitor({ frameWindow: 8, maxEvents: 64 });

    mon.recordFrame(100, 0.5, 10);
    mon.recordFrame(150, 0.6, 30);
    mon.recordFrame(200, 0.7, 55);
    mon.recordRender(3, "ADD_MESSAGE");
    mon.recordRender(4, "ADD_MESSAGE");
    mon.recordRender(5, "OTHER");

    const snap = mon.snapshot();
    expect(snap.totalFrames).toBe(3);
    expect(snap.totalRenders).toBe(3);
    expect(snap.rendersByLabel["ADD_MESSAGE"]).toBe(2);
    expect(snap.rendersByLabel["OTHER"]).toBe(1);
    expect(snap.frameHistogram.samples).toBe(3);
    expect(snap.frameHistogram.meanBytes).toBeCloseTo(150, 5);
  });

  test("memory sampler respects start/stop", async () => {
    const mon = new PerformanceMonitor({
      memoryIntervalMs: 20,
      flushIntervalMs: 999_999, // effectively disabled
      memoryBufferSize: 8,
    });
    expect(mon.isRunning()).toBe(false);

    mon.start();
    expect(mon.isRunning()).toBe(true);
    // First sample is taken immediately inside start().
    let snap = mon.snapshot();
    expect(snap.memorySamples.length).toBeGreaterThanOrEqual(1);

    await new Promise((r) => setTimeout(r, 80));
    snap = mon.snapshot();
    expect(snap.memorySamples.length).toBeGreaterThan(1);
    const before = snap.memorySamples.length;

    mon.stop();
    expect(mon.isRunning()).toBe(false);

    // After stop, no new samples should accumulate.
    await new Promise((r) => setTimeout(r, 80));
    snap = mon.snapshot();
    expect(snap.memorySamples.length).toBe(before);
  });

  test("reset clears buffers and counters", () => {
    const mon = new PerformanceMonitor({ frameWindow: 4 });
    mon.recordFrame(10, 0.1, 1);
    mon.recordRender(1, "x");
    mon.reset();
    const snap = mon.snapshot();
    expect(snap.totalFrames).toBe(0);
    expect(snap.totalRenders).toBe(0);
    expect(snap.frameHistogram.samples).toBe(0);
    expect(snap.latestMemory).toBeNull();
  });

  test("singleton returns the same instance", () => {
    const a = getPerformanceMonitor();
    const b = getPerformanceMonitor();
    expect(a).toBe(b);
    resetPerformanceMonitor();
    const c = getPerformanceMonitor();
    expect(c).not.toBe(a);
  });
});

describe("atomicAppendJsonl", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "gordon-perf-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("writes an initial JSONL line", () => {
    const p = join(dir, "out.jsonl");
    atomicAppendJsonl(p, { hello: "world" });
    expect(existsSync(p)).toBe(true);
    expect(readFileSync(p, "utf8")).toBe('{"hello":"world"}\n');
  });

  test("appends preserving prior contents", () => {
    const p = join(dir, "out.jsonl");
    atomicAppendJsonl(p, { n: 1 });
    atomicAppendJsonl(p, { n: 2 });
    atomicAppendJsonl(p, { n: 3 });
    const lines = readFileSync(p, "utf8").trim().split("\n");
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[0]!)).toEqual({ n: 1 });
    expect(JSON.parse(lines[1]!)).toEqual({ n: 2 });
    expect(JSON.parse(lines[2]!)).toEqual({ n: 3 });
  });

  test("leaves the existing file intact if no tmp was created yet", () => {
    const p = join(dir, "out.jsonl");
    writeFileSync(p, '{"prior":true}\n');
    atomicAppendJsonl(p, { n: 1 });
    const contents = readFileSync(p, "utf8");
    expect(contents).toContain('{"prior":true}');
    expect(contents).toContain('{"n":1}');
    // The tmp file should be gone after a successful rename.
    expect(existsSync(`${p}.tmp`)).toBe(false);
  });
});

describe("PerformanceMonitor — JSONL flush end-to-end", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "gordon-perf-flush-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    resetPerformanceMonitor();
  });

  test("flushes a JSONL snapshot on stop()", () => {
    const p = join(dir, "nested", "perf.jsonl");
    const mon = new PerformanceMonitor({
      memoryIntervalMs: 999_999,
      flushIntervalMs: 999_999,
    });
    mon.start({ flushPath: p });
    mon.recordFrame(42, 0.1, 1);
    mon.recordRender(1, "ADD_MESSAGE");
    mon.stop();

    expect(existsSync(p)).toBe(true);
    const line = readFileSync(p, "utf8").trim();
    const obj = JSON.parse(line);
    expect(obj.totalFrames).toBe(1);
    expect(obj.totalRenders).toBe(1);
    expect(obj.rendersByLabel.ADD_MESSAGE).toBe(1);
  });
});
