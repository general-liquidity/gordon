import { describe, it, expect, beforeEach } from "bun:test";

import {
  isKillSwitchesEnabled,
  tripKillSwitch,
  resetKillSwitch,
  resetAllKillSwitches,
  isExecutionAllowed,
  listTrippedSwitches,
  killSwitchesToPayload,
  KILL_SWITCHES_FLAG_ENV,
} from "./killSwitches.ts";

beforeEach(() => {
  resetAllKillSwitches();
});

describe("isKillSwitchesEnabled", () => {
  it("defaults on and supports explicit disable", () => {
    expect(isKillSwitchesEnabled({})).toBe(true);
    expect(isKillSwitchesEnabled({ [KILL_SWITCHES_FLAG_ENV]: "1" })).toBe(true);
    expect(isKillSwitchesEnabled({ [KILL_SWITCHES_FLAG_ENV]: "0" })).toBe(false);
    expect(isKillSwitchesEnabled({ [KILL_SWITCHES_FLAG_ENV]: "false" })).toBe(false);
  });
});

describe("kill switch trip + check", () => {
  it("no trips → execution allowed", () => {
    const r = isExecutionAllowed({ strategyId: "s1", venue: "binance" });
    expect(r.allowed).toBe(true);
    expect(r.blockingKeys).toEqual([]);
  });

  it("strategy-level trip blocks that strategy's execution", () => {
    tripKillSwitch({ scope: "strategy", id: "s1" }, "manual review");
    const r = isExecutionAllowed({ strategyId: "s1" });
    expect(r.allowed).toBe(false);
    expect(r.blockingKeys[0]!.key.scope).toBe("strategy");
  });

  it("strategy trip doesn't affect other strategies", () => {
    tripKillSwitch({ scope: "strategy", id: "s1" }, "x");
    expect(isExecutionAllowed({ strategyId: "s2" }).allowed).toBe(true);
  });

  it("firm-wide trip blocks everything", () => {
    tripKillSwitch({ scope: "firm" }, "system-wide halt");
    expect(isExecutionAllowed({ strategyId: "any", venue: "any" }).allowed).toBe(false);
  });
});

describe("multi-scope blocking", () => {
  it("multiple trips report all blocking keys", () => {
    tripKillSwitch({ scope: "strategy", id: "s1" }, "x");
    tripKillSwitch({ scope: "venue", id: "binance" }, "y");
    const r = isExecutionAllowed({ strategyId: "s1", venue: "binance" });
    expect(r.allowed).toBe(false);
    expect(r.blockingKeys.length).toBe(2);
  });

  it("scope hierarchy: venue trip blocks all strategies on that venue", () => {
    tripKillSwitch({ scope: "venue", id: "binance" }, "venue degraded");
    expect(isExecutionAllowed({ strategyId: "a", venue: "binance" }).allowed).toBe(false);
    expect(isExecutionAllowed({ strategyId: "b", venue: "binance" }).allowed).toBe(false);
    expect(isExecutionAllowed({ strategyId: "a", venue: "coinbase" }).allowed).toBe(true);
  });
});

describe("reset operations", () => {
  it("resetKillSwitch returns true when something was tripped", () => {
    tripKillSwitch({ scope: "trader", id: "t1" }, "x");
    expect(resetKillSwitch({ scope: "trader", id: "t1" })).toBe(true);
    expect(resetKillSwitch({ scope: "trader", id: "t1" })).toBe(false);
  });

  it("resetAllKillSwitches clears everything", () => {
    tripKillSwitch({ scope: "firm" }, "x");
    tripKillSwitch({ scope: "venue", id: "binance" }, "y");
    resetAllKillSwitches();
    expect(listTrippedSwitches()).toEqual([]);
  });
});

describe("listTrippedSwitches", () => {
  it("returns all trips in trip-order", () => {
    tripKillSwitch({ scope: "trader", id: "t1" }, "a", 1000);
    tripKillSwitch({ scope: "venue", id: "binance" }, "b", 2000);
    tripKillSwitch({ scope: "firm" }, "c", 500);
    const list = listTrippedSwitches();
    expect(list.length).toBe(3);
    expect(list[0]!.trippedAt).toBe(500);
    expect(list[2]!.trippedAt).toBe(2000);
  });
});

describe("killSwitchesToPayload", () => {
  it("emits stable shape", () => {
    tripKillSwitch({ scope: "firm" }, "x");
    const d = isExecutionAllowed({});
    const p = killSwitchesToPayload(d) as { kind: string; allowed: boolean };
    expect(p.kind).toBe("kill_switches.evaluated");
    expect(p.allowed).toBe(false);
  });
});
