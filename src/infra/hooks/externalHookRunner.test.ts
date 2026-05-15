import { describe, it, expect, beforeEach } from "bun:test";
import { mkdtempSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  isExternalHookRunnerEnabled,
  resolveHandlerPath,
  runExternalHook,
  runMetaToPayload,
  ExternalHandlerMissingError,
  EXTERNAL_HOOK_RUNNER_FLAG_ENV,
  type ExternalHookConfig,
} from "./externalHookRunner.ts";
import type { PreToolUsePayload } from "./types.ts";

let tempDir: string;

function writeScript(name: string, body: string): string {
  const path = join(tempDir, name);
  writeFileSync(path, body, { mode: 0o755 });
  if (process.platform !== "win32") chmodSync(path, 0o755);
  return path;
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "gordon-external-hook-test-"));
});

const sampleToolPayload: PreToolUsePayload = {
  toolName: "place_order",
  toolCallId: "call-1",
  args: { symbol: "BTC/USD", side: "buy", qty: 0.1 },
};

const baseConfig = (handlerPath: string): ExternalHookConfig<"PreToolUse"> => ({
  id: "test-hook",
  point: "PreToolUse",
  handlerPath,
});

describe("isExternalHookRunnerEnabled", () => {
  it("respects the flag", () => {
    expect(isExternalHookRunnerEnabled({})).toBe(false);
    expect(isExternalHookRunnerEnabled({ [EXTERNAL_HOOK_RUNNER_FLAG_ENV]: "1" })).toBe(true);
    expect(isExternalHookRunnerEnabled({ [EXTERNAL_HOOK_RUNNER_FLAG_ENV]: "true" })).toBe(true);
  });
});

describe("resolveHandlerPath", () => {
  it("returns absolute path when handler exists", () => {
    const path = writeScript("exists.sh", "#!/bin/sh\nexit 0\n");
    expect(resolveHandlerPath(path)).toBe(path);
  });

  it("throws ExternalHandlerMissingError when missing", () => {
    expect(() => resolveHandlerPath(join(tempDir, "missing.sh"))).toThrow(
      ExternalHandlerMissingError,
    );
  });
});

describe("runExternalHook — missing handler", () => {
  it("returns block with spawnFailed=true when handler is missing", async () => {
    const r = await runExternalHook(
      baseConfig(join(tempDir, "missing.sh")),
      sampleToolPayload,
    );
    expect(r.result.action).toBe("block");
    expect(r.meta.spawnFailed).toBe(true);
    expect(r.result.reason).toContain("not found");
  });
});

describe("runExternalHook — exit-code semantics", () => {
  // Cross-platform note: these tests use shell scripts on Unix. On Windows
  // we skip the executable tests (Bun supports `.cmd` but the test setup
  // is platform-specific). Mark these tests platform-gated.
  const skipOnWindows = process.platform === "win32";

  it.skipIf(skipOnWindows)("exit 0 → allow", async () => {
    const path = writeScript("allow.sh", "#!/bin/sh\nexit 0\n");
    const r = await runExternalHook(baseConfig(path), sampleToolPayload);
    expect(r.result.action).toBe("allow");
    expect(r.meta.exitCode).toBe(0);
  });

  it.skipIf(skipOnWindows)("exit 2 → block with stderr reason", async () => {
    const path = writeScript(
      "block.sh",
      "#!/bin/sh\necho 'protected path' >&2\nexit 2\n",
    );
    const r = await runExternalHook(baseConfig(path), sampleToolPayload);
    expect(r.result.action).toBe("block");
    expect(r.result.reason).toContain("protected path");
    expect(r.meta.exitCode).toBe(2);
  });

  it.skipIf(skipOnWindows)("exit 5 → block (fail-closed on unexpected code)", async () => {
    const path = writeScript(
      "weird.sh",
      "#!/bin/sh\necho 'something odd' >&2\nexit 5\n",
    );
    const r = await runExternalHook(baseConfig(path), sampleToolPayload);
    expect(r.result.action).toBe("block");
    expect(r.result.reason).toContain("something odd");
  });
});

