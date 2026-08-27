import { describe, it, expect } from "bun:test";

import { attributeEdge, attributionToPayload } from "./edgeAttribution.ts";

describe("attributeEdge — valid edge cases", () => {
  it("Wright's structural example: panic seller margin call", () => {
    const r = attributeEdge({
      edgeType: "structural",
      counterparty: "leveraged retail traders hitting stop-loss limits",
      constraint: "margin call cascade — mechanical sell orders not driven by fundamentals",
      edgeArticulation:
        "Forced selling from margin calls creates predictable temporary dislocation; I provide liquidity at the dislocated price and exit on recovery",
    });
    expect(r.verdict).toBe("valid_edge");
    expect(r.passesFiveMinTest).toBe(true);
  });

  it("behavioral edge: FOMO chase", () => {
    const r = attributeEdge({
      edgeType: "behavioral",
      counterparty: "FOMO-driven retail buyers and momentum algos",
      constraint: "chasing performance, fear of missing out — price detached from value",
      edgeArticulation:
        "I short into the parabolic exhaustion when sentiment indicators show extremes and volume divergence appears, exiting on first reversal signal",
    });
    expect(r.verdict).toBe("valid_edge");
  });
});

describe("attributeEdge — weak / invalid cases", () => {
  it("vague counterparty fails", () => {
    const r = attributeEdge({
      edgeType: "analytical",
      counterparty: "them",
      constraint: "constrained by something specific that triggers forced flow",
      edgeArticulation:
        "I have a model that processes market data better than the consensus and finds patterns others miss",
    });
    expect(r.verdict).toBe("weak_edge");
    expect(r.reasons.some((s) => s.includes("Counterparty"))).toBe(true);
  });

  it("vague constraint fails", () => {
    const r = attributeEdge({
      edgeType: "structural",
      counterparty: "institutional index funds at month-end rebalance",
      constraint: "stuff",
      edgeArticulation:
        "Index rebalancing forces buying at specific times regardless of price; I front-run the inelastic demand window",
    });
    expect(r.verdict).toBe("weak_edge");
  });

  it("articulation under 15 words fails 5-min test", () => {
    const r = attributeEdge({
      edgeType: "informational",
      counterparty: "uninformed flow on the retail side",
      constraint: "passive index buying without fundamental analysis",
      edgeArticulation: "it goes up",
    });
    expect(r.passesFiveMinTest).toBe(false);
    expect(r.verdict).toBe("weak_edge");
  });

  it("multiple failures → no_edge", () => {
    const r = attributeEdge({
      edgeType: "behavioral",
      counterparty: "x",
      constraint: "y",
      edgeArticulation: "z",
    });
    expect(r.verdict).toBe("no_edge");
  });
});

describe("Lebron 5-min test", () => {
  it("requires >=15 words in articulation", () => {
    const exactly15 = "a b c d e f g h i j k l m n o";
    const r = attributeEdge({
      edgeType: "structural",
      counterparty: "specific forced sellers in size",
      constraint: "regulatory rebalance window with no choice",
      edgeArticulation: exactly15,
    });
    expect(r.passesFiveMinTest).toBe(true);
  });
});

describe("attributionToPayload", () => {
  it("emits stable shape", () => {
    const r = attributeEdge({
      edgeType: "structural",
      counterparty: "forced sellers under margin call",
      constraint: "leveraged liquidation cascade",
      edgeArticulation:
        "Forced selling creates predictable dislocation that I can exploit through patient liquidity provision until forced flow exhausts and price recovers",
    });
    const p = attributionToPayload(r) as { kind: string; verdict: string };
    expect(p.kind).toBe("edge_attribution.evaluated");
    expect(p.verdict).toBe("valid_edge");
  });
});
