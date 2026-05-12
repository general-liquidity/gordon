import { describe, expect, it } from "bun:test";

import { classifyBlockedStatus } from "./blockedClassification.ts";

describe("classifyBlockedStatus", () => {
  it("classifies anti-trap gates as controllable", () => {
    expect(classifyBlockedStatus("explain_first_missing_thesis")).toBe("controllable");
    expect(classifyBlockedStatus("risk_ack_insufficient")).toBe("controllable");
  });

  it("classifies anti-rot gates as controllable", () => {
    expect(classifyBlockedStatus("outside_trading_universe")).toBe("controllable");
    expect(classifyBlockedStatus("thesis_coherence_insufficient")).toBe("controllable");
    expect(classifyBlockedStatus("strategy_mandate_violation")).toBe("controllable");
  });

  it("classifies risk-kernel rejection as controllable", () => {
    expect(classifyBlockedStatus("risk_rejected")).toBe("controllable");
  });

  it("classifies external-state-missing as uncontrollable", () => {
    expect(classifyBlockedStatus("exchange_missing")).toBe("uncontrollable");
    expect(classifyBlockedStatus("plan_missing")).toBe("uncontrollable");
  });

  it("classifies a crashed risk gate as uncontrollable", () => {
    expect(classifyBlockedStatus("risk_gate_failed")).toBe("uncontrollable");
  });

  it("classifies permission-mode gates as controllable via suffix match", () => {
    expect(classifyBlockedStatus("paper_permission_mode")).toBe("controllable");
    expect(classifyBlockedStatus("read_only_permission_mode")).toBe("controllable");
    expect(classifyBlockedStatus("strict_permission_mode")).toBe("controllable");
  });

  it("defaults unknown statuses to controllable (fail-loud bias)", () => {
    expect(classifyBlockedStatus("some_new_status_we_havent_seen_yet")).toBe("controllable");
    expect(classifyBlockedStatus("")).toBe("controllable");
  });
});