describe("runExternalHook — JSON-on-stdout overrides exit code", () => {
  const skipOnWindows = process.platform === "win32";

  it.skipIf(skipOnWindows)("parses stdout JSON for action=modify", async () => {
    const path = writeScript(
      "modify.sh",
      `#!/bin/sh\necho '{"action":"modify","replacement":{"qty":0.05}}'\nexit 0\n`,
    );
    const r = await runExternalHook(baseConfig(path), sampleToolPayload);
    expect(r.result.action).toBe("modify");
    expect(r.result.replacement).toEqual({ qty: 0.05 });
    expect(r.meta.stdoutJsonParsed).toBe(true);
  });

  it.skipIf(skipOnWindows)("ignores invalid JSON on stdout and uses exit code", async () => {
    const path = writeScript("invalidjson.sh", "#!/bin/sh\necho 'not json'\nexit 0\n");
    const r = await runExternalHook(baseConfig(path), sampleToolPayload);
    expect(r.result.action).toBe("allow");
    expect(r.meta.stdoutJsonParsed).toBe(false);
  });

  it.skipIf(skipOnWindows)("preserves metadata field from stdout JSON", async () => {
    const path = writeScript(
      "meta.sh",
      `#!/bin/sh\necho '{"action":"allow","metadata":{"reviewedBy":"compliance"}}'\nexit 0\n`,
    );
    const r = await runExternalHook(baseConfig(path), sampleToolPayload);
    expect(r.result.metadata).toEqual({ reviewedBy: "compliance" });
  });
});

describe("runExternalHook — payload delivery", () => {
  const skipOnWindows = process.platform === "win32";

  it.skipIf(skipOnWindows)("delivers payload as JSON on stdin", async () => {
    const path = writeScript(
      "echo-payload.sh",
      `#!/bin/sh
cat > /tmp/gordon-hook-payload.json
exit 0
`,
    );
    await runExternalHook(baseConfig(path), sampleToolPayload);
    const written = require("node:fs").readFileSync("/tmp/gordon-hook-payload.json", "utf8");
    const parsed = JSON.parse(written);
    expect(parsed.point).toBe("PreToolUse");
    expect(parsed.payload.toolName).toBe("place_order");
  });
});

describe("runExternalHook — timeout", () => {
  const skipOnWindows = process.platform === "win32";

  it.skipIf(skipOnWindows)("kills handler that exceeds timeoutMs and blocks", async () => {
    const path = writeScript("slow.sh", "#!/bin/sh\nsleep 5\nexit 0\n");
    const r = await runExternalHook(
      { ...baseConfig(path), timeoutMs: 100 },
      sampleToolPayload,
    );
    expect(r.result.action).toBe("block");
    expect(r.meta.timedOut).toBe(true);
    expect(r.result.reason).toContain("timed out");
  });
});

describe("runExternalHook — args + env", () => {
  const skipOnWindows = process.platform === "win32";

  it.skipIf(skipOnWindows)("passes args to handler", async () => {
    const path = writeScript(
      "args.sh",
      `#!/bin/sh\nif [ "$1" = "--mode=strict" ]; then exit 0; else exit 2; fi\n`,
    );
    const r = await runExternalHook(
      { ...baseConfig(path), args: ["--mode=strict"] },
      sampleToolPayload,
    );
    expect(r.result.action).toBe("allow");
  });

  it.skipIf(skipOnWindows)("passes env vars to handler", async () => {
    const path = writeScript(
      "env.sh",
      `#!/bin/sh\nif [ "$GORDON_TEST_VAR" = "yes" ]; then exit 0; else echo "no env" >&2; exit 2; fi\n`,
    );
    const r = await runExternalHook(
      { ...baseConfig(path), env: { GORDON_TEST_VAR: "yes" } },
      sampleToolPayload,
    );
    expect(r.result.action).toBe("allow");
  });
});

describe("runMetaToPayload", () => {
  it("emits stable shape", () => {
    const config = baseConfig("/some/path");
    const meta = {
      exitCode: 0,
      durationMs: 42,
      stderr: "",
      stdoutJsonParsed: false,
      timedOut: false,
      spawnFailed: false,
    };
    const result = { action: "allow" as const };
    const p = runMetaToPayload(config, meta, result);
    expect(p.kind).toBe("external_hook.run_recorded");
    expect(p.action).toBe("allow");
    expect(p.point).toBe("PreToolUse");
  });
});

describe("Trading scenario — pre-order CPI-release check", () => {
  const skipOnWindows = process.platform === "win32";

  it.skipIf(skipOnWindows)("operator wires custom policy: block if it's CPI day", async () => {
    // External hook reads stdin, blocks all orders if env CPI_TODAY=1.
    const path = writeScript(
      "cpi-check.sh",
      `#!/bin/sh
read -r payload
if [ "$CPI_TODAY" = "1" ]; then
  echo "CPI release imminent — no orders allowed" >&2
  exit 2
fi
exit 0
`,
    );
    const blocked = await runExternalHook(
      { ...baseConfig(path), env: { CPI_TODAY: "1" } },
      sampleToolPayload,
    );
    expect(blocked.result.action).toBe("block");
    expect(blocked.result.reason).toContain("CPI release");

    const allowed = await runExternalHook(
      { ...baseConfig(path), env: { CPI_TODAY: "0" } },
      sampleToolPayload,
    );
    expect(allowed.result.action).toBe("allow");
  });
});
