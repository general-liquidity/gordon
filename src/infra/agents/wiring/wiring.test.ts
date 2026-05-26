import { describe, it, expect, beforeEach } from "bun:test";
import { providerOptionsForPhase } from "./extendedThinkingWiring.ts";
import {
  _resetRecoveryStateForTests,
  resetFingerprintRecoveryState,
  tryRecover,
} from "./runtimeRecoveryWiring.ts";

describe("extendedThinkingWiring", () => {
  it("emits anthropic provider options for planning phase", () => {
    const opts = providerOptionsForPhase("planning", { maxTokens: 16_384 });
    expect("anthropic" in opts).toBe(true);
  });

  it("maps scan / ops / compaction to no-thinking", () => {
    expect(providerOptionsForPhase("scan")).toEqual({});
    expect(providerOptionsForPhase("ops")).toEqual({});
    expect(providerOptionsForPhase("compaction")).toEqual({});
  });

  it("respects overrideDepth", () => {
    const opts = providerOptionsForPhase("scan", {
      overrideDepth: "high",
      maxTokens: 32_000,
    });
    expect("anthropic" in opts).toBe(true);
  });

  it("returns {} when overrideDepth is off", () => {
    const opts = providerOptionsForPhase("planning", { overrideDepth: "off" });
    expect(opts).toEqual({});
  });
});

describe("runtimeRecoveryWiring", () => {
  beforeEach(() => {
    _resetRecoveryStateForTests();
  });

  it("escalates through Notify → Redirect → ForceStop on repeated detections", () => {
    const first = tryRecover({ fingerprint: "fp1", toolName: "get_chart" });
    expect(first.action).toBe("notify");
    const second = tryRecover({ fingerprint: "fp1", toolName: "get_chart" });
    expect(second.action).toBe("redirect");
    const third = tryRecover({ fingerprint: "fp1", toolName: "get_chart" });
    expect(third.action).toBe("force_stop");
  });

  it("safety-critical tools fast-track to force_stop on first detection", () => {
    const r = tryRecover({ fingerprint: "fp2", toolName: "place_order" });
    expect(r.action).toBe("force_stop");
  });

  it("resetFingerprintRecoveryState clears tier state", () => {
    tryRecover({ fingerprint: "fp3", toolName: "get_chart" });
    tryRecover({ fingerprint: "fp3", toolName: "get_chart" });
    resetFingerprintRecoveryState("fp3");
    const after = tryRecover({ fingerprint: "fp3", toolName: "get_chart" });
    expect(after.action).toBe("notify");
  });
});
