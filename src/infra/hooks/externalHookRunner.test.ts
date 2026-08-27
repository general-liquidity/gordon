import { afterEach, describe, it, expect, beforeEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
  writeFileSync(path, body, "utf-8");
  return path;
}

function portableConfig(body: string): ExternalHookConfig<"PreToolUse"> {
  const script = writeScript(`handler-${crypto.randomUUID()}.mjs`, body);
  return { ...baseConfig(process.execPath), args: [script] };
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "gordon-external-hook-test-"));
});

afterEach(() => rmSync(tempDir, { recursive: true, force: true }));

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
    const r = await runExternalHook(baseConfig(join(tempDir, "missing.sh")), sampleToolPayload);
    expect(r.result.action).toBe("block");
    expect(r.meta.spawnFailed).toBe(true);
    expect(r.result.reason).toContain("not found");
  });
});

describe("runExternalHook — exit-code semantics", () => {
  it("exit 0 → allow", async () => {
    const r = await runExternalHook(portableConfig("process.exit(0);"), sampleToolPayload);
    expect(r.result.action).toBe("allow");
    expect(r.meta.exitCode).toBe(0);
  });

  it("exit 2 → block with stderr reason", async () => {
    const r = await runExternalHook(
      portableConfig("console.error('protected path'); process.exit(2);"),
      sampleToolPayload,
    );
    expect(r.result.action).toBe("block");
    expect(r.result.reason).toContain("protected path");
    expect(r.meta.exitCode).toBe(2);
  });

  it("exit 5 → block (fail-closed on unexpected code)", async () => {
    const r = await runExternalHook(
      portableConfig("console.error('something odd'); process.exit(5);"),
      sampleToolPayload,
    );
    expect(r.result.action).toBe("block");
    expect(r.result.reason).toContain("something odd");
  });
});

describe("runExternalHook — JSON-on-stdout overrides exit code", () => {
  it("parses stdout JSON for action=modify", async () => {
    const r = await runExternalHook(
      portableConfig(
        "process.stdout.write(JSON.stringify({action:'modify',replacement:{qty:0.05}}));",
      ),
      sampleToolPayload,
    );
    expect(r.result.action).toBe("modify");
    expect(r.result.replacement).toEqual({ qty: 0.05 });
    expect(r.meta.stdoutJsonParsed).toBe(true);
  });

  it("ignores invalid JSON on stdout and uses exit code", async () => {
    const r = await runExternalHook(
      portableConfig("process.stdout.write('not json');"),
      sampleToolPayload,
    );
    expect(r.result.action).toBe("allow");
    expect(r.meta.stdoutJsonParsed).toBe(false);
  });

  it("preserves metadata field from stdout JSON", async () => {
    const r = await runExternalHook(
      portableConfig(
        "process.stdout.write(JSON.stringify({action:'allow',metadata:{reviewedBy:'compliance'}}));",
      ),
      sampleToolPayload,
    );
    expect(r.result.metadata).toEqual({ reviewedBy: "compliance" });
  });
});

describe("runExternalHook — a handler that never reads stdin", () => {
  // A handler is free to ignore its input. When it exits without reading, the
  // payload write races the closing pipe and EPIPE arrives asynchronously, past
  // any try/catch around the write. That error used to reach the child's error
  // handler and turn a successful exit 0 into a spawn failure, which is a block.
  // A large payload widens the race enough to catch a regression: this failed
  // reliably before the stdin error listener and passes with it.
  it("reports exit 0 as allow even under a large payload", async () => {
    const config = portableConfig("process.exit(0);");
    const bulky = {
      ...sampleToolPayload,
      filler: "x".repeat(1_000_000),
    } as unknown as typeof sampleToolPayload;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const r = await runExternalHook(config, bulky);
      expect(r.result.action).toBe("allow");
      expect(r.meta.spawnFailed).toBeFalsy();
      expect(r.meta.exitCode).toBe(0);
    }
  });
});

