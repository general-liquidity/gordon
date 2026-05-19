import { describe, it, expect } from "bun:test";

import {
  isManipulationContextEnabled,
  classifyManipulationContext,
  manipulationContextToPayload,
  MANIPULATION_CONTEXT_FLAG_ENV,
} from "./manipulationContext.ts";
import type { ToxicityResult } from "./microstructureToxicity.ts";

const makeToxicity = (regime: "quiet" | "elevated" | "active", score: number, overrides: Partial<ToxicityResult["components"]> = {}): ToxicityResult => ({
  score,
  regime,
  components: {
    manufacturedImbalance: 0,
    touchDynamics: 0,
    crossVenueDivergence: 0,
    displayedHalfLife: 0,
    depthTurnover: 0,
    ...overrides,
  },
  displayedHalfLifeMs: 1000,
  depthTurnoverRatio: 10,
  reasoning: "test",
});

describe("isManipulationContextEnabled", () => {
  it("respects the flag", () => {
    expect(isManipulationContextEnabled({})).toBe(false);
    expect(isManipulationContextEnabled({ [MANIPULATION_CONTEXT_FLAG_ENV]: "1" })).toBe(true);
  });
});

describe("classifyManipulationContext — regime mapping", () => {
  it("quiet → trade_normal with full size", () => {
    const r = classifyManipulationContext(makeToxicity("quiet", 0.1));
    expect(r.posture).toBe("trade_normal");
    expect(r.sizeMultiplier).toBe(1.0);
    expect(r.shouldRefuse).toBe(false);
  });

  it("elevated → size_down with 50% multiplier", () => {
    const r = classifyManipulationContext(makeToxicity("elevated", 0.45));
    expect(r.posture).toBe("size_down");
    expect(r.sizeMultiplier).toBe(0.5);
    expect(r.shouldRefuse).toBe(false);
  });

  it("active → refuse with zero size", () => {
    const r = classifyManipulationContext(makeToxicity("active", 0.8));
    expect(r.posture).toBe("refuse");
    expect(r.sizeMultiplier).toBe(0);
    expect(r.shouldRefuse).toBe(true);
  });
});

describe("classifyManipulationContext — dominant driver", () => {
  it("identifies the highest-weight component", () => {
    const r = classifyManipulationContext(
      makeToxicity("elevated", 0.5, {
        manufacturedImbalance: 0.2,
        touchDynamics: 0.8,
        displayedHalfLife: 0.3,
      }),
    );
    expect(r.dominantDriver).toBe("touchDynamics");
  });

  it("returns null when no component exceeds 0.1", () => {
    const r = classifyManipulationContext(
      makeToxicity("quiet", 0.05, {
        manufacturedImbalance: 0.05,
        touchDynamics: 0.05,
      }),
    );
    expect(r.dominantDriver).toBeNull();
  });

  it("breaks ties deterministically (manufactured wins over equal touch)", () => {
    const r = classifyManipulationContext(
      makeToxicity("elevated", 0.4, {
        manufacturedImbalance: 0.5,
        touchDynamics: 0.5,
      }),
    );
    expect(r.dominantDriver).toBe("manufacturedImbalance");
  });
});

describe("classifyManipulationContext — reasoning text", () => {
  it("quiet reasoning mentions normal trading", () => {
    const r = classifyManipulationContext(makeToxicity("quiet", 0.1));
    expect(r.reasoning.toLowerCase()).toContain("quiet");
  });

  it("active reasoning mentions refuse", () => {
    const r = classifyManipulationContext(makeToxicity("active", 0.75));
    expect(r.reasoning.toLowerCase()).toContain("refuse");
  });
});

describe("manipulationContextToPayload", () => {
  it("emits stable shape", () => {
    const r = classifyManipulationContext(makeToxicity("elevated", 0.45));
    const p = manipulationContextToPayload(r) as { kind: string; posture: string };
    expect(p.kind).toBe("manipulation_context.classified");
    expect(p.posture).toBe("size_down");
  });
});
