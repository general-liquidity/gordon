import { describe, expect, it } from "bun:test";
import { computeTripleBarrier } from "./triple-barrier.ts";

describe("computeTripleBarrier", () => {
  it("labels +1 when PT is hit first (long)", () => {
    // entry at idx 0 (price 100). pt=5% -> 105, sl=5% -> 95.
    const prices = [100, 101, 106, 90, 100];
    const r = computeTripleBarrier({
      prices,
      entries: [0],
      ptPct: 0.05,
      slPct: 0.05,
      verticalBars: 4,
    });
    expect(r.sampleSize).toBe(1);
    const l = r.labels[0]!;
    expect(l.label).toBe(1);
    expect(l.touchReason).toBe("pt");
    expect(l.touchIndex).toBe(2);
    expect(l.returnAtTouch).toBe(0.06);
    expect(r.ptCount).toBe(1);
  });

  it("labels -1 when SL is hit first (long)", () => {
    const prices = [100, 99, 94, 110, 100];
    const r = computeTripleBarrier({
      prices,
      entries: [0],
      ptPct: 0.05,
      slPct: 0.05,
      verticalBars: 4,
    });
    const l = r.labels[0]!;
    expect(l.label).toBe(-1);
    expect(l.touchReason).toBe("sl");
    expect(l.touchIndex).toBe(2);
    expect(l.returnAtTouch).toBe(-0.06);
    expect(r.slCount).toBe(1);
  });

  it("labels 0/vertical when neither barrier is hit", () => {
    const prices = [100, 100.5, 99.5, 100.2, 99.8, 100.1];
    const r = computeTripleBarrier({
      prices,
      entries: [0],
      ptPct: 0.05,
      slPct: 0.05,
      verticalBars: 3,
    });
    const l = r.labels[0]!;
    expect(l.label).toBe(0);
    expect(l.touchReason).toBe("vertical");
    expect(l.touchIndex).toBe(3);
    expect(r.verticalCount).toBe(1);
  });

  it("short side: falling path hits PT (downside) -> +1", () => {
    // short entry at 100. pt(downside)=5% -> 95, sl(upside)=5% -> 105.
    const prices = [100, 99, 94, 80, 100];
    const r = computeTripleBarrier({
      prices,
      entries: [0],
      ptPct: 0.05,
      slPct: 0.05,
      verticalBars: 4,
      side: "short",
    });
    const l = r.labels[0]!;
    expect(l.label).toBe(1);
    expect(l.touchReason).toBe("pt");
    expect(l.touchIndex).toBe(2);
    // short return = -(94/100 - 1) = +0.06
    expect(l.returnAtTouch).toBe(0.06);
  });

  it("aggregates counts correctly across multiple entries", () => {
    // idx0 entry -> PT at idx1; idx3 entry -> SL at idx4; idx6 entry -> vertical.
    const prices = [100, 106, 100, 100, 94, 100, 100, 100.5, 99.5, 100.2];
    const r = computeTripleBarrier({
      prices,
      entries: [0, 3, 6],
      ptPct: 0.05,
      slPct: 0.05,
      verticalBars: 2,
    });
    expect(r.sampleSize).toBe(3);
    expect(r.ptCount).toBe(1);
    expect(r.slCount).toBe(1);
    expect(r.verticalCount).toBe(1);
    expect(r.labels.map((x) => x.label).sort()).toEqual([-1, 0, 1]);
  });

  it("returns neutral on empty/invalid input", () => {
    const empty = computeTripleBarrier({
      prices: [],
      entries: [0],
      ptPct: 0.05,
      slPct: 0.05,
      verticalBars: 4,
    });
    expect(empty.sampleSize).toBe(0);
    expect(empty.labels).toEqual([]);

    const noEntries = computeTripleBarrier({
      prices: [100, 101, 102],
      entries: [],
      ptPct: 0.05,
      slPct: 0.05,
      verticalBars: 4,
    });
    expect(noEntries.sampleSize).toBe(0);

    const oob = computeTripleBarrier({
      prices: [100, 101],
      entries: [5, 1],
      ptPct: 0.05,
      slPct: 0.05,
      verticalBars: 4,
    });
    expect(oob.sampleSize).toBe(0);
  });
});
