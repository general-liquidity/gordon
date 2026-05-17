import { describe, it, expect, beforeEach } from "bun:test";

import {
  shadowPlanTool,
  getLastShadowPlanForTesting,
  _resetLastShadowForTesting,
} from "./shadowPlan.ts";

beforeEach(() => {
  _resetLastShadowForTesting();
});

const exec = async (input: Record<string, unknown>) => {
  // bypass Mastra runtime by calling execute directly
  return (await (shadowPlanTool as unknown as { execute: (i: unknown) => Promise<unknown> }).execute(
    input,
  )) as {
    planId: string;
    verdict: string;
    blockerCount: number;
    summary: string;
    implicitRetry: boolean;
  };
};

describe("shadowPlanTool — happy path", () => {
  it("returns a structured result with markdown summary", async () => {
    const r = await exec({
      direction: "long",
      symbol: "BTC",
      entry: 65000,
      stop: 63000,
      targets: [67000, 70000],
      strategy: "breakout",
      edgeArticulation:
        "Breakout above multi-year resistance with expanding volume creates structural buying pressure into next supply zone, which I can capture by entering on the reclaim",
      drivers: [],
      tier: "I",
      edgeType: "structural",
    });
    expect(r.planId).toMatch(/^shadow-/);
    expect(["go", "caution", "no_go"]).toContain(r.verdict);
    expect(r.summary).toContain("Shadow plan: LONG BTC");
    expect(r.implicitRetry).toBe(false);
  });
});

describe("shadowPlanTool — implicit retry detection", () => {
  it("re-invoking with same symbol/direction/entry within window fires retry signal", async () => {
    await exec({
      direction: "long",
      symbol: "BTC",
      entry: 65000,
      stop: 63000,
      targets: [67000],
      drivers: [],
      tier: "I",
      edgeType: "structural",
    });
    expect(getLastShadowPlanForTesting()?.symbol).toBe("BTC");
    const r2 = await exec({
      direction: "long",
      symbol: "BTC",
      entry: 65100,
      stop: 63000,
      targets: [67000],
      drivers: [],
      tier: "I",
      edgeType: "structural",
    });
    expect(r2.implicitRetry).toBe(true);
  });

  it("different symbol does NOT fire retry", async () => {
    await exec({
      direction: "long",
      symbol: "BTC",
      entry: 65000,
      stop: 63000,
      targets: [67000],
      drivers: [],
      tier: "I",
      edgeType: "structural",
    });
    const r2 = await exec({
      direction: "long",
      symbol: "ETH",
      entry: 3500,
      stop: 3400,
      targets: [3600],
      drivers: [],
      tier: "I",
      edgeType: "structural",
    });
    expect(r2.implicitRetry).toBe(false);
  });

  it("opposite direction does NOT fire retry", async () => {
    await exec({
      direction: "long",
      symbol: "BTC",
      entry: 65000,
      stop: 63000,
      targets: [67000],
      drivers: [],
      tier: "I",
      edgeType: "structural",
    });
    const r2 = await exec({
      direction: "short",
      symbol: "BTC",
      entry: 65000,
      stop: 67000,
      targets: [63000],
      drivers: [],
      tier: "I",
      edgeType: "structural",
    });
    expect(r2.implicitRetry).toBe(false);
  });

  it("entry deviation > 2% does NOT fire retry", async () => {
    await exec({
      direction: "long",
      symbol: "BTC",
      entry: 65000,
      stop: 63000,
      targets: [67000],
      drivers: [],
      tier: "I",
      edgeType: "structural",
    });
    const r2 = await exec({
      direction: "long",
      symbol: "BTC",
      entry: 67000,
      stop: 65000,
      targets: [69000],
      drivers: [],
      tier: "I",
      edgeType: "structural",
    });
    expect(r2.implicitRetry).toBe(false);
  });
});
