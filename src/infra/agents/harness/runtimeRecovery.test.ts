import { describe, it, expect } from "bun:test";
import { decideRecovery, newRecoveryState, shouldHalt } from "./runtimeRecovery.ts";

describe("decideRecovery", () => {
  it("first detection of a fresh fingerprint → notify", () => {
    const r = decideRecovery({
      state: newRecoveryState(),
      fingerprint: "get_chart:btc",
      toolName: "get_chart",
    });
    expect(r.action).toBe("notify");
    expect(r.state.consecutive).toBe(1);
    expect(r.state.fingerprint).toBe("get_chart:btc");
    expect(r.reminder).toBeUndefined();
  });

  it("second detection of the same fingerprint → redirect with reminder", () => {
    const s = decideRecovery({
      state: newRecoveryState(),
      fingerprint: "fp",
      toolName: "get_chart",
    }).state;
    const r = decideRecovery({
      state: s,
      fingerprint: "fp",
      toolName: "get_chart",
    });
    expect(r.action).toBe("redirect");
    expect(r.reminder).toBeDefined();
    expect(r.reminder).toContain("GORDON_LOOP_BREAK");
    expect(r.reminder).toContain("get_chart");
    expect(r.state.consecutive).toBe(2);
  });

  it("third detection → force_stop", () => {
    let s = newRecoveryState();
    for (let i = 0; i < 2; i++) {
      s = decideRecovery({ state: s, fingerprint: "fp", toolName: "get_chart" }).state;
    }
    const r = decideRecovery({ state: s, fingerprint: "fp", toolName: "get_chart" });
    expect(r.action).toBe("force_stop");
    expect(r.reason).toContain("3 detections");
  });

  it("new fingerprint resets the counter", () => {
    let s = decideRecovery({
      state: newRecoveryState(),
      fingerprint: "fp1",
      toolName: "get_chart",
    }).state;
    s = decideRecovery({ state: s, fingerprint: "fp1", toolName: "get_chart" }).state;
    // Now switch to a new fingerprint
    const r = decideRecovery({ state: s, fingerprint: "fp2", toolName: "get_chart" });
    expect(r.action).toBe("notify");
    expect(r.state.consecutive).toBe(1);
    expect(r.state.fingerprint).toBe("fp2");
  });

  it("safety-critical tool fast-tracks force_stop on first detection", () => {
    const r = decideRecovery({
      state: newRecoveryState(),
      fingerprint: "place_order:btc",
      toolName: "place_order",
    });
    expect(r.action).toBe("force_stop");
    expect(r.reason).toContain("Safety-critical");
  });

  it("safety-critical fast-track applies regardless of prior history", () => {
    const s = decideRecovery({
      state: newRecoveryState(),
      fingerprint: "x",
      toolName: "get_chart",
    }).state;
    // Switch to a critical tool — should halt immediately even though state
    // counter shows only 1 prior detection.
    const r = decideRecovery({
      state: s,
      fingerprint: "execute_trade:eth",
      toolName: "execute_trade",
    });
    expect(r.action).toBe("force_stop");
  });

  it("decision carries lastAction for idempotency", () => {
    const r = decideRecovery({
      state: newRecoveryState(),
      fingerprint: "fp",
      toolName: "get_chart",
    });
    expect(r.state.lastAction).toBe("notify");
  });

  it("reason includes details when provided", () => {
    const r = decideRecovery({
      state: newRecoveryState(),
      fingerprint: "fp",
      toolName: "get_chart",
      details: "same args 3x in 30s",
    });
    expect(r.reason).toContain("same args 3x in 30s");
  });
});

describe("shouldHalt", () => {
  it("returns true only on force_stop", () => {
    const stopDecision = decideRecovery({
      state: { consecutive: 2, fingerprint: "fp" },
      fingerprint: "fp",
      toolName: "get_chart",
    });
    expect(shouldHalt(stopDecision)).toBe(true);
  });

  it("returns false on notify and redirect", () => {
    const notify = decideRecovery({
      state: newRecoveryState(),
      fingerprint: "fp",
      toolName: "get_chart",
    });
    expect(shouldHalt(notify)).toBe(false);
    const redirect = decideRecovery({
      state: notify.state,
      fingerprint: "fp",
      toolName: "get_chart",
    });
    expect(shouldHalt(redirect)).toBe(false);
  });
});
