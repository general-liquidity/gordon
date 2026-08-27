/**
 * Completeness guard for the `/flags` registry.
 *
 * A safety gate the operator cannot see is a gate the operator cannot reason
 * about. The scan covers the safety tree plus the hook runner and risk-kernel
 * config, including private and aggregate readers rather than only exported
 * `is*Enabled` helpers.
 *
 * The scan is deliberately structural: it finds `is*Enabled` readers, takes
 * each reader's body, and resolves the GORDON_ flags it touches either as
 * literals or through the module's own `const X_ENV = "GORDON_..."` bindings.
 */

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { KEEPER_FLAGS } from "./system.ts";
import { clearSessionOverrides, setSessionOverride } from "../../../../config/settingsLayers.ts";
import { flagEnv, resetFlagCache } from "../../../../config/flagResolver.ts";
import { isExternalHookRunnerEnabled } from "../../../../hooks/externalHookRunner.ts";
import { isProcessHardeningEnabled } from "../../../../safety/processHardening.ts";
import {
  applyProductionEnvDefaults,
  DISABLE_GUARDS_ENV,
  GUARDS_MODE_ENV,
} from "../../../../safety/installProductionGuards.ts";
import { loadConfigFromEnv } from "../../../../../core/risk-kernel/config.ts";

const SAFETY_DIR = join(import.meta.dir, "../../../../safety");
const EXTERNAL_HOOK_RUNNER = join(import.meta.dir, "../../../../hooks/externalHookRunner.ts");
const RISK_CONFIG = join(import.meta.dir, "../../../../../core/risk-kernel/config.ts");
const SRC_DIR = join(import.meta.dir, "../../../../../");
const INVENTORY_ONLY_FILES = new Set([
  join(import.meta.dir, "system.ts"),
  join(import.meta.dir, "../../../../config/safetyCriticalFlags.ts"),
  join(import.meta.dir, "../../../../config/flagResolver.ts"),
]);

