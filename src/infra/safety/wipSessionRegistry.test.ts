import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import {
  activateSessionPlan,
  deactivateSessionPlan,
  gateSessionPlan,
  resetSessionWipRegistryForTesting,
  sessionWipSnapshot,
} from "./wipSessionRegistry.ts";
import { WIP_FLAG_ENV } from "./wipLimit.ts";

describe("wipSessionRegistry", () => {
  const prev = process.env[WIP_FLAG_ENV];

  beforeEach(() => {
    resetSessionWipRegistryForTesting();
    delete process.env[WIP_FLAG_ENV];
  });

  afterEach(() => {
    if (prev === undefined) delete process.env[WIP_FLAG_ENV];
    else process.env[WIP_FLAG_ENV] = prev;
  });

  it("passes through when WIP limit is explicitly disabled", () => {
    process.env[WIP_FLAG_ENV] = "0";
    const gate = gateSessionPlan("BTC/USD", "rsi");
    expect(gate.allowed).toBe(true);
    expect(gate.message).toBe("WIP limit disabled.");
  });

  it("gates by default (protective posture on out-of-box)", () => {
    activateSessionPlan("p0", "BTC/USD", "rsi");
    const gate = gateSessionPlan("BTC/USD", "macd");
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toBe("per-symbol");
  });

  it("blocks second active plan per symbol when enabled", () => {
    process.env[WIP_FLAG_ENV] = "1";
    activateSessionPlan("p1", "BTC/USD", "rsi");
    const gate = gateSessionPlan("BTC/USD", "macd");
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toBe("per-symbol");
  });

  it("allows next plan after deactivate", () => {
    process.env[WIP_FLAG_ENV] = "1";
    activateSessionPlan("p1", "BTC/USD", "rsi");
    expect(deactivateSessionPlan("p1")).toBe(true);
    const gate = gateSessionPlan("BTC/USD", "macd");
    expect(gate.allowed).toBe(true);
  });

  it("snapshot reports active plans", () => {
    process.env[WIP_FLAG_ENV] = "1";
    activateSessionPlan("p1", "ETH/USD", "x");
    const snap = sessionWipSnapshot();
    expect(snap.enabled).toBe(true);
    expect(snap.active).toHaveLength(1);
    expect(snap.active[0]?.planId).toBe("p1");
  });
});
