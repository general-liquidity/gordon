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
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resetFlagCache } from "../config/flagResolver.ts";
import { isFilesystemWriteGuardEnabled, getGuardMode } from "./filesystemWriteGuard.ts";
import { isNetworkAllowlistEnabled, getAllowlistMode } from "./networkAllowlist.ts";
import { isKillSwitchesEnabled } from "./killSwitches.ts";
import { isCleanStateGateEnabled } from "./cleanStateGate.ts";
import { isPlanRubricEnabled } from "./planRubric.ts";
import { isSafetyConfigGuardEnabled } from "./safetyConfigGuard.ts";
import { isSprintContractEnabled } from "./sprintContract.ts";
import { isRiskAckEnabled, verifyAcksFromWarnings } from "./anti-trap/riskAcknowledgement.ts";
import { getInjectionRate } from "./anti-trap/supervisionRust.ts";
import { isExplainFirstEnabled } from "./anti-trap/explainFirstMode.ts";
import { isLocalFallbackEnabled } from "./anti-trap/localFallback.ts";
import { isStrategyMandatesEnabled } from "./anti-rot/strategyMandates.ts";
import { isCoherenceEnabled } from "./anti-rot/thesisCoherence.ts";
import { isUniverseEnabled } from "./anti-rot/tradingUniverse.ts";
import { isExternalHookRunnerEnabled } from "../hooks/externalHookRunner.ts";

const prevCwd = process.cwd();
const dirs: string[] = [];
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
  "GORDON_SUPERVISION_RUST_RATE",
  "GORDON_EXPLAIN_FIRST",
  "GORDON_LOCAL_FALLBACK",
  "GORDON_STRATEGY_MANDATES",
  "GORDON_THESIS_COHERENCE",
  "GORDON_TRADING_UNIVERSE",
  "GORDON_EXTERNAL_HOOK_RUNNER",
];

/** Write a project-layer settings.json holding only the given flags. */
function settingsLayerOnly(flags: Record<string, string>): void {
  const dir = mkdtempSync(join(tmpdir(), "gordon-splitpath-"));
  dirs.push(dir);
  mkdirSync(join(dir, ".gordon"), { recursive: true });
  writeFileSync(join(dir, ".gordon", "settings.json"), JSON.stringify({ flags }), "utf-8");
  process.chdir(dir);
  resetFlagCache();
}

beforeEach(() => {
  for (const name of TOUCHED) delete process.env[name];
  process.chdir(prevCwd);
  resetFlagCache();
});

afterAll(() => {
  for (const name of TOUCHED) delete process.env[name];
  process.chdir(prevCwd);
  resetFlagCache();
  for (const dir of dirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort temp cleanup
    }
  }
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

  test("GORDON_SUPERVISION_RUST_RATE", () => {
    settingsLayerOnly({ GORDON_SUPERVISION_RUST_RATE: "0.25" });
    expect(getInjectionRate()).toBe(0.25);
  });

  test("GORDON_EXPLAIN_FIRST", () => {
    settingsLayerOnly({ GORDON_EXPLAIN_FIRST: "1" });
    expect(isExplainFirstEnabled()).toBe(true);
  });

  test("GORDON_LOCAL_FALLBACK", () => {
    settingsLayerOnly({ GORDON_LOCAL_FALLBACK: "1" });
    expect(isLocalFallbackEnabled()).toBe(true);
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
