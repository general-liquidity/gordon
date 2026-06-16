import { describe, it, expect } from "bun:test";
import {
  createRingFence,
  maxSleeveLoss,
  canDeploySleeve,
  applyCorePnL,
  applySleevePnL,
  breachesRedLine,
  formatRingFence,
  type RingFenceState,
} from "./ringFence.ts";

// $1M total, 10% sleeve, red-line at $200k — the worked example.
const base = () =>
  createRingFence({ totalEquity: 1_000_000, sleeveFraction: 0.1, redLineEquity: 200_000 });

describe("createRingFence — carving + validation", () => {
  it("carves the reserve off the core correctly", () => {
    const s = base();
    expect(s.sleeveReserve).toBe(100_000);
    expect(s.coreEquity).toBe(900_000);
    expect(s.totalEquity).toBe(1_000_000);
    expect(s.sleeveDeployed).toBe(0);
    expect(s.sleevePnL).toBe(0);
    expect(s.redLineEquity).toBe(200_000);
  });

  it("rejects sleeveFraction that would leave the core at/below the red-line", () => {
    // 90% sleeve leaves core=100k, below the 200k red-line.
    expect(() =>
      createRingFence({ totalEquity: 1_000_000, sleeveFraction: 0.9, redLineEquity: 200_000 }),
    ).toThrow(/red-line/);
  });

  it("rejects out-of-range sleeveFraction", () => {
    expect(() => createRingFence({ totalEquity: 1e6, sleeveFraction: 1, redLineEquity: 0 })).toThrow();
    expect(() => createRingFence({ totalEquity: 1e6, sleeveFraction: -0.1, redLineEquity: 0 })).toThrow();
  });

  it("rejects non-positive total equity", () => {
    expect(() => createRingFence({ totalEquity: 0, sleeveFraction: 0.1, redLineEquity: 0 })).toThrow();
  });
});

describe("maxSleeveLoss", () => {
  it("is the reserve when reserve < headroom-to-red-line", () => {
    const s = base();
    // headroom = 1,000,000 − 200,000 = 800,000; reserve = 100,000 → min = 100,000.
    expect(maxSleeveLoss(s)).toBe(100_000);
  });

  it("is the headroom when headroom < reserve (after core drawdown)", () => {
    // At construction core>redLine forces reserve<headroom; a core drawdown can flip it.
    // reserve=400k; drop core 850k→ headroom shrinks below the reserve, becoming the cap.
    const s0 = createRingFence({ totalEquity: 1_000_000, sleeveFraction: 0.4, redLineEquity: 500_000 });
    expect(s0.sleeveReserve).toBe(400_000);
    const s = applyCorePnL(s0, -400_000); // core 600k→200k, total 600k, headroom 100k
    expect(s.totalEquity).toBe(600_000);
    expect(maxSleeveLoss(s)).toBe(100_000); // min(reserve 400k, headroom 100k)
  });

  it("never goes negative", () => {
    const s = base();
    const broke = applySleevePnL(applyCorePnL(s, -850_000), -100_000);
    expect(maxSleeveLoss(broke)).toBe(0);
  });
});

describe("the whole point — full reserve loss leaves the core intact and total ≥ red-line", () => {
  it("losing the entire sleeve reserve does not touch the core", () => {
    const s = base();
    const blown = applySleevePnL(s, -100_000); // lose the whole reserve
    expect(blown.coreEquity).toBe(900_000); // core untouched
    expect(blown.sleevePnL).toBe(-100_000);
    expect(blown.totalEquity).toBe(900_000); // core + reserve(100k) + pnl(−100k)
    expect(blown.totalEquity).toBeGreaterThanOrEqual(blown.redLineEquity);
    expect(breachesRedLine(blown)).toBe(false);
  });

  it("sleeve cannot bleed past the reserve into the core", () => {
    const s = base();
    // Try to lose far more than the reserve — floored at −reserve.
    const over = applySleevePnL(s, -500_000);
    expect(over.sleevePnL).toBe(-100_000);
    expect(over.coreEquity).toBe(900_000);
    expect(over.totalEquity).toBe(900_000);
  });
});

