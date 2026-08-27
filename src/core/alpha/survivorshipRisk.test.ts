import { describe, expect, test } from "bun:test";
import { classifySurvivorshipRisk } from "./survivorshipRisk.ts";

describe("classifySurvivorshipRisk — immune cases", () => {
  test("single instrument → none, no haircut", () => {
    const r = classifySurvivorshipRisk({
      crossSectional: false,
      universeConstruction: "single_symbol",
      windowDays: 3650,
    });
    expect(r.tier).toBe("none");
    expect(r.returnHaircut).toBe(1.0);
  });

  test("non-cross-sectional overrides any construction", () => {
    const r = classifySurvivorshipRisk({
      crossSectional: false,
      universeConstruction: "current_snapshot",
      universeSize: 100,
      windowDays: 5000,
      assetClass: "crypto",
    });
    expect(r.tier).toBe("none");
  });

  test("point-in-time universe → none (survivorship-free by construction)", () => {
    const r = classifySurvivorshipRisk({
      crossSectional: true,
      universeConstruction: "point_in_time",
      universeSize: 100,
      windowDays: 5000,
      assetClass: "crypto",
    });
    expect(r.tier).toBe("none");
    expect(r.returnHaircut).toBe(1.0);
    expect(r.reasons[0]).toContain("Point-in-time");
  });

  test("liquid broad → low, light haircut", () => {
    const r = classifySurvivorshipRisk({
      crossSectional: true,
      universeConstruction: "liquid_broad",
      windowDays: 3650,
    });
    expect(r.tier).toBe("low");
    expect(r.returnHaircut).toBeLessThan(1.0);
    expect(r.returnHaircut).toBeGreaterThan(0.8);
  });
});

describe("classifySurvivorshipRisk — biased current-snapshot cases", () => {
  test("short-window small equity universe → at least low", () => {
    const r = classifySurvivorshipRisk({
      crossSectional: true,
      universeConstruction: "current_snapshot",
      universeSize: 5,
      windowDays: 200,
      assetClass: "equity",
    });
    // score: window 0 + equity 1 + size 0 = 1 → low
    expect(r.tier).toBe("low");
  });

  test("multi-year mid equity universe → medium", () => {
    const r = classifySurvivorshipRisk({
      crossSectional: true,
      universeConstruction: "current_snapshot",
      universeSize: 30,
      windowDays: 2 * 365,
      assetClass: "equity",
    });
    // score: window 1 + equity 1 + size 1 = 3 → medium
    expect(r.tier).toBe("medium");
  });

  test("long-window broad crypto universe → high (the Nasdaq-momentum analogue)", () => {
    const r = classifySurvivorshipRisk({
      crossSectional: true,
      universeConstruction: "current_snapshot",
      universeSize: 100,
      windowDays: 7 * 365,
      assetClass: "crypto",
    });
    // score: window 2 + crypto 2 + size 2 = 6 → high
    expect(r.tier).toBe("high");
    expect(r.returnHaircut).toBeLessThan(0.5);
  });

  test("a current-snapshot cross-sectional test is never below low", () => {
    const r = classifySurvivorshipRisk({
      crossSectional: true,
      universeConstruction: "current_snapshot",
      universeSize: 2,
      windowDays: 30,
      assetClass: "other",
    });
    expect(["low", "medium", "high"]).toContain(r.tier);
    expect(r.tier).toBe("low");
  });

  test("crypto amplifies vs equity at the same window/size", () => {
    const base = {
      crossSectional: true as const,
      universeConstruction: "current_snapshot" as const,
      universeSize: 15,
      windowDays: 2 * 365,
    };
    const equity = classifySurvivorshipRisk({ ...base, assetClass: "equity" });
    const crypto = classifySurvivorshipRisk({ ...base, assetClass: "crypto" });
    const order = { none: 0, low: 1, medium: 2, high: 3 } as const;
    expect(order[crypto.tier]).toBeGreaterThan(order[equity.tier]);
  });
});

describe("classifySurvivorshipRisk — output shape + guards", () => {
  test("always returns the 3-question checklist", () => {
    const r = classifySurvivorshipRisk({
      crossSectional: true,
      universeConstruction: "current_snapshot",
      universeSize: 10,
      windowDays: 365,
      assetClass: "equity",
    });
    expect(r.checklist.length).toBe(3);
    expect(r.checklist[2]).toContain("delisted");
  });

  test("interpretation names the tier and flags it's not a correction", () => {
    const r = classifySurvivorshipRisk({
      crossSectional: true,
      universeConstruction: "current_snapshot",
      universeSize: 100,
      windowDays: 5 * 365,
      assetClass: "crypto",
    });
    expect(r.interpretation).toContain("HIGH");
    expect(r.interpretation.toLowerCase()).toContain("not a correction");
  });

  test("throws on invalid universeSize / windowDays", () => {
    expect(() =>
      classifySurvivorshipRisk({
        crossSectional: true,
        universeConstruction: "current_snapshot",
        universeSize: 0,
      }),
    ).toThrow(/universeSize/);
    expect(() =>
      classifySurvivorshipRisk({
        crossSectional: true,
        universeConstruction: "current_snapshot",
        windowDays: -1,
      }),
    ).toThrow(/windowDays/);
  });
});
