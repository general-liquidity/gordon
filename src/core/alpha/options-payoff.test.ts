import { describe, it, expect } from "bun:test";
import {
  computeOptionsPayoff,
  longStraddle,
  shortStraddle,
  longStrangle,
  shortStrangle,
  type OptionLeg,
} from "./options-payoff.ts";

function payoffAt(result: ReturnType<typeof computeOptionsPayoff>, price: number): number {
  const pt = result.payoffCurve.find((p) => Math.abs(p.price - price) < 1e-6);
  if (!pt) throw new Error(`grid has no point at ${price}`);
  return pt.payoff;
}

// ----------------------------------------------------------------------------
// Long straddle — hand-computed anchor
// K=100, call premium 3, put premium 2 => net debit 5
//   payoff(S) = max(S-100,0) + max(100-S,0) - 5
//   S=100 -> -5 (max loss)
//   breakevens at 95 and 105
//   S=120 -> 20 - 5 = 15
// ----------------------------------------------------------------------------
describe("computeOptionsPayoff — long straddle", () => {
  const legs = longStraddle(100, 3, 2);
  const r = computeOptionsPayoff({ legs, spot: 100 });

  it("net debit of 5", () => {
    expect(r.valid).toBe(true);
    expect(r.netPremium).toBe(-5);
    expect(r.netKind).toBe("debit");
  });

  it("max loss -5 at S=100", () => {
    expect(payoffAt(r, 100)).toBeCloseTo(-5, 6);
    expect(r.maxLoss).toBeCloseTo(-5, 6);
  });

  it("breakevens at 95 and 105", () => {
    expect(r.breakevens).toContain(95);
    expect(r.breakevens).toContain(105);
    expect(r.breakevens.length).toBe(2);
  });

  it("profit at S=120 is 15", () => {
    expect(payoffAt(r, 120)).toBeCloseTo(15, 6);
  });

  it("max profit unbounded (net-long calls)", () => {
    expect(r.maxProfit).toBeNull();
  });
});

// ----------------------------------------------------------------------------
// Short strangle — credit + two breakevens
// short call K=110 @ 2, short put K=90 @ 2 => net credit 4
//   payoff(S) = 4 - max(S-110,0) - max(90-S,0)
//   max profit +4 between 90 and 110
//   breakevens at 86 (90-4) and 114 (110+4)
//   downside unbounded? No — short put bounded; but short call -> net-short calls
//   so unbounded BELOW per call-exposure rule (net call exposure = -1)
// ----------------------------------------------------------------------------
describe("computeOptionsPayoff — short strangle", () => {
  const legs = shortStrangle(110, 90, 2, 2);
  const r = computeOptionsPayoff({ legs });

  it("net credit of 4", () => {
    expect(r.netPremium).toBe(4);
    expect(r.netKind).toBe("credit");
  });

  it("max profit +4 in the middle", () => {
    expect(payoffAt(r, 100)).toBeCloseTo(4, 6);
    expect(r.maxProfit).toBeCloseTo(4, 6);
  });

  it("breakevens at 86 and 114", () => {
    expect(r.breakevens).toContain(86);
    expect(r.breakevens).toContain(114);
  });

  it("net-short call -> unbounded loss below", () => {
    expect(r.maxLoss).toBeNull();
  });
});

// ----------------------------------------------------------------------------
// Bull call spread — bounded both sides, hand-computed
// long call K=100 @ 5, short call K=110 @ 2 => net debit 3
//   max loss = -3 (below 100)
//   max profit = (110-100) - 3 = 7 (above 110)
//   breakeven at 103
// ----------------------------------------------------------------------------
describe("computeOptionsPayoff — bull call spread", () => {
  const legs: OptionLeg[] = [
    { type: "call", side: "long", strike: 100, premium: 5 },
    { type: "call", side: "short", strike: 110, premium: 2 },
  ];
  const r = computeOptionsPayoff({ legs });

  it("net debit of 3", () => {
    expect(r.netPremium).toBe(-3);
    expect(r.netKind).toBe("debit");
  });

  it("max loss -3", () => {
    expect(r.maxLoss).toBeCloseTo(-3, 6);
    expect(payoffAt(r, 90)).toBeCloseTo(-3, 6);
  });

  it("max profit +7 (bounded — net call exposure zero)", () => {
    expect(r.maxProfit).toBeCloseTo(7, 6);
    expect(payoffAt(r, 120)).toBeCloseTo(7, 6);
  });

  it("breakeven at 103", () => {
    expect(r.breakevens).toContain(103);
    expect(r.breakevens.length).toBe(1);
  });
});

// ----------------------------------------------------------------------------
// Constructors + validity
// ----------------------------------------------------------------------------
describe("computeOptionsPayoff — constructors and validity", () => {
  it("short straddle is the negation of long straddle at every grid point", () => {
    const longR = computeOptionsPayoff({ legs: longStraddle(100, 3, 2) });
    const shortR = computeOptionsPayoff({ legs: shortStraddle(100, 3, 2) });
    expect(shortR.netPremium).toBe(5);
    expect(shortR.netKind).toBe("credit");
    for (const p of shortR.payoffCurve) {
      const lp = longR.payoffCurve.find((q) => q.price === p.price)!;
      expect(p.payoff).toBeCloseTo(-lp.payoff, 6);
    }
  });

  it("long strangle has unbounded profit and bounded loss", () => {
    const r = computeOptionsPayoff({ legs: longStrangle(110, 90, 1.5, 1.5) });
    expect(r.netKind).toBe("debit");
    expect(r.maxProfit).toBeNull();
    expect(r.maxLoss).not.toBeNull();
  });

  it("empty legs -> invalid, null fields", () => {
    const r = computeOptionsPayoff({ legs: [] });
    expect(r.valid).toBe(false);
    expect(r.netPremium).toBeNull();
    expect(r.maxLoss).toBeNull();
  });

  it("malformed leg (negative strike) -> invalid", () => {
    const r = computeOptionsPayoff({
      legs: [{ type: "call", side: "long", strike: -5, premium: 1 }],
    });
    expect(r.valid).toBe(false);
  });

  it("respects an explicit price grid", () => {
    const r = computeOptionsPayoff({
      legs: longStraddle(100, 3, 2),
      priceGrid: [100],
    });
    expect(r.payoffCurve.length).toBe(1);
    expect(r.payoffCurve[0]!.payoff).toBeCloseTo(-5, 6);
  });
});
