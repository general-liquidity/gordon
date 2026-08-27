import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { clearHooks, listHooks, runHooks } from "./engine.ts";
import {
  EXTERNAL_HOOKS_PATH_ENV,
  getExternalHookInstallerState,
  installExternalHooks,
  loadExternalHookConfig,
  resetExternalHooksForTests,
} from "./externalHookRegistry.ts";
import { EXTERNAL_HOOK_RUNNER_FLAG_ENV } from "./externalHookRunner.ts";

const dirs: string[] = [];

function tempFile(name: string, contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), "gordon-hook-registry-"));
  dirs.push(dir);
  const path = join(dir, name);
  writeFileSync(path, contents, "utf-8");
  return path;
}

afterEach(() => {
  resetExternalHooksForTests();
  clearHooks();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("loadExternalHookConfig", () => {
  test("accepts the documented object form", () => {
    const path = tempFile(
      "hooks.json",
      JSON.stringify({
        hooks: [{ id: "audit", point: "PostToolUse", handlerPath: process.execPath }],
      }),
    );
    expect(loadExternalHookConfig(path)).toHaveLength(1);
  });

  test("rejects duplicate ids and unknown points", () => {
    const duplicate = tempFile(
      "duplicate.json",
      JSON.stringify([
        { id: "x", point: "Stop", handlerPath: process.execPath },
        { id: "x", point: "Stop", handlerPath: process.execPath },
      ]),
    );
    expect(() => loadExternalHookConfig(duplicate)).toThrow("Duplicate");
    const unknown = tempFile(
      "unknown.json",
      JSON.stringify([{ id: "x", point: "Imaginary", handlerPath: process.execPath }]),
    );
    expect(() => loadExternalHookConfig(unknown)).toThrow("supported lifecycle");
  });

  test("rejects a non-positive timeout before any handler is registered", () => {
    const path = tempFile(
      "timeout.json",
      JSON.stringify({
        hooks: [
          {
            id: "no-deadline",
            point: "PreToolUse",
            handlerPath: process.execPath,
            timeoutMs: 0,
          },
        ],
      }),
    );
    expect(() => loadExternalHookConfig(path)).toThrow("timeoutMs must be greater than zero");
  });

  test("rejects an enabled policy plane with no hooks", () => {
    const path = tempFile("empty.json", JSON.stringify({ hooks: [] }));
    expect(() => loadExternalHookConfig(path)).toThrow("declares no hooks");
  });
});

describe("installExternalHooks", () => {
  test("enabled runner installs and dispatches configured hooks", async () => {
    const handler = tempFile(
      "handler.mjs",
      "process.stdout.write(JSON.stringify({action:'block',reason:'operator policy'}));",
    );
    const config = tempFile(
      "hooks.json",
      JSON.stringify({
        hooks: [
          {
            id: "operator-stop",
            point: "Stop",
            handlerPath: process.execPath,
            args: [handler],
          },
        ],
      }),
    );
    const env = {
      [EXTERNAL_HOOK_RUNNER_FLAG_ENV]: "1",
      [EXTERNAL_HOOKS_PATH_ENV]: config,
    };
    expect(installExternalHooks(env).installed).toBe(true);
    expect(getExternalHookInstallerState().hookCount).toBe(1);
    expect(listHooks("Stop").map((hook) => hook.id)).toEqual(["operator-stop"]);
    const result = await runHooks("Stop", { reason: "graceful", sessionId: "s1" });
    expect(result.action).toBe("block");
    expect(result.reason).toContain("operator policy");
  });

  test("enabled runner fails closed when config is missing", () => {
    const missing = join(tmpdir(), `missing-hooks-${crypto.randomUUID()}.json`);
    expect(() =>
      installExternalHooks({
        [EXTERNAL_HOOK_RUNNER_FLAG_ENV]: "1",
        [EXTERNAL_HOOKS_PATH_ENV]: missing,
      }),
    ).toThrow("were not installed");
    expect(getExternalHookInstallerState().installed).toBe(false);
  });

  test("enabled runner fails closed at startup when a handler is missing", () => {
    const config = tempFile(
      "hooks.json",
      JSON.stringify({
        hooks: [
          {
            id: "missing-handler",
            point: "PreToolUse",
            handlerPath: "./does-not-exist",
          },
        ],
      }),
    );
    expect(() =>
      installExternalHooks({
        [EXTERNAL_HOOK_RUNNER_FLAG_ENV]: "1",
        [EXTERNAL_HOOKS_PATH_ENV]: config,
      }),
    ).toThrow(/handler not found/);
    expect(getExternalHookInstallerState().installed).toBe(false);
    expect(listHooks()).toHaveLength(0);
  });

  test("disabled runner remains uninstalled", () => {
    expect(installExternalHooks({}).installed).toBe(false);
  });
});
