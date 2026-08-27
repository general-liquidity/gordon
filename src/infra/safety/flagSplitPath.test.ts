/**
 * Split-path regression: a flag set through the flags UI must reach the gate.
 *
 * `/flags set` (and `manage_flags` action='set') persists to the settings
 * layer, which only `flagResolver` reads. A gate whose reader defaults to raw
 * `process.env` therefore reports ON in the UI while never firing after a
 * restart, when the value lives in settings.json and not in the shell.
 *
 * Each case here writes ONLY the settings layer, with the env var explicitly
 * unset, and asserts the gate observes it. Before the readers were unified on
 * `flagEnv()` every one of these returned the default.
 */

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { resetFlagCache } from "../config/flagResolver.ts";
import { setSessionOverride, clearSessionOverrides } from "../config/settingsLayers.ts";
import { isFilesystemWriteGuardEnabled, getGuardMode } from "./filesystemWriteGuard.ts";
import { isNetworkAllowlistEnabled, getAllowlistMode } from "./networkAllowlist.ts";
import { isKillSwitchesEnabled } from "./killSwitches.ts";
import { isCleanStateGateEnabled } from "./cleanStateGate.ts";
import { isPlanRubricEnabled } from "./planRubric.ts";
import { isSafetyConfigGuardEnabled } from "./safetyConfigGuard.ts";
import { isSprintContractEnabled } from "./sprintContract.ts";
import { isRiskAckEnabled, verifyAcksFromWarnings } from "./anti-trap/riskAcknowledgement.ts";
import { isExplainFirstEnabled } from "./anti-trap/explainFirstMode.ts";
import { isStrategyMandatesEnabled } from "./anti-rot/strategyMandates.ts";
import { isCoherenceEnabled } from "./anti-rot/thesisCoherence.ts";
import { isUniverseEnabled } from "./anti-rot/tradingUniverse.ts";
import { isExternalHookRunnerEnabled } from "../hooks/externalHookRunner.ts";

const prevCwd = process.cwd();
const TOUCHED = [
  "GORDON_FILESYSTEM_WRITE_GUARD",
  "GORDON_FILESYSTEM_WRITE_GUARD_MODE",
  "GORDON_NETWORK_ALLOWLIST",
  "GORDON_NETWORK_ALLOWLIST_MODE",
  "GORDON_KILL_SWITCHES",
  "GORDON_CLEAN_STATE_GATE",
  "GORDON_PLAN_RUBRIC",
  "GORDON_SAFETY_CONFIG_GUARD",
  "GORDON_SPRINT_CONTRACT",
  "GORDON_RISK_ACK",
  "GORDON_EXPLAIN_FIRST",
  "GORDON_STRATEGY_MANDATES",
  "GORDON_THESIS_COHERENCE",
  "GORDON_TRADING_UNIVERSE",
  "GORDON_EXTERNAL_HOOK_RUNNER",
];

/**
 * Publish the given flags through the settings store, with env unset.
 *
 * The session layer rather than a project-layer `.gordon/settings.json`: these
 * gates are safety-critical, and `flagResolver` deliberately refuses to source
 * those from the project layer, because a cloned repository can ship that file
 * and would otherwise govern the halt it is subject to. `/flags set` persists
 * to the operator's own home-directory settings, which is a trusted layer like
 * this one, so the split-path bug under test is reproduced faithfully.
 */
function settingsLayerOnly(flags: Record<string, string>): void {
  setSessionOverride("flags", flags);
  resetFlagCache();
}

beforeEach(() => {
  for (const name of TOUCHED) delete process.env[name];
  process.chdir(prevCwd);
  clearSessionOverrides();
  resetFlagCache();
});

afterAll(() => {
  for (const name of TOUCHED) delete process.env[name];
  process.chdir(prevCwd);
  clearSessionOverrides();
  resetFlagCache();
});

