import { describe, it, expect } from "bun:test";
import { trackIc } from "./ic-tracker.ts";

function makeAligned(n: number, factor: number): { sig: number[]; ret: number[] } {
  const sig: number[] = [];
  const ret: number[] = [];
  for (let i = 0; i < n; i++) {
    const s = Math.sin(i / 3);
    sig.push(s);
    ret.push(s * factor + (Math.random() - 0.5) * 0.005);
  }
  return { sig, ret };
}

describe("trackIc — edge diagnostic surface", () => {
  it("omits edge when transactionCostBps not supplied", () => {
    const { sig, ret } = makeAligned(60, 0.02);
    const snap = trackIc("no-cost", sig, ret);
    expect(snap.edge).toBeUndefined();
  });

  it("omits edge when transactionCostBps is 0", () => {
    const { sig, ret } = makeAligned(60, 0.02);
    const snap = trackIc("zero-cost", sig, ret, { transactionCostBps: 0 });
    expect(snap.edge).toBeUndefined();
  });

  it("populates edge with all fields when transactionCostBps > 0", () => {
    const { sig, ret } = makeAligned(60, 0.02);
    const snap = trackIc("with-cost", sig, ret, { transactionCostBps: 5 });
    expect(snap.edge).toBeDefined();
    expect(snap.edge!.transactionCostBps).toBe(5);
    expect(snap.edge!.returnStd).toBeGreaterThan(0);
    expect(Number.isFinite(snap.edge!.impliedGrossEdgePerObs)).toBe(true);
    expect(Number.isFinite(snap.edge!.impliedGrossEdgeBps)).toBe(true);
    expect(Number.isFinite(snap.edge!.impliedNetEdgeBps)).toBe(true);
    expect(Number.isFinite(snap.edge!.breakevenCostBps)).toBe(true);
    expect(typeof snap.edge!.isPositiveAfterCosts).toBe("boolean");
  });

  it("Pearson IC is invariant to transactionCostBps (documents the mathematical invariance)", () => {
    const { sig, ret } = makeAligned(60, 0.02);
    const gross = trackIc("a", sig, ret);
    const withCost = trackIc("a", sig, ret, { transactionCostBps: 10 });
    expect(gross.ic).not.toBeNull();
    expect(withCost.ic).not.toBeNull();
    // Pearson is invariant to additive shifts in returns → IC unchanged
    expect(withCost.ic).toBeCloseTo(gross.ic!, 10);
  });

  it("netEdge = grossEdge - 2 × cost", () => {
    const { sig, ret } = makeAligned(60, 0.02);
    const snap = trackIc("delta", sig, ret, { transactionCostBps: 8 });
    expect(snap.edge).toBeDefined();
    const expectedNet = snap.edge!.impliedGrossEdgeBps - 2 * 8;
    expect(snap.edge!.impliedNetEdgeBps).toBeCloseTo(expectedNet, 6);
  });

  it("breakevenCostBps = |grossEdgeBps| / 2", () => {
    const { sig, ret } = makeAligned(60, 0.02);
    const snap = trackIc("breakeven", sig, ret, { transactionCostBps: 3 });
    expect(snap.edge!.breakevenCostBps).toBeCloseTo(
      Math.abs(snap.edge!.impliedGrossEdgeBps) / 2,
      6,
    );
  });

  it("isPositiveAfterCosts = false when round-trip cost exceeds gross edge", () => {
    // Construct a weak signal: 60 obs, factor 0.001 → tiny edge
    const sig: number[] = [];
    const ret: number[] = [];
    for (let i = 0; i < 60; i++) {
      const s = Math.sin(i / 3);
      sig.push(s);
      ret.push(s * 0.0001 + (Math.random() - 0.5) * 0.001);
    }
    const snap = trackIc("weak", sig, ret, { transactionCostBps: 100 });
    expect(snap.edge).toBeDefined();
    expect(snap.edge!.isPositiveAfterCosts).toBe(false);
  });

  it("isPositiveAfterCosts = true when gross edge dwarfs costs", () => {
    const { sig, ret } = makeAligned(60, 0.05); // strong signal
    const snap = trackIc("strong", sig, ret, { transactionCostBps: 1 });
    expect(snap.edge).toBeDefined();
    // With strong factor and tiny cost, net should survive
    expect(snap.edge!.isPositiveAfterCosts).toBe(true);
  });

  it("summary includes edge breakdown when present", () => {
    const { sig, ret } = makeAligned(60, 0.02);
    const snap = trackIc("summary-test", sig, ret, { transactionCostBps: 5 });
    expect(snap.summary).toContain("gross");
    expect(snap.summary).toContain("net");
    expect(snap.summary).toContain("breakeven");
  });

  it("summary excludes edge breakdown when transactionCostBps is 0", () => {
    const { sig, ret } = makeAligned(60, 0.02);
    const snap = trackIc("no-edge-summary", sig, ret);
    expect(snap.summary).not.toContain("breakeven");
  });
});
