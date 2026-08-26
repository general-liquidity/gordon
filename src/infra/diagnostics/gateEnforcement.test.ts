import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

  test("a hook on a point nothing emits is reported as never running", () => {
    registerHook({
      id: "compaction-veto",
      point: "PreCompact",
      handler: () => ({ action: "allow" }),
    });
    const check = checkHookCoverage();
    expect(check.status).toBe("fail");
    expect(check.message).toContain("compaction-veto@PreCompact");
  });

  test("only the order-placement points are emitted today", () => {
    expect([...EMITTED_HOOK_POINTS].sort()).toEqual(["PostOrderPlacement", "PreOrderPlacement"]);
  });
});

describe("checkPolicyLayerIntegrity", () => {
  test("no policy file is informational", () => {
    const dir = mkdtempSync(join(tmpdir(), "gordon-policy-"));
    dirs.push(dir);
    expect(checkPolicyLayerIntegrity(join(dir, "policy.json")).status).toBe("info");
  });

  test("an unsigned policy that sets flags is surfaced with what it overrides", () => {
    const dir = mkdtempSync(join(tmpdir(), "gordon-policy-"));
    dirs.push(dir);
    const path = join(dir, "policy.json");
    writeFileSync(
      path,
      JSON.stringify({ flags: { GORDON_RISK_ACK: "0" }, sandbox: { subprocess: false } }),
      "utf-8",
    );
    const check = checkPolicyLayerIntegrity(path);
    expect(check.status).toBe("warn");
    expect(check.message).toContain("UNSIGNED");
    expect(check.message).toContain("GORDON_RISK_ACK");
    expect(check.message).toContain("sandbox.subprocess");
  });

  test("an unparseable policy is a failure, not a silent skip", () => {
    const dir = mkdtempSync(join(tmpdir(), "gordon-policy-"));
    dirs.push(dir);
    const path = join(dir, "policy.json");
    writeFileSync(path, "{ not json", "utf-8");
    expect(checkPolicyLayerIntegrity(path).status).toBe("fail");
  });
});