describe("settings-layer flags reach their gate", () => {
  test("GORDON_FILESYSTEM_WRITE_GUARD_MODE", () => {
    settingsLayerOnly({ GORDON_FILESYSTEM_WRITE_GUARD_MODE: "block" });
    expect(getGuardMode()).toBe("block");
    expect(isFilesystemWriteGuardEnabled()).toBe(true);
  });

  test("GORDON_FILESYSTEM_WRITE_GUARD off switch", () => {
    settingsLayerOnly({ GORDON_FILESYSTEM_WRITE_GUARD: "0" });
    expect(isFilesystemWriteGuardEnabled()).toBe(false);
  });

  test("GORDON_NETWORK_ALLOWLIST_MODE", () => {
    settingsLayerOnly({ GORDON_NETWORK_ALLOWLIST_MODE: "block" });
    expect(getAllowlistMode()).toBe("block");
    expect(isNetworkAllowlistEnabled()).toBe(true);
  });

  test("GORDON_KILL_SWITCHES off switch", () => {
    settingsLayerOnly({ GORDON_KILL_SWITCHES: "0" });
    expect(isKillSwitchesEnabled()).toBe(false);
  });

  test("GORDON_CLEAN_STATE_GATE", () => {
    settingsLayerOnly({ GORDON_CLEAN_STATE_GATE: "0" });
    expect(isCleanStateGateEnabled()).toBe(false);
  });

  test("GORDON_PLAN_RUBRIC", () => {
    settingsLayerOnly({ GORDON_PLAN_RUBRIC: "0" });
    expect(isPlanRubricEnabled()).toBe(false);
  });

  test("GORDON_SAFETY_CONFIG_GUARD", () => {
    settingsLayerOnly({ GORDON_SAFETY_CONFIG_GUARD: "1" });
    expect(isSafetyConfigGuardEnabled()).toBe(true);
  });

  test("GORDON_SPRINT_CONTRACT", () => {
    settingsLayerOnly({ GORDON_SPRINT_CONTRACT: "1" });
    expect(isSprintContractEnabled()).toBe(true);
  });

  test("GORDON_RISK_ACK reaches both acknowledgement entry points", () => {
    settingsLayerOnly({ GORDON_RISK_ACK: "1" });
    expect(isRiskAckEnabled()).toBe(true);
    // verifyAcksFromWarnings had its own raw-process.env default, so the gate
    // stayed off while isRiskAckEnabled reported on.
    const result = verifyAcksFromWarnings([], ["leverage above mandate"]);
    expect(result.ok).toBe(false);
  });

  test("GORDON_EXPLAIN_FIRST", () => {
    settingsLayerOnly({ GORDON_EXPLAIN_FIRST: "1" });
    expect(isExplainFirstEnabled()).toBe(true);
  });

  test("GORDON_STRATEGY_MANDATES", () => {
    settingsLayerOnly({ GORDON_STRATEGY_MANDATES: "1" });
    expect(isStrategyMandatesEnabled()).toBe(true);
  });

  test("GORDON_THESIS_COHERENCE", () => {
    settingsLayerOnly({ GORDON_THESIS_COHERENCE: "1" });
    expect(isCoherenceEnabled()).toBe(true);
  });

  test("GORDON_TRADING_UNIVERSE", () => {
    settingsLayerOnly({ GORDON_TRADING_UNIVERSE: "1" });
    expect(isUniverseEnabled()).toBe(true);
  });

  test("GORDON_EXTERNAL_HOOK_RUNNER", () => {
    settingsLayerOnly({ GORDON_EXTERNAL_HOOK_RUNNER: "1" });
    expect(isExternalHookRunnerEnabled()).toBe(true);
  });

  test("an explicit env var still wins over the settings layer", () => {
    settingsLayerOnly({ GORDON_RISK_ACK: "1" });
    process.env.GORDON_RISK_ACK = "0";
    expect(isRiskAckEnabled()).toBe(false);
  });
});
