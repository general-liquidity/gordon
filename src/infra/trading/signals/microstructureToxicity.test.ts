import { describe, it, expect } from "bun:test";

import {
  isMicrostructureToxicityEnabled,
  scoreMicrostructureToxicity,
  toxicityToPayload,
  MICROSTRUCTURE_TOXICITY_FLAG_ENV,
  type LevelLifecycle,
} from "./microstructureToxicity.ts";

describe("isMicrostructureToxicityEnabled", () => {
  it("respects the flag", () => {
    expect(isMicrostructureToxicityEnabled({})).toBe(false);
    expect(isMicrostructureToxicityEnabled({ [MICROSTRUCTURE_TOXICITY_FLAG_ENV]: "1" })).toBe(true);
  });
});

describe("scoreMicrostructureToxicity — quiet baseline", () => {
  it("no inputs → quiet regime with zero score", () => {
    const r = scoreMicrostructureToxicity({});
    expect(r.regime).toBe("quiet");
    expect(r.score).toBe(0);
  });

  it("benign metrics → quiet", () => {
    const r = scoreMicrostructureToxicity({
      manufacturedImbalance: {
        verdict: "clean",
        peakObi: 0.1,
        endObi: 0.05,
        decayRatio: 0.5,
        executedInWindow: 100,
        confidence: 0,
        reason: "ok",
      },
      touchDynamics: {
        updateRatePerSec: 5,
        sizeFlickerCv: 0.1,
        spreadVolatility: 0.05,
        midJitter: 0.1,
        compositeScore: 0.15,
        state: "quiet",
        sampleSize: 50,
        reason: "ok",
      },
    });
    expect(r.regime).toBe("quiet");
  });
});

describe("scoreMicrostructureToxicity — elevated regime", () => {
  it("strong touch dynamics + suspicious imbalance → elevated", () => {
    const r = scoreMicrostructureToxicity({
      manufacturedImbalance: {
        verdict: "manufactured",
        peakObi: 0.7,
        endObi: 0.15,
        decayRatio: 0.2,
        executedInWindow: 5,
        confidence: 0.8,
        reason: "x",
      },
      touchDynamics: {
        updateRatePerSec: 60,
        sizeFlickerCv: 0.9,
        spreadVolatility: 0.8,
        midJitter: 0.6,
        compositeScore: 0.85,
        state: "elevated",
        sampleSize: 100,
        reason: "x",
      },
    });
    expect(["elevated", "active"]).toContain(r.regime);
    expect(r.score).toBeGreaterThan(0.3);
  });
});

describe("scoreMicrostructureToxicity — active manipulation regime", () => {
  it("manufactured imbalance + hot touch + short half-life + high turnover → active", () => {
    const cycles: LevelLifecycle[] = [];
    for (let i = 0; i < 30; i++) {
      cycles.push({ appearedAt: i * 100, disappearedAt: i * 100 + 50, filledBeforeRemoval: false });
    }
    const r = scoreMicrostructureToxicity({
      manufacturedImbalance: {
        verdict: "manufactured",
        peakObi: 0.85,
        endObi: 0.1,
        decayRatio: 0.12,
        executedInWindow: 0,
        confidence: 0.9,
        reason: "x",
      },
      touchDynamics: {
        updateRatePerSec: 80,
        sizeFlickerCv: 0.95,
        spreadVolatility: 0.8,
        midJitter: 0.6,
        compositeScore: 0.85,
        state: "hot",
        sampleSize: 200,
        reason: "x",
      },
      crossVenueDivergence: {
        pairs: [],
        anyAlert: true,
        maxObservedDivergence: 0.008,
        reason: "x",
      },
      levelLifecycles: cycles,
      executedVolume: 100,
      addedPlusCancelledSize: 30_000,
    });
    expect(r.regime).toBe("active");
    expect(r.score).toBeGreaterThan(0.65);
    expect(r.reasoning).toContain("manufactured");
  });
});

describe("scoreMicrostructureToxicity — half-life sub-metric", () => {
  it("short cancel half-life → high half-life score", () => {
    const cycles: LevelLifecycle[] = [];
    for (let i = 0; i < 20; i++) {
      cycles.push({ appearedAt: i * 100, disappearedAt: i * 100 + 50, filledBeforeRemoval: false });
    }
    const r = scoreMicrostructureToxicity({ levelLifecycles: cycles });
    expect(r.components.displayedHalfLife).toBeGreaterThan(0.5);
    expect(r.displayedHalfLifeMs).toBeLessThan(100);
  });

  it("long-lived cancels → low half-life score", () => {
    const cycles: LevelLifecycle[] = [];
    for (let i = 0; i < 20; i++) {
      cycles.push({ appearedAt: i * 1000, disappearedAt: i * 1000 + 10_000, filledBeforeRemoval: false });
    }
    const r = scoreMicrostructureToxicity({ levelLifecycles: cycles });
    expect(r.components.displayedHalfLife).toBeLessThanOrEqual(0.2);
  });

  it("fills don't count toward cancel-driven half-life", () => {
    const cycles: LevelLifecycle[] = [];
    for (let i = 0; i < 20; i++) {
      cycles.push({ appearedAt: i * 100, disappearedAt: i * 100 + 50, filledBeforeRemoval: true });
    }
    const r = scoreMicrostructureToxicity({ levelLifecycles: cycles });
    expect(r.components.displayedHalfLife).toBe(0);
  });
});

describe("scoreMicrostructureToxicity — turnover sub-metric", () => {
  it("high added+cancelled vs low executed → high turnover score", () => {
    const r = scoreMicrostructureToxicity({
      addedPlusCancelledSize: 50_000,
      executedVolume: 100,
    });
    expect(r.components.depthTurnover).toBeGreaterThan(0.5);
  });

  it("healthy MM ratio (~10x) → low turnover score", () => {
    const r = scoreMicrostructureToxicity({
      addedPlusCancelledSize: 1000,
      executedVolume: 100,
    });
    expect(r.components.depthTurnover).toBeLessThanOrEqual(0.2);
  });
});

describe("scoreMicrostructureToxicity — thresholds", () => {
  it("respects custom active/elevated thresholds", () => {
    const tight = scoreMicrostructureToxicity({
      manufacturedImbalance: {
        verdict: "suspicious",
        peakObi: 0.5,
        endObi: 0.2,
        decayRatio: 0.4,
        executedInWindow: 0,
        confidence: 0.3,
        reason: "x",
      },
      activeThreshold: 0.1,
      elevatedThreshold: 0.05,
    });
    expect(["elevated", "active"]).toContain(tight.regime);
  });
});

describe("toxicityToPayload", () => {
  it("emits stable shape", () => {
    const r = scoreMicrostructureToxicity({});
    const p = toxicityToPayload(r) as { kind: string; regime: string };
    expect(p.kind).toBe("microstructure_toxicity.scored");
    expect(typeof p.regime).toBe("string");
  });

  it("handles infinite turnover (zero executed)", () => {
    const r = scoreMicrostructureToxicity({
      addedPlusCancelledSize: 1000,
      executedVolume: 0,
    });
    const p = toxicityToPayload(r) as { depthTurnoverRatio: number | null };
    expect(p.depthTurnoverRatio).toBeNull();
  });
});
