import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  activateSessionPlan,
  deactivateSessionPlan,
  gateSessionPlan,
} from "../../../safety/wipSessionRegistry.ts";
import { WIP_FLAG_ENV } from "../../../safety/wipLimit.ts";

describe("WIP session registry integration", () => {
  const prev = process.env[WIP_FLAG_ENV];

  beforeEach(() => {
    process.env[WIP_FLAG_ENV] = "1";
    deactivateSessionPlan("wip_plan_a");
    deactivateSessionPlan("wip_plan_b");
  });

  afterEach(() => {
    if (prev === undefined) delete process.env[WIP_FLAG_ENV];
    else process.env[WIP_FLAG_ENV] = prev;
  });

  it("blocks second plan on same symbol when WIP enabled", () => {
    activateSessionPlan("wip_plan_a", "BTC/USD", "rsi");
    const gate = gateSessionPlan("BTC/USD", "ema");
    expect(gate.allowed).toBe(false);
  });

  it("deactivate frees the symbol slot", () => {
    activateSessionPlan("wip_plan_a", "BTC/USD", "rsi");
    expect(deactivateSessionPlan("wip_plan_a")).toBe(true);
    const gate = gateSessionPlan("BTC/USD", "ema");
    expect(gate.allowed).toBe(true);
  });
});