describe("runExternalHook — payload delivery", () => {
  it("delivers payload as JSON on stdin", async () => {
    const output = join(tempDir, "payload.json");
    const config = portableConfig(
      "let data=''; for await (const c of process.stdin) data += c; await Bun.write(process.env.OUT, data);",
    );
    config.env = { OUT: output };
    await runExternalHook(config, sampleToolPayload);
    const written = require("node:fs").readFileSync(output, "utf8");
    const parsed = JSON.parse(written);
    expect(parsed.point).toBe("PreToolUse");
    expect(parsed.payload.toolName).toBe("place_order");
  });
});

describe("runExternalHook — timeout", () => {
  it("kills handler that exceeds timeoutMs and blocks", async () => {
    const r = await runExternalHook(
      { ...portableConfig("await new Promise(r => setTimeout(r, 5000));"), timeoutMs: 100 },
      sampleToolPayload,
    );
    expect(r.result.action).toBe("block");
    expect(r.meta.timedOut).toBe(true);
    expect(r.result.reason).toContain("timed out");
  });

  it("does not let an early JSON allow override a later timeout", async () => {
    const r = await runExternalHook(
      {
        ...portableConfig(
          "process.stdout.write(JSON.stringify({action:'allow'})); await new Promise(r => setTimeout(r, 5000));",
        ),
        timeoutMs: 100,
      },
      sampleToolPayload,
    );
    expect(r.result.action).toBe("block");
    expect(r.meta.timedOut).toBe(true);
    expect(r.meta.stdoutJsonParsed).toBe(false);
  });
});

describe("runExternalHook — bounded output", () => {
  it("kills and blocks a handler whose output exceeds the process budget", async () => {
    const r = await runExternalHook(
      portableConfig(
        "process.stdout.write('x'.repeat(70_000)); await new Promise(r => setTimeout(r, 5000));",
      ),
      sampleToolPayload,
    );
    expect(r.result.action).toBe("block");
    expect(r.meta.outputLimitExceeded).toBe(true);
    expect(r.result.reason).toContain("output exceeded");
  });

  it("refuses a non-positive direct-call timeout", async () => {
    const r = await runExternalHook(
      { ...portableConfig("process.exit(0);"), timeoutMs: 0 },
      sampleToolPayload,
    );
    expect(r.result.action).toBe("block");
    expect(r.meta.spawnFailed).toBe(true);
    expect(r.result.reason).toContain("timeoutMs");
  });
});

describe("runExternalHook — args + env", () => {
  it("passes args to handler", async () => {
    const config = portableConfig("process.exit(process.argv.includes('--mode=strict') ? 0 : 2);");
    const r = await runExternalHook(
      { ...config, args: [...(config.args ?? []), "--mode=strict"] },
      sampleToolPayload,
    );
    expect(r.result.action).toBe("allow");
  });

  it("passes env vars to handler", async () => {
    const r = await runExternalHook(
      {
        ...portableConfig("process.exit(process.env.GORDON_TEST_VAR === 'yes' ? 0 : 2);"),
        env: { GORDON_TEST_VAR: "yes" },
      },
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
      outputLimitExceeded: false,
    };
    const result = { action: "allow" as const };
    const p = runMetaToPayload(config, meta, result);
    expect(p.kind).toBe("external_hook.run_recorded");
    expect(p.action).toBe("allow");
    expect(p.point).toBe("PreToolUse");
  });
});

describe("Trading scenario — pre-order CPI-release check", () => {
  it("operator wires custom policy: block if it's CPI day", async () => {
    // External hook reads stdin, blocks all orders if env CPI_TODAY=1.
    const config = portableConfig(
      "if(process.env.CPI_TODAY==='1'){console.error('CPI release imminent — no orders allowed');process.exit(2)}",
    );
    const blocked = await runExternalHook(
      { ...config, env: { CPI_TODAY: "1" } },
      sampleToolPayload,
    );
    expect(blocked.result.action).toBe("block");
    expect(blocked.result.reason).toContain("CPI release");

    const allowed = await runExternalHook(
      { ...config, env: { CPI_TODAY: "0" } },
      sampleToolPayload,
    );
    expect(allowed.result.action).toBe("allow");
  });
});
