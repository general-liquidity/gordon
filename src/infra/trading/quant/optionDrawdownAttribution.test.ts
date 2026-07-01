import { describe, expect, it } from "bun:test";
import { attributeOptionDrawdown } from "./optionDrawdownAttribution.ts";

describe("attributeOptionDrawdown", () => {
  it("does not trigger below the drawdown threshold", () => {
    const r = attributeOptionDrawdown({
      optionType: "call",
      entryPremium: 10,
      currentPremium: 7, // 30% down
      entryUnderlying: 100,
      currentUnderlying: 98,
      entryIv: 0.6,
      currentIv: 0.55,
      entryDte: 30,
      currentDte: 25,
    });
    expect(r.triggered).toBe(false);
    expect(r.cause).toBe("none");
    expect(r.verdict).toBe("HoldAndResearch");
  });

  it("iv_driven -> StrongBuyNewContract (Greek decomposition, IV crush dominates)", () => {
    const r = attributeOptionDrawdown({
      optionType: "call",
      entryPremium: 10,
      currentPremium: 2, // 80% down
      entryUnderlying: 100,
      currentUnderlying: 100, // no move -> no delta damage
      entryIv: 0.8,
      currentIv: 0.3, // big crush
      entryDte: 30,
      currentDte: 29, // barely any theta
      delta: 0.5,
      theta: -0.05,
      vega: 15, // 15 * (-0.5) = -7.5 adverse
    });
    expect(r.triggered).toBe(true);
    expect(r.cause).toBe("iv_driven");
    expect(r.verdict).toBe("StrongBuyNewContract");
    expect(r.method).toBe("greeks");
    expect(r.shares.iv).toBeGreaterThan(0.6);
  });

  it("theta_driven -> NoRebuyTheta (heuristic, only time elapsed)", () => {
    const r = attributeOptionDrawdown({
      optionType: "call",
      entryPremium: 10,
      currentPremium: 1, // 90% down
      entryUnderlying: 100,
      currentUnderlying: 100, // no adverse move
      entryIv: 0.6,
      currentIv: 0.62, // IV up slightly -> not adverse
      entryDte: 30,
      currentDte: 1, // ~all tenor consumed
    });
    expect(r.triggered).toBe(true);
    expect(r.cause).toBe("theta_driven");
    expect(r.verdict).toBe("NoRebuyTheta");
    expect(r.method).toBe("heuristic");
  });

  it("delta_driven -> HoldAndResearch (call, underlying fell hard)", () => {
    const r = attributeOptionDrawdown({
      optionType: "call",
      entryPremium: 10,
      currentPremium: 1.5, // 85% down
      entryUnderlying: 100,
      currentUnderlying: 70, // -30% move against a call
      entryIv: 0.6,
      currentIv: 0.6, // flat IV
      entryDte: 30,
      currentDte: 29, // negligible theta
    });
    expect(r.triggered).toBe(true);
    expect(r.cause).toBe("delta_driven");
    expect(r.verdict).toBe("HoldAndResearch");
  });

  it("put delta damage registers on an up-move", () => {
    const r = attributeOptionDrawdown({
      optionType: "put",
      entryPremium: 10,
      currentPremium: 1.5,
      entryUnderlying: 100,
      currentUnderlying: 130, // up-move hurts a put
      entryIv: 0.6,
      currentIv: 0.6,
      entryDte: 30,
      currentDte: 29,
    });
    expect(r.cause).toBe("delta_driven");
    expect(r.shares.delta).toBeGreaterThan(0.6);
  });

  it("mixed cause -> HoldAndResearch when no driver dominates", () => {
    const r = attributeOptionDrawdown({
      optionType: "call",
      entryPremium: 10,
      currentPremium: 2, // 80% down
      entryUnderlying: 100,
      currentUnderlying: 90, // -10% move
      entryIv: 0.6,
      currentIv: 0.42, // -30% IV
      entryDte: 30,
      currentDte: 15, // half tenor gone
    });
    expect(r.triggered).toBe(true);
    expect(r.cause).toBe("mixed");
    expect(r.verdict).toBe("HoldAndResearch");
    const sum = r.shares.delta + r.shares.theta + r.shares.iv;
    expect(sum).toBeCloseTo(1, 2);
  });

  it("respects a configurable threshold", () => {
    const base = {
      optionType: "call" as const,
      entryPremium: 10,
      currentPremium: 4.5, // 55% down
      entryUnderlying: 100,
      currentUnderlying: 100,
      entryIv: 0.6,
      currentIv: 0.3,
      entryDte: 30,
      currentDte: 29,
    };
    expect(attributeOptionDrawdown(base).triggered).toBe(false);
    expect(attributeOptionDrawdown({ ...base, drawdownThreshold: 0.5 }).triggered).toBe(true);
  });

  it("guards invalid input", () => {
    expect(
      attributeOptionDrawdown({
        optionType: "call",
        entryPremium: 0,
        currentPremium: 0,
        entryUnderlying: 100,
        currentUnderlying: 100,
        entryIv: 0.5,
        currentIv: 0.5,
        entryDte: 30,
        currentDte: 20,
      }).triggered,
    ).toBe(false);
  });
});
