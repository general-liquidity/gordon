import { describe, expect, it } from "bun:test";
import {
  adverseSelectionBps,
  makerLimitPrice,
  unhedgeCompletion,
  type MakerLeg,
} from "./makerExecution.ts";

describe("makerLimitPrice", () => {
  const quote = { bid: 100, ask: 101 };

  it("rests a buy at the bid (passive)", () => {
    expect(makerLimitPrice("buy", quote)).toBe(100);
  });

  it("rests a sell at the ask (passive)", () => {
    expect(makerLimitPrice("sell", quote)).toBe(101);
  });

  it("improves a buy toward mid with insideBps but stays passive-side", () => {
    const mid = 100.5;
    const price = makerLimitPrice("buy", quote, { insideBps: 10 });
    expect(price).toBeGreaterThan(100); // improved up from the bid
    expect(price).toBeLessThanOrEqual(mid); // never crosses past mid
    expect(price).toBeCloseTo(100 * (1 + 10 / 1e4), 9);
  });

  it("improves a sell toward mid with insideBps but stays passive-side", () => {
    const mid = 100.5;
    const price = makerLimitPrice("sell", quote, { insideBps: 10 });
    expect(price).toBeLessThan(101); // improved down from the ask
    expect(price).toBeGreaterThanOrEqual(mid); // never crosses past mid
    expect(price).toBeCloseTo(101 * (1 - 10 / 1e4), 9);
  });

  it("caps an over-aggressive buy improvement at mid", () => {
    // Huge insideBps would push past mid; must clamp to mid.
    expect(makerLimitPrice("buy", quote, { insideBps: 10_000 })).toBe(100.5);
  });

  it("caps an over-aggressive sell improvement at mid", () => {
    expect(makerLimitPrice("sell", quote, { insideBps: 10_000 })).toBe(100.5);
  });

  it("falls back to mid on a crossed book", () => {
    expect(makerLimitPrice("buy", { bid: 102, ask: 101 })).toBe(101.5);
  });

  it("returns 0 on a non-positive book", () => {
    expect(makerLimitPrice("buy", { bid: 0, ask: 101 })).toBe(0);
    expect(makerLimitPrice("sell", { bid: 100, ask: 0 })).toBe(0);
  });
});

describe("adverseSelectionBps", () => {
  it("is positive when a maker buy fills below mid (favorable)", () => {
    // refMid 100, filled at 99.9 → +10 bps.
    expect(adverseSelectionBps("buy", 99.9, 100)).toBeCloseTo(10, 9);
  });

  it("is negative when a maker buy fills above mid (adverse selection)", () => {
    expect(adverseSelectionBps("buy", 100.1, 100)).toBeCloseTo(-10, 9);
  });

  it("is positive when a maker sell fills above mid (favorable)", () => {
    expect(adverseSelectionBps("sell", 100.1, 100)).toBeCloseTo(10, 9);
  });

  it("is negative when a maker sell fills below mid (adverse selection)", () => {
    expect(adverseSelectionBps("sell", 99.9, 100)).toBeCloseTo(-10, 9);
  });

  it("returns 0 on a non-positive reference mid", () => {
    expect(adverseSelectionBps("buy", 99.9, 0)).toBe(0);
  });
});

describe("unhedgeCompletion", () => {
  it("returns [] when grossTarget is 0", () => {
    const legs: MakerLeg[] = [
      { symbol: "A", targetNotional: 0, filledNotional: 0 },
    ];
    expect(unhedgeCompletion(legs)).toEqual([]);
  });

  it("returns [] when both legs are fully filled (book neutral)", () => {
    const legs: MakerLeg[] = [
      { symbol: "A", targetNotional: 1000, filledNotional: 1000 },
      { symbol: "B", targetNotional: -1000, filledNotional: -1000 },
    ];
    expect(unhedgeCompletion(legs)).toEqual([]);
  });

  it("returns [] for symmetric partial fills (net drift within band)", () => {
    // Both legs half-filled → netFilled = 0, well within band.
    const legs: MakerLeg[] = [
      { symbol: "A", targetNotional: 1000, filledNotional: 500 },
      { symbol: "B", targetNotional: -1000, filledNotional: -500 },
    ];
    expect(unhedgeCompletion(legs)).toEqual([]);
  });

  it("returns [] when net drift is just under the band", () => {
    // gross 2000, net 300 → 0.15 exactly → still acceptable (<=).
    const legs: MakerLeg[] = [
      { symbol: "A", targetNotional: 1000, filledNotional: 800 },
      { symbol: "B", targetNotional: -1000, filledNotional: -500 },
    ];
    expect(unhedgeCompletion(legs)).toEqual([]);
  });

  it("completes laggard legs as taker when one leg fills and the other doesn't", () => {
    // Long leg fully filled, short leg unfilled → netFilled 1000, gross 2000,
    // drift 0.5 > 0.15 → complete both gaps.
    const legs: MakerLeg[] = [
      { symbol: "A", targetNotional: 1000, filledNotional: 1000 },
      { symbol: "B", targetNotional: -1000, filledNotional: 0 },
    ];
    const orders = unhedgeCompletion(legs);
    // Leg A has no gap; only the short laggard B needs completing.
    expect(orders).toEqual([
      { symbol: "B", side: "sell", notional: 1000 },
    ]);
  });

  it("emits a buy for a long laggard and a sell for a short laggard", () => {
    // Short leg overfilled vs target, long leg lagging → net drift breaches band.
    // gross 1600; net = (-300) + 0 = -300 → 0.1875 > 0.15 → complete both gaps.
    // A: target +600, filled 0 → gap +600 → buy. B: target −1000, filled −700 → gap −300 → sell.
    const legs: MakerLeg[] = [
      { symbol: "A", targetNotional: 600, filledNotional: 0 },
      { symbol: "B", targetNotional: -1000, filledNotional: -700 },
    ];
    const orders = unhedgeCompletion(legs);
    expect(orders).toEqual([
      { symbol: "A", side: "buy", notional: 600 },
      { symbol: "B", side: "sell", notional: 300 },
    ]);
  });

  it("respects a custom maxNetFraction band", () => {
    // gross 2000, net 200 → drift 0.10. Default band 0.15 → []; tighten to 0.05 → completes.
    const legs: MakerLeg[] = [
      { symbol: "A", targetNotional: 1000, filledNotional: 700 },
      { symbol: "B", targetNotional: -1000, filledNotional: -500 },
    ];
    expect(unhedgeCompletion(legs)).toEqual([]);
    const orders = unhedgeCompletion(legs, { maxNetFraction: 0.05 });
    expect(orders).toEqual([
      { symbol: "A", side: "buy", notional: 300 },
      { symbol: "B", side: "sell", notional: 500 },
    ]);
  });
});