describe("canDeploySleeve — sizing gate", () => {
  it("blocks an oversized leveraged bet", () => {
    const s = base();
    // notional 2,000,000 at 10x → margin 200,000 > maxSleeveLoss 100,000 → blocked.
    const d = canDeploySleeve(s, 2_000_000, 10);
    expect(d.allowed).toBe(false);
    expect(d.worstCaseLoss).toBe(200_000);
    expect(d.budget).toBe(100_000);
  });

  it("allows a bet whose worst case fits the budget", () => {
    const s = base();
    // notional 500,000 at 10x → margin 50,000 ≤ 100,000 → allowed.
    const d = canDeploySleeve(s, 500_000, 10);
    expect(d.allowed).toBe(true);
    expect(d.worstCaseLoss).toBe(50_000);
  });

  it("allows a bet exactly at the budget boundary", () => {
    const s = base();
    const d = canDeploySleeve(s, 1_000_000, 10); // margin 100,000 == budget
    expect(d.allowed).toBe(true);
  });

  it("rejects invalid leverage", () => {
    const s = base();
    expect(canDeploySleeve(s, 100_000, 0.5).allowed).toBe(false);
  });
});

describe("independent accounting of core and sleeve P&L", () => {
  it("core P&L moves core + total but not the sleeve", () => {
    const s = base();
    const t = applyCorePnL(s, 50_000);
    expect(t.coreEquity).toBe(950_000);
    expect(t.sleeveReserve).toBe(100_000);
    expect(t.sleevePnL).toBe(0);
    expect(t.totalEquity).toBe(1_050_000);
  });

  it("sleeve P&L moves sleeve + total but not the core", () => {
    const s = base();
    const t = applySleevePnL(s, 30_000);
    expect(t.coreEquity).toBe(900_000);
    expect(t.sleevePnL).toBe(30_000);
    expect(t.totalEquity).toBe(1_030_000);
  });

  it("interleaved core and sleeve P&L stay separately accounted", () => {
    let s: RingFenceState = base();
    s = applyCorePnL(s, 20_000); // core 920k
    s = applySleevePnL(s, -40_000); // sleeve pnl −40k
    s = applyCorePnL(s, -10_000); // core 910k
    expect(s.coreEquity).toBe(910_000);
    expect(s.sleevePnL).toBe(-40_000);
    expect(s.totalEquity).toBe(910_000 + 100_000 - 40_000); // 970k
  });
});

describe("catastrophic sleeve loss within budget never red-lines", () => {
  it("a sleeve sized within maxSleeveLoss cannot breach the red-line even on total loss", () => {
    const s = base();
    const budget = maxSleeveLoss(s); // 100,000
    const d = canDeploySleeve(s, budget * 10, 10); // margin == budget → allowed
    expect(d.allowed).toBe(true);
    // Now the bet loses everything it risked.
    const after = applySleevePnL(s, -d.worstCaseLoss);
    expect(breachesRedLine(after)).toBe(false);
    expect(after.totalEquity).toBeGreaterThanOrEqual(after.redLineEquity);
    expect(after.coreEquity).toBe(900_000);
  });

  it("holds when the headroom (not the reserve) is the binding budget", () => {
    // Construct, then draw the core down so headroom < reserve and headroom is the cap.
    const s0 = createRingFence({ totalEquity: 1_000_000, sleeveFraction: 0.4, redLineEquity: 500_000 });
    const s = applyCorePnL(s0, -400_000); // total 600k, headroom 100k < reserve 400k
    const budget = maxSleeveLoss(s);
    expect(budget).toBe(100_000);
    const d = canDeploySleeve(s, budget, 1);
    expect(d.allowed).toBe(true);
    const after = applySleevePnL(s, -budget);
    expect(breachesRedLine(after)).toBe(false);
    expect(after.totalEquity).toBe(500_000);
  });
});

describe("formatRingFence", () => {
  it("renders without throwing and reports breach state", () => {
    const out = formatRingFence(base());
    expect(out).toContain("RingFence");
    expect(out).toContain("maxSleeveLoss");
    expect(out).toContain("breached=false");
  });
});
