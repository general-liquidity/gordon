/**
 * Flag resolver precedence: env override > settings.json (flags) > default.
 *
 * The settings fallback is exercised through the real layered store by writing
 * a project-layer `.gordon/settings.json` under a temp cwd — no stubbing of the
 * loader, so the test also proves the `flags` section wires through the merge.
 */

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveFlag, flagEnv, resetFlagCache } from "./flagResolver.ts";

const FLAG = "GORDON_FLAGRESOLVER_TEST";
const prevCwd = process.cwd();
const dirs: string[] = [];

function useTempProjectSettings(flags: Record<string, string>): void {
  const dir = mkdtempSync(join(tmpdir(), "gordon-flagres-"));
  dirs.push(dir);
  mkdirSync(join(dir, ".gordon"), { recursive: true });
  writeFileSync(join(dir, ".gordon", "settings.json"), JSON.stringify({ flags }, null, 2), "utf-8");
  process.chdir(dir);
  resetFlagCache();
}

beforeEach(() => {
  delete process.env[FLAG];
  process.chdir(prevCwd);
  resetFlagCache();
});

afterAll(() => {
  delete process.env[FLAG];
  process.chdir(prevCwd);
  for (const dir of dirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort temp cleanup
    }
  }
});

describe("resolveFlag precedence", () => {
  test("returns undefined when neither env nor settings define the flag", () => {
    expect(resolveFlag(FLAG)).toBeUndefined();
  });

  test("settings.json flags provide the value when env is unset", () => {
    useTempProjectSettings({ [FLAG]: "from-settings" });
    expect(resolveFlag(FLAG)).toBe("from-settings");
  });

  test("explicit env override wins over settings.json", () => {
    useTempProjectSettings({ [FLAG]: "from-settings" });
    process.env[FLAG] = "from-env";
    expect(resolveFlag(FLAG)).toBe("from-env");
  });

  test("env override wins even for an empty-string env value", () => {
    useTempProjectSettings({ [FLAG]: "from-settings" });
    process.env[FLAG] = "";
    // An explicitly-set empty env var is still an override (defined), so the
    // settings fallback must NOT leak through.
    expect(resolveFlag(FLAG)).toBe("");
  });
});

describe("flagEnv proxy", () => {
  test("indexing reads through the resolver (settings fallback)", () => {
    useTempProjectSettings({ [FLAG]: "proxied" });
    const env = flagEnv();
    expect(env[FLAG]).toBe("proxied");
  });

  test("indexing honors the env override", () => {
    useTempProjectSettings({ [FLAG]: "proxied" });
    process.env[FLAG] = "env-wins";
    const env = flagEnv();
    expect(env[FLAG]).toBe("env-wins");
  });

  test("unrelated process.env keys still pass through the proxy", () => {
    process.env.PATH = process.env.PATH ?? "";
    const env = flagEnv();
    expect(env.PATH).toBe(process.env.PATH);
  });
});

describe("safety-critical flags are not settable from the project layer", () => {
  // A repository can ship `<cwd>/.gordon/settings.json`. Cloning one must not
  // be able to disable the firm-wide halt or widen the risk kernel.
  const KILL = "GORDON_KILL_SWITCHES";
  const LEVERAGE = "GORDON_RISK_MAX_LEVERAGE";

  beforeEach(() => {
    delete process.env[KILL];
    delete process.env[LEVERAGE];
  });

  test("a repo-carried kill-switch disable does not resolve", () => {
    useTempProjectSettings({ [KILL]: "0" });
    expect(resolveFlag(KILL)).toBeUndefined();
    expect(flagEnv()[KILL]).toBeUndefined();
  });

  test("a repo-carried risk-limit widening does not resolve", () => {
    useTempProjectSettings({ [LEVERAGE]: "100" });
    expect(resolveFlag(LEVERAGE)).toBeUndefined();
  });

  test("the operator's own env still governs the same flags", () => {
    useTempProjectSettings({ [KILL]: "0" });
    process.env[KILL] = "0";
    expect(resolveFlag(KILL)).toBe("0");
  });

  test("non-safety flags still resolve from the project layer", () => {
    useTempProjectSettings({ [KILL]: "0", [FLAG]: "from-settings" });
    expect(resolveFlag(FLAG)).toBe("from-settings");
    expect(resolveFlag(KILL)).toBeUndefined();
  });
});
