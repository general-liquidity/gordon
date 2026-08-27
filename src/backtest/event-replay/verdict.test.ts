import { describe, it, expect } from "bun:test";
import { evaluateReplay, formatVerdict } from "./verdict.ts";
import type { ReplayMetrics } from "./types.ts";

function makeMetrics(overrides: Partial<ReplayMetrics> = {}): ReplayMetrics {
  return {
    eventId: "test",
    windowStart: 0,
    windowEnd: 86400000,
    maxIntradayDrawdown: 0.05,
    eventWindowPnl: -1000,
    maxSingleTradeSlippage: 50,
    riskResponseTimeSeconds: 300,
    trades: [],
    equityCurve: [],
    ...overrides,
  };
}

describe("evaluateReplay — drawdown check", () => {
  it("passes when DD ≤ baseline", () => {
    const v = evaluateReplay(makeMetrics({ maxIntradayDrawdown: 0.05 }), {
      baseline99thPctDrawdown: 0.1,
    });
    expect(v.passed).toBe(true);
    expect(v.reasons.some((r) => r.includes("within"))).toBe(true);
  });

  it("fails when DD > baseline", () => {
    const v = evaluateReplay(makeMetrics({ maxIntradayDrawdown: 0.15 }), {
      baseline99thPctDrawdown: 0.1,
    });
    expect(v.passed).toBe(false);
    expect(v.reasons.some((r) => r.includes("exceeded 99th-pct baseline"))).toBe(true);
  });

  it("skips DD check when threshold omitted", () => {
    const v = evaluateReplay(makeMetrics({ maxIntradayDrawdown: 0.5 }), {});
    expect(v.comparedTo.baseline99thPctDrawdown).toBeUndefined();
    expect(v.reasons.some((r) => r.includes("baseline"))).toBe(false);
  });
});

describe("evaluateReplay — risk response check", () => {
  it("passes when response time within budget", () => {
    const v = evaluateReplay(makeMetrics({ riskResponseTimeSeconds: 200 }), {
      responseTimeBudgetSeconds: 300,
    });
    expect(v.passed).toBe(true);
  });

  it("fails when response time exceeds budget", () => {
    const v = evaluateReplay(makeMetrics({ riskResponseTimeSeconds: 600 }), {
      responseTimeBudgetSeconds: 300,
    });
    expect(v.passed).toBe(false);
    expect(v.reasons.some((r) => r.includes("exceeded budget"))).toBe(true);
  });

  it("fails when strategy never reduces exposure", () => {
    const v = evaluateReplay(makeMetrics({ riskResponseTimeSeconds: null }), {
      responseTimeBudgetSeconds: 300,
    });
    expect(v.passed).toBe(false);
    expect(v.reasons.some((r) => r.includes("never reduced"))).toBe(true);
  });
});

describe("evaluateReplay — slippage check", () => {
  it("passes when slippage within 200bps default ceiling", () => {
    const v = evaluateReplay(makeMetrics({ maxSingleTradeSlippage: 50 }), {});
    expect(v.passed).toBe(true);
  });

  it("fails when slippage exceeds default ceiling", () => {
    const v = evaluateReplay(makeMetrics({ maxSingleTradeSlippage: 500 }), {});
    expect(v.passed).toBe(false);
    expect(v.reasons.some((r) => r.includes("Worst single-trade slippage"))).toBe(true);
  });

  it("respects custom slippage ceiling", () => {
    const v = evaluateReplay(makeMetrics({ maxSingleTradeSlippage: 50 }), {
      maxAcceptableSlippageBps: 30,
    });
    expect(v.passed).toBe(false);
  });
});

describe("evaluateReplay — combined fails", () => {
  it("accumulates multiple failure reasons", () => {
    const v = evaluateReplay(
      makeMetrics({
        maxIntradayDrawdown: 0.2,
        riskResponseTimeSeconds: 999,
        maxSingleTradeSlippage: 999,
      }),
      {
        baseline99thPctDrawdown: 0.1,
        responseTimeBudgetSeconds: 300,
        maxAcceptableSlippageBps: 100,
      },
    );
    expect(v.passed).toBe(false);
    const failureReasons = v.reasons.filter((r) => r.includes("exceed"));
    expect(failureReasons.length).toBeGreaterThanOrEqual(2);
  });
});

describe("evaluateReplay — no thresholds supplied", () => {
  it("surfaces a clear notice when operator supplied nothing", () => {
    const v = evaluateReplay(makeMetrics(), {});
    expect(v.reasons[0]).toContain("No thresholds supplied");
  });
});

describe("formatVerdict", () => {
  it("renders PASS status with metrics", () => {
    const v = evaluateReplay(makeMetrics(), { baseline99thPctDrawdown: 0.1 });
    const text = formatVerdict(v);
    expect(text).toContain("PASS");
    expect(text).toContain("Max DD");
    expect(text).toContain("Event PnL");
    expect(text).toContain("Reasons");
  });

  it("renders FAIL status when verdict failed", () => {
    const v = evaluateReplay(makeMetrics({ maxIntradayDrawdown: 0.5 }), {
      baseline99thPctDrawdown: 0.1,
    });
    const text = formatVerdict(v);
    expect(text).toContain("FAIL");
  });

  it("formats 'never reduced' when riskResponseTimeSeconds is null", () => {
    const v = evaluateReplay(makeMetrics({ riskResponseTimeSeconds: null }), {});
    const text = formatVerdict(v);
    expect(text).toContain("never reduced");
  });
});
