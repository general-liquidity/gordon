import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  isKillSwitchesEnabled,
  tripKillSwitch,
  resetKillSwitch,
  resetAllKillSwitches,
  reloadKillSwitchState,
  isExecutionAllowed,
  listTrippedSwitches,
  killSwitchesToPayload,
  KILL_SWITCHES_FLAG_ENV,
  KILL_SWITCH_STATE_PATH_ENV,
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
    expect(resetKillSwitch({ scope: "trader", id: "t1" }, "manual review complete")).toBe(true);
    expect(resetKillSwitch({ scope: "trader", id: "t1" }, "manual review complete")).toBe(false);
  });

  it("resetKillSwitch fails closed without a rationale", () => {
    tripKillSwitch({ scope: "trader", id: "t1" }, "x");
    expect(resetKillSwitch({ scope: "trader", id: "t1" })).toBe(false);
    expect(resetKillSwitch({ scope: "trader", id: "t1" }, "too short")).toBe(false);
    expect(isExecutionAllowed({ traderId: "t1" }).allowed).toBe(false);
  });

  it("resetAllKillSwitches clears everything", () => {
    tripKillSwitch({ scope: "firm" }, "x");
    tripKillSwitch({ scope: "venue", id: "binance" }, "y");
    resetAllKillSwitches();
    expect(listTrippedSwitches()).toEqual([]);
  });
});

describe("persistence", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "gordon-killswitch-"));
  const stateFile = join(tempDir, "kill-switches.json");

  beforeEach(() => {
    process.env[KILL_SWITCH_STATE_PATH_ENV] = stateFile;
    rmSync(stateFile, { force: true });
    reloadKillSwitchState();
  });

  afterEach(() => {
    rmSync(stateFile, { force: true });
    delete process.env[KILL_SWITCH_STATE_PATH_ENV];
    reloadKillSwitchState();
  });

  it("a tripped switch survives a simulated restart and still blocks", () => {
    tripKillSwitch({ scope: "firm" }, "incident under investigation");
    expect(existsSync(stateFile)).toBe(true);

    // Simulated restart: state reloaded from disk.
    reloadKillSwitchState();

    const decision = isExecutionAllowed({ strategyId: "any" });
    expect(decision.allowed).toBe(false);
    expect(decision.blockingKeys[0]!.key.scope).toBe("firm");
    expect(decision.blockingKeys[0]!.reason).toBe("incident under investigation");
  });

  it("reset without a rationale fails closed and the trip persists", () => {
    tripKillSwitch({ scope: "firm" }, "incident");
    expect(resetKillSwitch({ scope: "firm" })).toBe(false);

    reloadKillSwitchState();
    expect(isExecutionAllowed({}).allowed).toBe(false);
  });

  it("reset with a rationale clears the trip durably", () => {
    tripKillSwitch({ scope: "venue", id: "binance" }, "venue degraded");
    expect(resetKillSwitch({ scope: "venue", id: "binance" }, "venue recovered, latency normal")).toBe(true);

    reloadKillSwitchState();
    expect(isExecutionAllowed({ venue: "binance" }).allowed).toBe(true);
  });

  it("resetAllKillSwitches requires a rationale while persistence is active", () => {
    tripKillSwitch({ scope: "firm" }, "incident");
    resetAllKillSwitches();
    expect(listTrippedSwitches().length).toBe(1);

    resetAllKillSwitches("incident resolved after operator review");
    expect(listTrippedSwitches()).toEqual([]);

    reloadKillSwitchState();
    expect(isExecutionAllowed({}).allowed).toBe(true);
  });

  it("fails closed with a firm-wide trip when the state file is unreadable", () => {
    writeFileSync(stateFile, "{ not valid json");
    reloadKillSwitchState();

    const decision = isExecutionAllowed({});
    expect(decision.allowed).toBe(false);
    expect(decision.blockingKeys[0]!.key.scope).toBe("firm");
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
