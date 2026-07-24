import { describe, it, expect } from "bun:test";
import {
  evaluateRevengeTradeGuard,
  revengeTradeGuardToPayload,
  isRevengeTradeGuardEnabled,
  REVENGE_TRADE_GUARD_FLAG_ENV,
} from "./revengeTradeGuard.ts";

describe("isRevengeTradeGuardEnabled", () => {
  it("respects the flag (default-on, explicit opt-out)", () => {
    expect(isRevengeTradeGuardEnabled({})).toBe(true);
    expect(
      isRevengeTradeGuardEnabled({ [REVENGE_TRADE_GUARD_FLAG_ENV]: "1" }),
    ).toBe(true);
    expect(
      isRevengeTradeGuardEnabled({ [REVENGE_TRADE_GUARD_FLAG_ENV]: "0" }),
    ).toBe(false);
    expect(
      isRevengeTradeGuardEnabled({ [REVENGE_TRADE_GUARD_FLAG_ENV]: "false" }),
    ).toBe(false);
  });
});

describe("evaluateRevengeTradeGuard — validation", () => {
  const base = {
    proposedPlanSize: 100,
    baselineSize: 100,
    priorTradePnL: 0,
  };

  it("rejects negative proposedPlanSize", () => {
    expect(() =>
      evaluateRevengeTradeGuard({ ...base, proposedPlanSize: -1 }),
    ).toThrow();
  });

  it("rejects non-positive baselineSize", () => {
    expect(() =>
      evaluateRevengeTradeGuard({ ...base, baselineSize: 0 }),
    ).toThrow();
  });

  it("rejects non-finite priorTradePnL", () => {
    expect(() =>
      evaluateRevengeTradeGuard({ ...base, priorTradePnL: NaN }),
    ).toThrow();
  });

  it("rejects sizeIncreaseThreshold ≤ 1", () => {
    expect(() =>
      evaluateRevengeTradeGuard({ ...base, sizeIncreaseThreshold: 1 }),
    ).toThrow();
    expect(() =>
      evaluateRevengeTradeGuard({ ...base, sizeIncreaseThreshold: 0.5 }),
    ).toThrow();
  });
});

describe("evaluateRevengeTradeGuard — detection logic", () => {
  it("prior loss + size at baseline → proceed (size not above threshold)", () => {
    const r = evaluateRevengeTradeGuard({
      proposedPlanSize: 100,
      baselineSize: 100,
      priorTradePnL: -50,
    });
    expect(r.priorTradeWasLoss).toBe(true);
    expect(r.sizeAboveThreshold).toBe(false);
    expect(r.revengeTradeDetected).toBe(false);
    expect(r.recommendedAction).toBe("proceed");
  });

  it("prior loss + size 1.4× baseline → proceed (below 1.5× default threshold)", () => {
    const r = evaluateRevengeTradeGuard({
      proposedPlanSize: 140,
      baselineSize: 100,
      priorTradePnL: -50,
    });
    expect(r.sizeAboveThreshold).toBe(false);
    expect(r.revengeTradeDetected).toBe(false);
    expect(r.recommendedAction).toBe("proceed");
  });

  it("prior loss + size 1.5× baseline (exactly threshold) → revenge detected", () => {
    const r = evaluateRevengeTradeGuard({
      proposedPlanSize: 150,
      baselineSize: 100,
      priorTradePnL: -50,
    });
    expect(r.sizeAboveThreshold).toBe(true);
    expect(r.revengeTradeDetected).toBe(true);
  });

  it("prior loss + size 2× baseline → revenge detected, flag in informational mode", () => {
    const r = evaluateRevengeTradeGuard({
      proposedPlanSize: 200,
      baselineSize: 100,
      priorTradePnL: -50,
    });
    expect(r.revengeTradeDetected).toBe(true);
    expect(r.recommendedAction).toBe("flag");
  });

  it("prior WIN + size 2× baseline → not a revenge trade, proceed", () => {
    const r = evaluateRevengeTradeGuard({
      proposedPlanSize: 200,
      baselineSize: 100,
      priorTradePnL: 50, // win
    });
    expect(r.priorTradeWasLoss).toBe(false);
    expect(r.sizeAboveThreshold).toBe(true);
    expect(r.revengeTradeDetected).toBe(false);
    expect(r.recommendedAction).toBe("proceed");
  });

  it("prior PnL = 0 (flat) + size 2× baseline → not a loss, proceed", () => {
    const r = evaluateRevengeTradeGuard({
      proposedPlanSize: 200,
      baselineSize: 100,
      priorTradePnL: 0,
    });
    expect(r.priorTradeWasLoss).toBe(false);
    expect(r.revengeTradeDetected).toBe(false);
    expect(r.recommendedAction).toBe("proceed");
  });
});

describe("evaluateRevengeTradeGuard — mode behavior", () => {
  const revengeInputs = {
    proposedPlanSize: 200,
    baselineSize: 100,
    priorTradePnL: -50,
  };

  it("informational mode (default): revenge → flag", () => {
    const r = evaluateRevengeTradeGuard(revengeInputs);
    expect(r.mode).toBe("informational");
    expect(r.recommendedAction).toBe("flag");
  });

  it("active mode: revenge → block", () => {
    const r = evaluateRevengeTradeGuard({ ...revengeInputs, mode: "active" });
    expect(r.mode).toBe("active");
    expect(r.recommendedAction).toBe("block");
  });

  it("no revenge → proceed regardless of mode", () => {
    const noRevenge = {
      proposedPlanSize: 100,
      baselineSize: 100,
      priorTradePnL: -50,
    };
    expect(evaluateRevengeTradeGuard(noRevenge).recommendedAction).toBe("proceed");
    expect(
      evaluateRevengeTradeGuard({ ...noRevenge, mode: "active" }).recommendedAction,
    ).toBe("proceed");
  });
});

describe("evaluateRevengeTradeGuard — custom threshold", () => {
  it("tighter threshold (1.2×) catches smaller escalations", () => {
    const r = evaluateRevengeTradeGuard({
      proposedPlanSize: 130,
      baselineSize: 100,
      priorTradePnL: -50,
      sizeIncreaseThreshold: 1.2,
    });
    expect(r.revengeTradeDetected).toBe(true);
  });

  it("looser threshold (2.0×) misses 1.5× escalation", () => {
    const r = evaluateRevengeTradeGuard({
      proposedPlanSize: 150,
      baselineSize: 100,
      priorTradePnL: -50,
      sizeIncreaseThreshold: 2.0,
    });
    expect(r.revengeTradeDetected).toBe(false);
  });
});

describe("revengeTradeGuardToPayload", () => {
  it("emits stable shape", () => {
    const r = evaluateRevengeTradeGuard({
      proposedPlanSize: 200,
      baselineSize: 100,
      priorTradePnL: -50,
    });
    const p = revengeTradeGuardToPayload(r) as {
      kind: string;
      revengeTradeDetected: boolean;
      recommendedAction: string;
      mode: string;
    };
    expect(p.kind).toBe("revenge_trade_guard.evaluated");
    expect(p.revengeTradeDetected).toBe(true);
    expect(p.recommendedAction).toBe("flag");
    expect(p.mode).toBe("informational");
  });
});
