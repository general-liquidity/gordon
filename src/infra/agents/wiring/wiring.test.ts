import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  isExtendedThinkingEnabled,
  providerOptionsForPhase,
} from "./extendedThinkingWiring.ts";
import {
  _resetRecoveryStateForTests,
  isRecoveryTiersEnabled,
  resetFingerprintRecoveryState,
  tryRecover,
} from "./runtimeRecoveryWiring.ts";
import {
  _resetDeferralWiringForTests,
  activateDeferred,
  filterBundleForDeferral,
  snapshotDeferral,
} from "./toolDeferralWiring.ts";

function withEnv(name: string, value: string | undefined, fn: () => void): void {
  const prev = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  try {
    fn();
  } finally {
    if (prev === undefined) delete process.env[name];
    else process.env[name] = prev;
  }
}

describe("extendedThinkingWiring", () => {
  it("returns {} when flag is off", () => {
    withEnv("GORDON_EXTENDED_THINKING", "off", () => {
      expect(isExtendedThinkingEnabled()).toBe(false);
      expect(providerOptionsForPhase("planning")).toEqual({});
    });
  });

  it("emits anthropic provider options for planning phase when enabled", () => {
    withEnv("GORDON_EXTENDED_THINKING", "1", () => {
      const opts = providerOptionsForPhase("planning", { maxTokens: 16_384 });
      expect("anthropic" in opts).toBe(true);
    });
  });

  it("maps scan / ops / compaction to no-thinking even when enabled", () => {
    withEnv("GORDON_EXTENDED_THINKING", "1", () => {
      expect(providerOptionsForPhase("scan")).toEqual({});
      expect(providerOptionsForPhase("ops")).toEqual({});
      expect(providerOptionsForPhase("compaction")).toEqual({});
    });
  });

  it("respects overrideDepth", () => {
    withEnv("GORDON_EXTENDED_THINKING", "1", () => {
      const opts = providerOptionsForPhase("scan", {
        overrideDepth: "high",
        maxTokens: 32_000,
      });
      expect("anthropic" in opts).toBe(true);
    });
  });
});

describe("runtimeRecoveryWiring", () => {
  beforeEach(() => {
    _resetRecoveryStateForTests();
  });

  it("returns null when flag is off", () => {
    withEnv("GORDON_RECOVERY_TIERS", undefined, () => {
      expect(isRecoveryTiersEnabled()).toBe(false);
      expect(tryRecover({ fingerprint: "x", toolName: "get_chart" })).toBeNull();
    });
  });

  it("escalates through Notify → Redirect → ForceStop on repeated detections", () => {
    withEnv("GORDON_RECOVERY_TIERS", "1", () => {
      const first = tryRecover({ fingerprint: "fp1", toolName: "get_chart" })!;
      expect(first.action).toBe("notify");
      const second = tryRecover({ fingerprint: "fp1", toolName: "get_chart" })!;
      expect(second.action).toBe("redirect");
      const third = tryRecover({ fingerprint: "fp1", toolName: "get_chart" })!;
      expect(third.action).toBe("force_stop");
    });
  });

  it("safety-critical tools fast-track to force_stop on first detection", () => {
    withEnv("GORDON_RECOVERY_TIERS", "1", () => {
      const r = tryRecover({ fingerprint: "fp2", toolName: "place_order" })!;
      expect(r.action).toBe("force_stop");
    });
  });

  it("resetFingerprintRecoveryState clears tier state", () => {
    withEnv("GORDON_RECOVERY_TIERS", "1", () => {
      tryRecover({ fingerprint: "fp3", toolName: "get_chart" });
      tryRecover({ fingerprint: "fp3", toolName: "get_chart" });
      resetFingerprintRecoveryState("fp3");
      const after = tryRecover({ fingerprint: "fp3", toolName: "get_chart" })!;
      expect(after.action).toBe("notify");
    });
  });
});

describe("toolDeferralWiring", () => {
  beforeEach(() => {
    _resetDeferralWiringForTests();
  });

  it("returns bundle unchanged when flag is off", () => {
    withEnv("GORDON_TOOL_DEFERRAL", undefined, () => {
      const bundle = {
        get_price: { id: "get_price" },
        unknown_tool: { id: "unknown_tool" },
      };
      expect(filterBundleForDeferral(bundle)).toEqual(bundle);
    });
  });

  it("filters out deferred tools when flag is on", () => {
    withEnv("GORDON_TOOL_DEFERRAL", "1", () => {
      const bundle = {
        get_price: { id: "get_price" }, // core
        scan_market: { id: "scan_market" }, // core
        uniswap_pool: { id: "uniswap_pool" }, // deferred
        solana_balance: { id: "solana_balance" }, // deferred
      };
      const filtered = filterBundleForDeferral(bundle);
      expect("get_price" in filtered).toBe(true);
      expect("scan_market" in filtered).toBe(true);
      expect("uniswap_pool" in filtered).toBe(false);
      expect("solana_balance" in filtered).toBe(false);
    });
  });

  it("activateDeferred surfaces a deferred tool", () => {
    withEnv("GORDON_TOOL_DEFERRAL", "1", () => {
      const bundle = {
        get_price: { id: "get_price" },
        uniswap_pool: { id: "uniswap_pool" },
      };
      // Seed registry by filtering once.
      filterBundleForDeferral(bundle);
      activateDeferred("uniswap_pool");
      const filtered = filterBundleForDeferral(bundle);
      expect("uniswap_pool" in filtered).toBe(true);
    });
  });

  it("snapshotDeferral reports counts when enabled", () => {
    withEnv("GORDON_TOOL_DEFERRAL", "1", () => {
      filterBundleForDeferral({
        get_price: { id: "get_price" },
        scan_market: { id: "scan_market" },
        uniswap_pool: { id: "uniswap_pool" },
        cdp_webhook: { id: "cdp_webhook" },
      });
      const snap = snapshotDeferral();
      expect(snap.enabled).toBe(true);
      expect(snap.coreCount).toBeGreaterThan(0);
      expect(snap.deferredCount).toBeGreaterThan(0);
    });
  });

  it("snapshotDeferral reports disabled state when flag is off", () => {
    withEnv("GORDON_TOOL_DEFERRAL", undefined, () => {
      const snap = snapshotDeferral();
      expect(snap.enabled).toBe(false);
    });
  });
});
