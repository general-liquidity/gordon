import { describe, it, expect } from "bun:test";
import { barbellDecision, BARBELL_CONFIG, type BarbellInput } from "./barbellStrategy.ts";
import { breachesRedLine, applySleevePnL } from "./ringFence.ts";
import type { Mt5Bar } from "../../broker/mt5/bridgeClient.ts";

/** Deterministic LCG so synthetic bars are reproducible (no Math.random). */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/** A noisy random-walk close path for one symbol. */
function walk(seed: number, n: number, start: number, vol: number): Mt5Bar[] {
  const r = lcg(seed);
  const bars: Mt5Bar[] = [];
  let p = start;
  for (let i = 0; i < n; i++) {
    p *= 1 + (r() - 0.5) * 2 * vol;
    const c = Math.max(p, 1e-6);
    bars.push({
      time: 1_700_000_000 + i * 900,
      open: c, high: c * 1.002, low: c * 0.998, close: c,
      tick_volume: 1, spread: 0, real_volume: 0,
    } as unknown as Mt5Bar);
  }
  return bars;
}

function universe(): Record<string, Mt5Bar[]> {
  return {
    BTCUSD: walk(1, 200, 60000, 0.01),
    ETHUSD: walk(2, 200, 3000, 0.012),
    SOLUSD: walk(3, 200, 150, 0.02),
    XRPUSD: walk(4, 200, 0.6, 0.015),
    BARUSD: walk(5, 200, 0.08, 0.018),
    XAUUSD: walk(6, 200, 2000, 0.004),
    XAGUSD: walk(7, 200, 25, 0.006),
  };
}

const base = (over: Partial<BarbellInput>): BarbellInput => ({
  barsBySymbol: universe(),
  equity: 1_000_000,
  startingEquity: 1_000_000,
  ourReturnPct: 0,
  barsToDeadline: 200,
  phase: "post_cut",
  ...over,
});

describe("barbellDecision — gating + survival", () => {
  it("always returns a core book + ring-fence (core is the strategy)", () => {
    const d = barbellDecision(base({}));
    expect(Array.isArray(d.core)).toBe(true);
    expect(d.ringFence.coreEquity).toBeGreaterThan(0);
    expect(d.ringFence.sleeveReserve).toBeCloseTo(BARBELL_CONFIG.sleeveFraction * 1_000_000, 0);
  });

  it("NEVER deploys the sleeve pre-cut in the early rounds (no barsToCut → finals-only)", () => {
    const d = barbellDecision(base({ phase: "pre_cut", ourReturnPct: -0.4 }));
    expect(d.sleeve).toBeNull();
  });

  it("DEPLOYS the sleeve pre-cut in the ENDGAME when below the Top-100 cut (climb into the finals)", () => {
    const d = barbellDecision(base({ phase: "pre_cut", ourReturnPct: -0.4, barsToCut: 24 }));
    expect(d.standing.clearsCut).toBe(false);
    expect(d.sleeve).not.toBeNull();
    expect(d.sleeve!.reason).toContain("Top-100 cut");
  });

  it("HOLDS the sleeve pre-cut when below the cut but NOT yet in the endgame (preserve the one-shot)", () => {
    const d = barbellDecision(base({ phase: "pre_cut", ourReturnPct: -0.4, barsToCut: 200 }));
    expect(d.sleeve).toBeNull();
  });

  it("HOLDS the sleeve in the endgame when ALREADY clearing the cut (save it for the finals)", () => {
    const d = barbellDecision(base({ phase: "pre_cut", ourReturnPct: 1.0, barsToCut: 24 }));
    expect(d.standing.clearsCut).toBe(true);
    expect(d.sleeve).toBeNull();
  });

  it("endgame sleeve loss can NEVER red-line the core (survival preserved on the new path)", () => {
    const d = barbellDecision(base({ phase: "pre_cut", ourReturnPct: -0.4, barsToCut: 24 }));
    expect(d.sleeve).not.toBeNull();
    expect(d.sleeve!.margin).toBeLessThanOrEqual(d.ringFence.sleeveReserve + 1e-6);
    expect(d.ringFence.totalEquity - d.sleeve!.margin).toBeGreaterThanOrEqual(d.ringFence.redLineEquity - 1e-6);
  });

  it("does NOT deploy the sleeve post-cut when LEADING (lock-in)", () => {
    const d = barbellDecision(base({ phase: "post_cut", ourReturnPct: 1.0 })); // +100% → top → lock_in
    expect(d.standing.stance).toBe("lock_in");
    expect(d.sleeve).toBeNull();
  });

  it("DEPLOYS the sleeve post-cut when LAGGING (max_variance)", () => {
    const d = barbellDecision(base({ phase: "post_cut", ourReturnPct: -0.3 })); // behind → swing
    expect(d.standing.stance).toBe("max_variance");
    expect(d.sleeve).not.toBeNull();
    expect(["buy", "sell"]).toContain(d.sleeve!.side);
    expect(d.sleeve!.leverage).toBeGreaterThanOrEqual(1);
    expect(d.sleeve!.leverage).toBeLessThanOrEqual(30); // venue cap
  });

  it("sizes the sleeve so its worst-case loss can NEVER red-line the core", () => {
    const d = barbellDecision(base({ phase: "post_cut", ourReturnPct: -0.3 }));
    expect(d.sleeve).not.toBeNull();
    // margin = worst-case loss ≤ the carved reserve
    expect(d.sleeve!.margin).toBeLessThanOrEqual(d.ringFence.sleeveReserve + 1e-6);
    // simulate losing the ENTIRE sleeve → core + total stay above the red-line
    const afterTotalLoss = applySleevePnL(d.ringFence, -d.ringFence.sleeveReserve);
    expect(breachesRedLine(afterTotalLoss)).toBe(false);
    expect(afterTotalLoss.coreEquity).toBeCloseTo(d.ringFence.coreEquity, 0);
  });

  it("shrinks safe leverage as the deadline horizon lengthens (more time to liquidate)", () => {
    const near = barbellDecision(base({ phase: "post_cut", ourReturnPct: -0.3, barsToDeadline: 20 }));
    const far = barbellDecision(base({ phase: "post_cut", ourReturnPct: -0.3, barsToDeadline: 400 }));
    expect(near.sleeve).not.toBeNull();
    expect(far.sleeve).not.toBeNull();
    // longer horizon → larger cumulative move → lower safe leverage
    expect(far.sleeve!.leverage).toBeLessThanOrEqual(near.sleeve!.leverage);
  });
});
