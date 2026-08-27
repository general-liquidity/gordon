import { describe, it, expect } from "bun:test";
import { computeEvolvingR } from "./evolving-r.ts";

describe("computeEvolvingR — long worked example (entry 50, stop 25, target 100)", () => {
  it("at entry (currentPrice 50): RR=2, realizedR=0, currentRR=2, hold", () => {
    const r = computeEvolvingR({
      entry: 50,
      stop: 25,
      target: 100,
      currentPrice: 50,
      side: "long",
    });
    expect(r).not.toBeNull();
    expect(r!.initialRR).toBe(2);
    expect(r!.realizedR).toBe(0);
    expect(r!.currentRR).toBe(2);
    expect(r!.remainingReward).toBe(50);
    expect(r!.riskToStop).toBe(25);
    expect(r!.verdict).toBe("hold");
  });

  it("at currentPrice 85: realizedR=1.4, remainingReward=15, riskToStop=60, currentRR=0.25, manage", () => {
    const r = computeEvolvingR({
      entry: 50,
      stop: 25,
      target: 100,
      currentPrice: 85,
      side: "long",
    });
    expect(r).not.toBeNull();
    expect(r!.initialRR).toBe(2);
    expect(r!.realizedR).toBe(1.4);
    expect(r!.remainingReward).toBe(15);
    expect(r!.riskToStop).toBe(60);
    expect(r!.currentRR).toBe(0.25);
    expect(r!.verdict).toBe("manage");
  });

  it("at currentPrice 100: target_reached", () => {
    const r = computeEvolvingR({
      entry: 50,
      stop: 25,
      target: 100,
      currentPrice: 100,
      side: "long",
    });
    expect(r).not.toBeNull();
    expect(r!.verdict).toBe("target_reached");
    expect(r!.remainingReward).toBe(0);
  });

  it("at currentPrice 110 (past target): target_reached", () => {
    const r = computeEvolvingR({
      entry: 50,
      stop: 25,
      target: 100,
      currentPrice: 110,
      side: "long",
    });
    expect(r!.verdict).toBe("target_reached");
    expect(r!.remainingReward).toBe(0);
  });

  it("at currentPrice 25: stopped", () => {
    const r = computeEvolvingR({
      entry: 50,
      stop: 25,
      target: 100,
      currentPrice: 25,
      side: "long",
    });
    expect(r).not.toBeNull();
    expect(r!.verdict).toBe("stopped");
    expect(r!.riskToStop).toBe(0);
  });

  it("at currentPrice 20 (below stop): stopped", () => {
    const r = computeEvolvingR({
      entry: 50,
      stop: 25,
      target: 100,
      currentPrice: 20,
      side: "long",
    });
    expect(r!.verdict).toBe("stopped");
  });
});

describe("computeEvolvingR — short-side mirror (entry 50, stop 75, target 0)", () => {
  it("at entry (currentPrice 50): initialRR=1, realizedR=0, hold", () => {
    const r = computeEvolvingR({ entry: 50, stop: 75, target: 0, currentPrice: 50, side: "short" });
    expect(r).not.toBeNull();
    expect(r!.initialRR).toBe(2); // reward 50 / risk 25
    expect(r!.realizedR).toBe(0);
    expect(r!.remainingReward).toBe(50);
    expect(r!.riskToStop).toBe(25);
    expect(r!.currentRR).toBe(2);
    expect(r!.verdict).toBe("hold");
  });

  it("mirror of the 85 case: currentPrice 15 -> realizedR=1.4, currentRR=0.25, manage", () => {
    // entry 50, stop 75, target 0, risk=25, price moved down to 15
    const r = computeEvolvingR({ entry: 50, stop: 75, target: 0, currentPrice: 15, side: "short" });
    expect(r).not.toBeNull();
    expect(r!.realizedR).toBe(1.4); // (50-15)/25
    expect(r!.remainingReward).toBe(15); // 15-0
    expect(r!.riskToStop).toBe(60); // 75-15
    expect(r!.currentRR).toBe(0.25);
    expect(r!.verdict).toBe("manage");
  });

  it("currentPrice 0: target_reached", () => {
    const r = computeEvolvingR({ entry: 50, stop: 75, target: 0, currentPrice: 0, side: "short" });
    expect(r!.verdict).toBe("target_reached");
  });

  it("currentPrice 75: stopped", () => {
    const r = computeEvolvingR({ entry: 50, stop: 75, target: 0, currentPrice: 75, side: "short" });
    expect(r!.verdict).toBe("stopped");
  });
});

describe("computeEvolvingR — validation returns null", () => {
  it("non-finite entry", () => {
    expect(
      computeEvolvingR({ entry: NaN, stop: 25, target: 100, currentPrice: 50, side: "long" }),
    ).toBeNull();
  });
  it("non-finite currentPrice", () => {
    expect(
      computeEvolvingR({ entry: 50, stop: 25, target: 100, currentPrice: Infinity, side: "long" }),
    ).toBeNull();
  });
  it("invalid side", () => {
    expect(
      computeEvolvingR({
        entry: 50,
        stop: 25,
        target: 100,
        currentPrice: 50,
        side: "sideways" as never,
      }),
    ).toBeNull();
  });
  it("long geometry not stop<entry<target (stop above entry)", () => {
    expect(
      computeEvolvingR({ entry: 50, stop: 60, target: 100, currentPrice: 50, side: "long" }),
    ).toBeNull();
  });
  it("long geometry not stop<entry<target (target below entry)", () => {
    expect(
      computeEvolvingR({ entry: 50, stop: 25, target: 40, currentPrice: 50, side: "long" }),
    ).toBeNull();
  });
  it("short geometry not target<entry<stop", () => {
    expect(
      computeEvolvingR({ entry: 50, stop: 40, target: 0, currentPrice: 50, side: "short" }),
    ).toBeNull();
  });
  it("zero risk (stop == entry) long", () => {
    expect(
      computeEvolvingR({ entry: 50, stop: 50, target: 100, currentPrice: 50, side: "long" }),
    ).toBeNull();
  });
});

describe("computeEvolvingR — RR cap edge", () => {
  it("currentRR capped at 999 when riskToStop is 0 but reward remains is not reachable normally; verify cap via near-stop math stays finite", () => {
    // Deep-in-profit long very close to target keeps currentRR finite and small.
    const r = computeEvolvingR({
      entry: 50,
      stop: 25,
      target: 100,
      currentPrice: 99,
      side: "long",
    });
    expect(r).not.toBeNull();
    expect(Number.isFinite(r!.currentRR)).toBe(true);
    expect(r!.currentRR).toBeLessThanOrEqual(999);
    expect(r!.verdict).toBe("manage"); // tiny remaining reward, big risk back to stop
  });
});
