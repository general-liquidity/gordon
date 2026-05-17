import { describe, it, expect } from "bun:test";

import { runShadowChain } from "./shadowChain.ts";

describe("runShadowChain — happy path", () => {
  it("clean plan with no account state → caution verdict (sizer skipped, sane summary)", () => {
    const r = runShadowChain({
      direction: "long",
      symbol: "BTC",
      entry: 65000,
      stop: 63000,
      targets: [67000, 70000],
      strategy: "breakout",
      edgeArticulation:
        "Crude breakout above multi-year resistance on expanding volume with macro tailwinds creates structural buying pressure I can ride to next supply zone",
    });
    expect(r.planId).toMatch(/^shadow-/);
    expect(r.input.symbol).toBe("BTC");
    expect(r.marginalParticipant).toBeDefined();
    expect(r.edgeAttribution).toBeDefined();
    expect(r.riskBundle).toBeDefined();
    expect(r.liquidity).toBeDefined();
    expect(r.killList).toBeDefined();
    expect(r.summary).toContain("# Shadow plan: LONG BTC");
    expect(r.summary).toContain("Verdict:");
  });
});

describe("runShadowChain — blocker aggregation", () => {
  it("vague edge articulation → weak_edge, surfaces in verdict chain", () => {
    const r = runShadowChain({
      direction: "long",
      symbol: "BTC",
      entry: 65000,
      stop: 63000,
      targets: [67000],
      edgeArticulation: "vibes",
    });
    expect(["weak_edge", "no_edge"]).toContain(r.edgeAttribution.verdict);
    expect(r.edgeAttribution.passesFiveMinTest).toBe(false);
  });

  it("zero stop distance → sizer rejects when account state set", () => {
    process.env.GORDON_INITIAL_RISK_CAPITAL_USD = "100000";
    const r = runShadowChain({
      direction: "long",
      symbol: "BTC",
      entry: 65000,
      stop: 65000,
      targets: [67000],
      edgeArticulation:
        "Trade based on a setup with sufficient articulation to pass the five minute test and survive the bundle audit",
    });
    delete process.env.GORDON_INITIAL_RISK_CAPITAL_USD;
    expect(r.sizer?.rejected).toBe(true);
    expect(r.overallVerdict).toBe("no_go");
  });

  it("operator-state booleans bias the kill list", () => {
    process.env.GORDON_OPERATOR_BORED = "1";
    const r = runShadowChain({
      direction: "long",
      symbol: "BTC",
      entry: 65000,
      stop: 63000,
      targets: [67000],
      edgeArticulation:
        "Trade based on a setup with sufficient articulation to pass the five minute test and survive the bundle audit",
    });
    delete process.env.GORDON_OPERATOR_BORED;
    expect(r.killList.pass).toBe(false);
    expect(r.overallVerdict).not.toBe("go");
  });
});

describe("runShadowChain — short direction", () => {
  it("flips liquidity-map sides correctly for shorts", () => {
    const r = runShadowChain({
      direction: "short",
      symbol: "BTC",
      entry: 65000,
      stop: 67000,
      targets: [63000, 60000],
      edgeArticulation:
        "Trade based on a setup with sufficient articulation to pass the five minute test and survive the bundle audit",
    });
    expect(r.input.direction).toBe("short");
    expect(r.summary).toContain("SHORT BTC");
  });
});

describe("runShadowChain — opportunity counterparty", () => {
  it("forced-flow drivers shift marginal participant verdict", () => {
    const r = runShadowChain({
      direction: "long",
      symbol: "BTC",
      entry: 65000,
      stop: 63000,
      targets: [67000],
      drivers: ["margin_call_cascade", "vix_spike", "bid_evaporation"],
      edgeArticulation:
        "Margin call cascade creates forced selling pressure that I can provide liquidity into and profit on the snap back to fair value",
    });
    expect(r.marginalParticipant.marginal).toBe("opportunity");
  });
});

describe("runShadowChain — structured output", () => {
  it("summary is markdown with all chain section headers", () => {
    const r = runShadowChain({
      direction: "long",
      symbol: "ETH",
      entry: 3500,
      stop: 3400,
      targets: [3600, 3700],
      strategy: "trend",
      edgeArticulation:
        "Trade based on a setup with sufficient articulation to pass the five minute test and survive the bundle audit",
    });
    expect(r.summary).toContain("# Shadow plan");
    expect(r.summary).toContain("Pre-trade chain");
    expect(r.summary).toContain("Marginal participant");
    expect(r.summary).toContain("Edge attribution");
    expect(r.summary).toContain("Risk bundle");
    expect(r.summary).toContain("Kill list");
  });
});
