import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as racing from "./racing.ts";
import * as permissions from "./index.ts";
import { registerHook, clearHooks, runHooks } from "../hooks/engine.ts";
import { quickPermissionCheck } from "./racing.ts";
import type { PermissionRule } from "./rules.ts";

describe("permission racing removal", () => {
  test("racePermissionDecision is gone from the module and the barrel", () => {
    // It had no production caller, and Gordon's approval flow is not a race:
    // the dialog renders from `stillPending` after the kernel loop finishes,
    // so there was never a concurrent dialog to cancel.
    expect(Object.keys(racing)).not.toContain("racePermissionDecision");
    expect(Object.keys(permissions)).not.toContain("racePermissionDecision");
  });

  test("the module no longer emits any hook point", () => {
    const src = readFileSync(join(import.meta.dir, "racing.ts"), "utf-8");
    expect(src).not.toContain("runHooks(");
  });

  test("quickPermissionCheck still short-circuits on a matching rule", () => {
    const rules: PermissionRule[] = [
      { id: "r1", source: "session", toolPattern: "get_*", behavior: "allow", priority: 0 },
    ];
    expect(quickPermissionCheck(rules, "get_portfolio", {})?.decision).toBe("allow");
    expect(quickPermissionCheck(rules, "place_order", {})).toBeNull();
  });
});

describe("the permission fast path does not emit PreToolUse", () => {
  test("a registered PreToolUse hook only runs if something emits it", async () => {
    clearHooks();
    let fired = 0;
    registerHook({
      id: "pretooluse-probe",
      point: "PreToolUse",
      handler: async () => {
        fired += 1;
        return { action: "allow" };
      },
    });
    // PreToolUse is emitted by the tool wrapper (withMetrics.ts), not here.
    quickPermissionCheck([], "place_order", {});
    expect(fired).toBe(0);
    // The engine itself still works; a point with no emit site at all is what
    // `checkHookCoverage` in diagnostics/gateEnforcement.ts reports.
    await runHooks("PreToolUse", { toolName: "place_order", toolCallId: "1", args: {} });
    expect(fired).toBe(1);
    clearHooks();
  });
});
