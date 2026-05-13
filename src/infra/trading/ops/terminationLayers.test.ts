import { describe, it, expect } from "bun:test";

import {
  isTerminationLayersEnabled,
  checkPreTrade,
  checkRuntime,
  checkSystemConfirmation,
  runTerminationLayers,
  terminationToPayload,
  type PreTradeInput,
  type RuntimeInput,
  type SystemConfirmationInput,
} from "./terminationLayers.ts";

const cleanPreTrade: PreTradeInput = {
  riskTier: "low",
  riskClassifierVerdict: "auto_approve",
  constitutionViolations: [],
  mandateScopeOk: true,
  thesisCoherenceOk: true,
};

const cleanRuntime: RuntimeInput = {
  orderId: "ord-1",
  ackReceived: true,
  ackLatencyMs: 100,
  ackTimeoutMs: 5000,
  brokerRejectReason: null,
};

const cleanSystem: SystemConfirmationInput = {
  expectedFillPrice: 100,
  actualFillPrice: 100.2,
  maxSlippageFraction: 0.01,
  expectedSize: 1.0,
  actualSize: 1.0,
  auditLogEntryId: "audit-1",
};

describe("isTerminationLayersEnabled", () => {
  it("respects the flag", () => {
    expect(isTerminationLayersEnabled({})).toBe(false);
    expect(isTerminationLayersEnabled({ GORDON_TERMINATION_LAYERS: "1" })).toBe(true);
  });
});

describe("checkPreTrade", () => {
  it("passes clean input", () => {
    const r = checkPreTrade(cleanPreTrade);
    expect(r.status).toBe("pass");
  });

  it("fails with fix instruction when classifier blocks", () => {
    const r = checkPreTrade({ ...cleanPreTrade, riskClassifierVerdict: "block" });
    expect(r.status).toBe("fail");
    expect(r.fixInstruction).toContain("riskClassifier");
  });

  it("fails with fix instruction on constitution violations", () => {
    const r = checkPreTrade({
      ...cleanPreTrade,
      constitutionViolations: ["max-position-size exceeded"],
    });
    expect(r.status).toBe("fail");
    expect(r.fixInstruction).toContain("constitution");
  });

  it("fails on mandate scope violation", () => {
    const r = checkPreTrade({ ...cleanPreTrade, mandateScopeOk: false });
    expect(r.status).toBe("fail");
    expect(r.fixInstruction).toContain("mandate");
  });

  it("fails on thesis-coherence below threshold", () => {
    const r = checkPreTrade({ ...cleanPreTrade, thesisCoherenceOk: false });
    expect(r.status).toBe("fail");
    expect(r.fixInstruction).toContain("thesis");
  });

  it("accumulates multiple failure causes", () => {
    const r = checkPreTrade({
      ...cleanPreTrade,
      riskClassifierVerdict: "block",
      mandateScopeOk: false,
    });
    expect(r.status).toBe("fail");
    expect(r.message).toContain("risk classifier");
    expect(r.message).toContain("mandate");
  });
});

describe("checkRuntime", () => {
  it("passes clean input", () => {
    expect(checkRuntime(cleanRuntime).status).toBe("pass");
  });

  it("fails on broker reject with fix instruction", () => {
    const r = checkRuntime({ ...cleanRuntime, brokerRejectReason: "insufficient margin" });
    expect(r.status).toBe("fail");
    expect(r.fixInstruction).toContain("reject");
  });

  it("fails when orderId is null", () => {
    const r = checkRuntime({ ...cleanRuntime, orderId: null });
    expect(r.status).toBe("fail");
    expect(r.fixInstruction).toContain("connectivity");
  });

  it("fails when no ack received", () => {
    const r = checkRuntime({ ...cleanRuntime, ackReceived: false });
    expect(r.status).toBe("fail");
    expect(r.fixInstruction).toContain("duplicate fill");
  });

  it("fails when ack arrives after timeout", () => {
    const r = checkRuntime({ ...cleanRuntime, ackLatencyMs: 6000, ackTimeoutMs: 5000 });
    expect(r.status).toBe("fail");
    expect(r.fixInstruction).toContain("timeout");
  });
});

describe("checkSystemConfirmation", () => {
  it("passes clean input", () => {
    expect(checkSystemConfirmation(cleanSystem).status).toBe("pass");
  });

  it("fails on missing audit log", () => {
    const r = checkSystemConfirmation({ ...cleanSystem, auditLogEntryId: null });
    expect(r.status).toBe("fail");
    expect(r.fixInstruction).toContain("action-log");
  });

  it("fails on slippage beyond tolerance", () => {
    const r = checkSystemConfirmation({
      ...cleanSystem,
      expectedFillPrice: 100,
      actualFillPrice: 102,
      maxSlippageFraction: 0.01,
    });
    expect(r.status).toBe("fail");
    expect(r.message).toContain("slippage");
  });

  it("fails on size mismatch", () => {
    const r = checkSystemConfirmation({
      ...cleanSystem,
      expectedSize: 1.0,
      actualSize: 0.5,
    });
    expect(r.status).toBe("fail");
    expect(r.message).toContain("size mismatch");
  });

  it("records evidence", () => {
    const r = checkSystemConfirmation(cleanSystem);
    expect(r.evidence).toEqual(["audit-1"]);
  });
});

describe("runTerminationLayers", () => {
  it("all-pass returns pass verdict and highestLayer=3", () => {
    const r = runTerminationLayers({
      preTrade: cleanPreTrade,
      runtime: cleanRuntime,
      system: cleanSystem,
    });
    expect(r.verdict).toBe("pass");
    expect(r.highestLayer).toBe(3);
  });

  it("skips L2+L3 when L1 fails", () => {
    const r = runTerminationLayers({
      preTrade: { ...cleanPreTrade, riskClassifierVerdict: "block" },
      runtime: cleanRuntime,
      system: cleanSystem,
    });
    expect(r.verdict).toBe("fail");
    expect(r.layers[1].status).toBe("skip");
    expect(r.layers[2].status).toBe("skip");
    expect(r.highestLayer).toBe(1);
  });

  it("skips L3 when L2 fails", () => {
    const r = runTerminationLayers({
      preTrade: cleanPreTrade,
      runtime: { ...cleanRuntime, brokerRejectReason: "no liquidity" },
      system: cleanSystem,
    });
    expect(r.verdict).toBe("fail");
    expect(r.layers[2].status).toBe("skip");
  });

  it("returns partial when later inputs are pending but earlier passed", () => {
    const r = runTerminationLayers({
      preTrade: cleanPreTrade,
      runtime: null,
      system: null,
    });
    expect(r.verdict).toBe("partial");
    expect(r.highestLayer).toBe(1);
    expect(r.layers[0].status).toBe("pass");
    expect(r.layers[1].status).toBe("skip");
  });

  it("aggregates fix instructions from failing layers", () => {
    const r = runTerminationLayers({
      preTrade: { ...cleanPreTrade, riskClassifierVerdict: "block" },
      runtime: cleanRuntime,
      system: cleanSystem,
    });
    expect(r.blockingFixInstruction).toContain("[L1]");
  });
});

describe("terminationToPayload", () => {
  it("emits stable shape", () => {
    const r = runTerminationLayers({
      preTrade: cleanPreTrade,
      runtime: cleanRuntime,
      system: cleanSystem,
    });
    const p = terminationToPayload(r);
    expect(p.kind).toBe("termination.layers_recorded");
    expect(p.verdict).toBe("pass");
    expect(Array.isArray(p.layers)).toBe(true);
    expect((p.layers as unknown[]).length).toBe(3);
  });
});
