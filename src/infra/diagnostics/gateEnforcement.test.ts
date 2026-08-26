import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkGateEnforcement,
  checkHookCoverage,
  checkPolicyLayerIntegrity,
  EMITTED_HOOK_POINTS,
  type GateDescriptor,
} from "./gateEnforcement.ts";
import { clearHooks, registerHook } from "../hooks/engine.ts";
import {
  POLICY_KEY_ENV,
  POLICY_PATH_ENV,
  writeSignedPolicy,
} from "../config/settingsSync/policySignature.ts";
import { HOOK_POINTS, type HookPoint } from "../hooks/types.ts";

const PRODUCTION_HOOK_BRIDGES = {
  PreToolUse: ["../agents/tools/wrappers/withMetrics.ts", 'runHooks("PreToolUse"'],
  PostToolUse: ["../agents/tools/wrappers/withMetrics.ts", 'runHooks("PostToolUse"'],
  PreCompact: ["../domain/memory/summarizer.ts", 'runHooks("PreCompact"'],
  PostCompact: ["../domain/memory/summarizer.ts", 'runHooks("PostCompact"'],
  SessionStart: ["../../runtime/session/SessionRuntime.ts", 'runHooks("SessionStart"'],
  Stop: ["../../runtime/session/SessionRuntime.ts", 'runHooks("Stop"'],
  UserPromptSubmit: ["../agents/orchestrator.ts", 'runHooks("UserPromptSubmit"'],
  SessionEnd: ["../../runtime/session/SessionRuntime.ts", 'runHooks("SessionEnd"'],
  PreApproval: ["../../runtime/permissions/PermissionEngine.ts", 'runHooks("PreApproval"'],
  PostApproval: ["../../runtime/permissions/PermissionEngine.ts", 'emitHook("PostApproval"'],
  PreOrderPlacement: ["../agents/tools/market/orderbook.ts", 'runHooks("PreOrderPlacement"'],
  PostOrderPlacement: ["../agents/tools/market/orderbook.ts", 'runHooks("PostOrderPlacement"'],
  SubagentStart: ["../hooks/subagentHookBridge.ts", 'runHooks("SubagentStart"'],
  SubagentStop: ["../hooks/subagentHookBridge.ts", 'runHooks("SubagentStop"'],
} as const satisfies Record<HookPoint, readonly [string, string]>;

const dirs: string[] = [];

afterEach(() => {
  clearHooks();
  for (const dir of dirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort temp cleanup
    }
  }
});

function gate(enabled: boolean, enforced: boolean): GateDescriptor {
  return {
    id: "gate.test",
    label: "Test gate",
    flag: "GORDON_TEST_GATE",
    enabled: () => enabled,
    enforced: () => enforced,
    remedy: "wire it",
  };
}

describe("checkGateEnforcement", () => {
  test("enabled + enforced passes", () => {
    expect(checkGateEnforcement([gate(true, true)])[0]!.status).toBe("pass");
  });

  test("enabled but NOT enforced fails as inert — the phantom-gate case", () => {
    const check = checkGateEnforcement([gate(true, false)])[0]!;
    expect(check.status).toBe("fail");
    expect(check.message).toContain("inert");
    expect(check.message).toContain("GORDON_TEST_GATE");
  });

  test("disabled reports info, not a failure", () => {
    expect(checkGateEnforcement([gate(false, false)])[0]!.status).toBe("info");
  });

  test("the external hook runner is reported inert when enabled", () => {
    const descriptor = { ...gate(true, false), id: "gate.external-hook-runner" };
    expect(checkGateEnforcement([descriptor])[0]!.status).toBe("fail");
  });
});

describe("checkHookCoverage", () => {
  beforeEach(() => clearHooks());

  test("a hook on an emitted point passes", () => {
    registerHook({
      id: "price-check",
      point: "PreOrderPlacement",
      handler: () => ({ action: "allow" }),
    });
    expect(checkHookCoverage().status).toBe("pass");
  });

  test("a hook is reported inert when the supplied coverage map omits its point", () => {
    registerHook({
      id: "compaction-veto",
      point: "PreCompact",
      handler: () => ({ action: "allow" }),
    });
    const check = checkHookCoverage(new Set(["PreOrderPlacement", "PostOrderPlacement"]));
    expect(check.status).toBe("fail");
    expect(check.message).toContain("compaction-veto@PreCompact");
  });

  test("all declared lifecycle points have a production bridge", () => {
    expect(EMITTED_HOOK_POINTS.size).toBe(14);
    expect(EMITTED_HOOK_POINTS.has("PreToolUse")).toBe(true);
    expect(EMITTED_HOOK_POINTS.has("SessionEnd")).toBe(true);
    expect(EMITTED_HOOK_POINTS.has("SubagentStop")).toBe(true);
    expect(Object.keys(PRODUCTION_HOOK_BRIDGES).sort()).toEqual([...HOOK_POINTS].sort());
    for (const point of HOOK_POINTS) {
      const [relativePath, token] = PRODUCTION_HOOK_BRIDGES[point];
      const source = readFileSync(new URL(relativePath, import.meta.url), "utf-8");
      expect(source, `${point} production bridge`).toContain(token);
    }
  });
});

describe("checkPolicyLayerIntegrity", () => {
  test("no policy file is informational", () => {
    const dir = mkdtempSync(join(tmpdir(), "gordon-policy-"));
    dirs.push(dir);
    expect(checkPolicyLayerIntegrity(join(dir, "policy.json")).status).toBe("info");
  });

  test("an unsigned policy is refused rather than trusted", () => {
    const dir = mkdtempSync(join(tmpdir(), "gordon-policy-"));
    dirs.push(dir);
    const path = join(dir, "policy.json");
    writeFileSync(
      path,
      JSON.stringify({ flags: { GORDON_RISK_ACK: "0" }, sandbox: { subprocess: false } }),
      "utf-8",
    );
    const check = checkPolicyLayerIntegrity(path);
    expect(check.status).toBe("fail");
    expect(check.message).toContain("REFUSED");
    expect(check.message).toContain("no_key");
    expect(check.message).toContain("signature cannot be verified");
  });

  test("a correctly signed policy passes the integrity diagnostic", () => {
    const dir = mkdtempSync(join(tmpdir(), "gordon-policy-"));
    dirs.push(dir);
    const path = join(dir, "policy.json");
    const key = "diagnostic-policy-key";
    const env = { ...process.env, [POLICY_PATH_ENV]: path, [POLICY_KEY_ENV]: key };
    writeSignedPolicy({ flags: { GORDON_RISK_ACK: "1" } }, key, { env });
    const check = checkPolicyLayerIntegrity(path, env);
    expect(check.status).toBe("pass");
    expect(check.message).toContain("signed and verified");
  });

  test("an unparseable policy is a failure, not a silent skip", () => {
    const dir = mkdtempSync(join(tmpdir(), "gordon-policy-"));
    dirs.push(dir);
    const path = join(dir, "policy.json");
    writeFileSync(path, "{ not json", "utf-8");
    expect(checkPolicyLayerIntegrity(path).status).toBe("fail");
  });
});