/** Not toggles: file locations and enum-valued modes are configuration. */
function isToggleName(flag: string): boolean {
  return !flag.endsWith("_PATH") && !flag.endsWith("_MODE") && !flag.endsWith("_URL");
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

/** Body of a function starting at `open`, matched by brace depth. */
function functionBody(source: string, open: number): string {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  return source.slice(open);
}

interface ReaderFlag {
  file: string;
  reader: string;
  flag: string;
}

function readerFlags(): ReaderFlag[] {
  const found: ReaderFlag[] = [];
  for (const file of [...sourceFiles(SAFETY_DIR), EXTERNAL_HOOK_RUNNER]) {
    const source = readFileSync(file, "utf8");

    const constants = new Map<string, string>();
    for (const match of source.matchAll(
      /(?:const|let)\s+([A-Za-z0-9_]+)\s*(?::[^=]+)?=\s*"(GORDON_[A-Z0-9_]+)"/g,
    )) {
      constants.set(match[1] as string, match[2] as string);
    }

    for (const match of source.matchAll(
      /(?:export\s+)?function ((?:is[A-Za-z0-9]*Enabled)|applyProductionEnvDefaults)\s*\(/g,
    )) {
      const brace = source.indexOf("{", match.index + match[0].length);
      if (brace === -1) continue;
      const body = functionBody(source, brace);

      const flags = new Set<string>();
      for (const literal of body.matchAll(/GORDON_[A-Z0-9_]+/g)) flags.add(literal[0]);
      for (const indexed of body.matchAll(/\[\s*([A-Za-z0-9_]+)\s*\]/g)) {
        const resolved = constants.get(indexed[1] as string);
        if (resolved) flags.add(resolved);
      }
      for (const flag of flags) {
        if (isToggleName(flag)) {
          found.push({ file, reader: match[1] as string, flag });
        }
      }
    }
  }

  const riskSource = readFileSync(RISK_CONFIG, "utf8");
  for (const match of riskSource.matchAll(/parseEnvBool\(env\.(GORDON_[A-Z0-9_]+)\)/g)) {
    found.push({ file: RISK_CONFIG, reader: "loadConfigFromEnv", flag: match[1] as string });
  }
  return found;
}

function uncommentedProductionSource(): string {
  return sourceFiles(SRC_DIR)
    .filter(
      (file) =>
        !file.endsWith(".test.ts") && file !== import.meta.path && !INVENTORY_ONLY_FILES.has(file),
    )
    .map((file) => readFileSync(file, "utf8"))
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

describe("the /flags registry covers every safety gate", () => {
  const discovered = readerFlags();

  test("the scan actually finds the safety readers", () => {
    // Guards the regexes: an empty or tiny result would make the assertion
    // below pass without checking anything.
    expect(discovered.length).toBeGreaterThanOrEqual(15);
    expect(new Set(discovered.map((d) => d.reader)).size).toBeGreaterThanOrEqual(15);
    expect(discovered.map((d) => d.flag)).toContain("GORDON_KILL_SWITCHES");
    expect(discovered.map((d) => d.flag)).toContain("GORDON_ABSORBING_BARRIER");
    expect(discovered.map((d) => d.flag)).toContain("GORDON_EXTERNAL_HOOK_RUNNER");
    expect(discovered.map((d) => d.flag)).toContain("GORDON_PROCESS_HARDENING");
    expect(discovered.map((d) => d.flag)).toContain("GORDON_RISK_AUTO_ADJUST");
    expect(discovered.map((d) => d.flag)).toContain("GORDON_RISK_REQUIRE_APPROVAL");
    expect(discovered.map((d) => d.flag)).toContain("GORDON_DISABLE_GUARDS");
    expect(discovered.map((d) => d.flag)).toContain("GORDON_GUARDS");
  });

  test("every flag a safety reader gates on is listed in /flags", () => {
    const registered = new Set<string>(KEEPER_FLAGS.map((f) => f.name));
    const missing = discovered
      .filter((d) => !registered.has(d.flag))
      .map((d) => `${d.flag} (${d.reader})`);

    expect([...new Set(missing)]).toEqual([]);
  });

  test("registry rows are unique and named GORDON_*", () => {
    const names = KEEPER_FLAGS.map((f) => f.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name.startsWith("GORDON_")).toBe(true);
  });

  test("every registry row is referenced by production code outside the registry", () => {
    const production = uncommentedProductionSource();
    const unreachable = KEEPER_FLAGS.map((flag) => flag.name).filter(
      (name) => !production.includes(name),
    );
    expect(unreachable).toEqual([]);
  });
});

describe("registry defaults match their readers", () => {
  /**
   * The rows that must read default-ON, because their reader treats an unset
   * value as enabled (`raw !== "0" && raw !== "false"`). Declaring these off
   * told the operator a protective gate was inactive while it was running.
   */
  const DEFAULT_ON = [
    "GORDON_WIP_LIMIT_ENABLED",
    "GORDON_STREAK_CIRCUIT_BREAKER",
    "GORDON_GIVE_BACK_STOP",
    "GORDON_ABSORBING_BARRIER",
    "GORDON_KILL_SWITCHES",
    "GORDON_NETWORK_ALLOWLIST",
    "GORDON_FILESYSTEM_WRITE_GUARD",
    "GORDON_TOOL_FREE_THINKING",
    "GORDON_ADVERSARIAL_EVALUATOR",
    "GORDON_CITATION_AGENT",
    "GORDON_AUTODREAM_ENABLED",
    "GORDON_REFLECTION_ENABLED",
    "GORDON_RISK_AUTO_ADJUST",
    "GORDON_RISK_REQUIRE_APPROVAL",
    "GORDON_GUARDS",
  ];

  for (const name of DEFAULT_ON) {
    test(`${name} is declared default-on`, () => {
      const row = KEEPER_FLAGS.find((f) => f.name === name);
      expect(row?.defaultOn).toBe(true);
    });
  }

  test("GORDON_PEER_DELEGATION is declared default-off, matching its reader", () => {
    const row = KEEPER_FLAGS.find((f) => f.name === "GORDON_PEER_DELEGATION");
    expect(row?.defaultOn).toBe(false);
  });
});

describe("settings-backed operator gates reach their production readers", () => {
  function settingsFlags(flags: Record<string, string>): void {
    clearSessionOverrides();
    setSessionOverride("flags", flags);
    resetFlagCache();
  }

  test("external hooks and process hardening read /flags state", () => {
    settingsFlags({ GORDON_EXTERNAL_HOOK_RUNNER: "1", GORDON_PROCESS_HARDENING: "true" });
    expect(isExternalHookRunnerEnabled()).toBe(true);
    expect(isProcessHardeningEnabled()).toBe(true);
    clearSessionOverrides();
    resetFlagCache();
  });

  test("risk adjustment and approval policy read /flags state", () => {
    settingsFlags({ GORDON_RISK_AUTO_ADJUST: "0", GORDON_RISK_REQUIRE_APPROVAL: "false" });
    const config = loadConfigFromEnv();
    expect(config.autoAdjustSize).toBe(false);
    expect(config.requireApproval).toBe(false);
    clearSessionOverrides();
    resetFlagCache();
  });

  test("aggregate guard mode and disable controls read /flags state", () => {
    settingsFlags({ [GUARDS_MODE_ENV]: "warn" });
    const warnEnv: NodeJS.ProcessEnv = {};
    applyProductionEnvDefaults(warnEnv, flagEnv());
    expect(warnEnv.GORDON_NETWORK_ALLOWLIST_MODE).toBe("warn");
    expect(warnEnv.GORDON_FILESYSTEM_WRITE_GUARD_MODE).toBe("warn");

    settingsFlags({ [DISABLE_GUARDS_ENV]: "1" });
    const disabledEnv: NodeJS.ProcessEnv = {};
    applyProductionEnvDefaults(disabledEnv, flagEnv());
    expect(disabledEnv.GORDON_NETWORK_ALLOWLIST).toBe("0");
    expect(disabledEnv.GORDON_FILESYSTEM_WRITE_GUARD).toBe("0");
    clearSessionOverrides();
    resetFlagCache();
  });
});
