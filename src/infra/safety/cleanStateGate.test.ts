import { describe, it, expect } from "bun:test";

import {
  isCleanStateGateEnabled,
  runCleanStateGate,
  hasOverrideAcknowledgement,
  gateResultToPayload,
  type SessionProgressSignal,
} from "./cleanStateGate.ts";
import type { DiagnosticCheck } from "../diagnostics/doctor.ts";

const enabledEnv = { GORDON_CLEAN_STATE_GATE: "1" } as NodeJS.ProcessEnv;
const cleanProgress: SessionProgressSignal = {
  workingMemoryFlushed: true,
  actionLogHasEntries: true,
  noOrphanPlans: true,
};

function check(id: string, status: DiagnosticCheck["status"]): DiagnosticCheck {
  return { id, label: id, status, message: `${id} ${status}` };
}

describe("isCleanStateGateEnabled", () => {
  it("respects the flag", () => {
    expect(isCleanStateGateEnabled({})).toBe(false);
    expect(isCleanStateGateEnabled({ GORDON_CLEAN_STATE_GATE: "1" })).toBe(true);
    expect(isCleanStateGateEnabled({ GORDON_CLEAN_STATE_GATE: "true" })).toBe(true);
  });
});

describe("runCleanStateGate (disabled)", () => {
  it("returns clean with skippedReason when flag off", () => {
    const result = runCleanStateGate([check("supply-chain-iocs", "fail")], cleanProgress, {});
    expect(result.verdict).toBe("clean");
    expect(result.skippedReason).toBeDefined();
  });
});

describe("runCleanStateGate (enabled)", () => {
  it("returns clean when all gate-eligible checks pass and progress is good", () => {
    const checks = [
      check("supply-chain-iocs", "pass"),
      check("safety-deny-list", "pass"),
      check("mastra-patch", "pass"),
      // unrelated warn that's NOT gate-eligible should not affect verdict
      check("install-release-age", "warn"),
    ];
    const result = runCleanStateGate(checks, cleanProgress, enabledEnv);
    expect(result.verdict).toBe("clean");
    expect(result.failingChecks).toHaveLength(0);
    expect(result.warningChecks).toHaveLength(0);
  });

  it("blocks when a gate-eligible check fails", () => {
    const checks = [check("supply-chain-iocs", "fail"), check("safety-deny-list", "pass")];
    const result = runCleanStateGate(checks, cleanProgress, enabledEnv);
    expect(result.verdict).toBe("block");
    expect(result.failingChecks).toHaveLength(1);
    expect(result.failingChecks[0]?.id).toBe("supply-chain-iocs");
    expect(result.blockingMessage).toContain("supply-chain-iocs");
  });

  it("warns when a gate-eligible check warns and none fail", () => {
    const checks = [check("mastra-db", "warn"), check("safety-deny-list", "pass")];
    const result = runCleanStateGate(checks, cleanProgress, enabledEnv);
    expect(result.verdict).toBe("warn");
    expect(result.warningChecks).toHaveLength(1);
  });

  it("blocks when working memory is not flushed", () => {
    const result = runCleanStateGate(
      [check("safety-deny-list", "pass")],
      { ...cleanProgress, workingMemoryFlushed: false },
      enabledEnv,
    );
    expect(result.verdict).toBe("block");
    expect(result.blockingMessage).toContain("working memory not flushed");
  });

  it("blocks when no action-log entries exist", () => {
    const result = runCleanStateGate(
      [check("safety-deny-list", "pass")],
      { ...cleanProgress, actionLogHasEntries: false },
      enabledEnv,
    );
    expect(result.verdict).toBe("block");
    expect(result.blockingMessage).toContain("action log");
  });

  it("blocks when orphan plans remain", () => {
    const result = runCleanStateGate(
      [check("safety-deny-list", "pass")],
      { ...cleanProgress, noOrphanPlans: false },
      enabledEnv,
    );
    expect(result.verdict).toBe("block");
    expect(result.blockingMessage).toContain("in-flight plans");
  });

  it("ignores non-gate-eligible failures", () => {
    const checks = [
      check("audit-advisories", "fail"), // not gate-eligible
      check("safety-deny-list", "pass"),
    ];
    const result = runCleanStateGate(checks, cleanProgress, enabledEnv);
    expect(result.verdict).toBe("clean");
  });

  it("reports both failing checks and progress violations in the message", () => {
    const result = runCleanStateGate(
      [check("supply-chain-iocs", "fail")],
      { workingMemoryFlushed: false, actionLogHasEntries: true, noOrphanPlans: true },
      enabledEnv,
    );
    expect(result.verdict).toBe("block");
    expect(result.blockingMessage).toContain("supply-chain-iocs");
    expect(result.blockingMessage).toContain("working memory not flushed");
  });
});

describe("hasOverrideAcknowledgement", () => {
  it("respects the override env var", () => {
    expect(hasOverrideAcknowledgement({})).toBe(false);
    expect(hasOverrideAcknowledgement({ GORDON_CLEAN_STATE_GATE_OVERRIDE: "1" })).toBe(true);
    expect(hasOverrideAcknowledgement({ GORDON_CLEAN_STATE_GATE_OVERRIDE: "true" })).toBe(true);
  });
});

describe("gateResultToPayload", () => {
  it("preserves verdict and IDs", () => {
    const result = runCleanStateGate(
      [check("supply-chain-iocs", "fail"), check("safety-deny-list", "pass")],
      cleanProgress,
      enabledEnv,
    );
    const p = gateResultToPayload(result, false);
    expect(p.kind).toBe("clean_state.gate_recorded");
    expect(p.verdict).toBe("block");
    expect(p.failingIds).toEqual(["supply-chain-iocs"]);
    expect(p.overridden).toBe(false);
  });

  it("records override flag", () => {
    const result = runCleanStateGate(
      [check("supply-chain-iocs", "fail")],
      cleanProgress,
      enabledEnv,
    );
    const p = gateResultToPayload(result, true);
    expect(p.overridden).toBe(true);
  });
});
