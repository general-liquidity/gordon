/**
 * Gate-enforcement self-check.
 *
 * Generalizes the lens the doctor already applied to two guards ("enabled but
 * NOT installed — the policy is inert"). A safety toggle has two independent
 * halves: the operator turning it ON, and enforcement actually being reachable
 * at runtime. When those disagree the operator believes they are protected and
 * is not, which is strictly worse than having no toggle at all.
 *
 * Each entry declares both halves so the disagreement becomes a doctor
 * finding instead of a silent assumption. Only gates whose enforcement leaves
 * an observable runtime signal belong here — a gate is listed with an honest
 * `enforced` probe or it is not listed.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DiagnosticCheck } from "./doctor.ts";
import { GORDON_DIR } from "../storage/paths.ts";
import { isFilesystemWriteGuardEnabled } from "../safety/filesystemWriteGuard.ts";
import { isFilesystemWriteGuardInstalled } from "../safety/filesystemWriteGuardInstaller.ts";
import { isNetworkAllowlistEnabled } from "../safety/networkAllowlist.ts";
import { isOutboundFetchGuardInstalled } from "../safety/outboundFetchGuard.ts";
import { isExternalHookRunnerEnabled } from "../hooks/externalHookRunner.ts";
import { listHooks } from "../hooks/engine.ts";
import type { HookPoint } from "../hooks/types.ts";

export interface GateDescriptor {
  id: string;
  label: string;
  /** Operator-facing flag that turns the gate on. */
  flag: string;
  /** Does the operator believe this is on? */
  enabled: () => boolean;
  /** Is enforcement actually reachable in this process? */
  enforced: () => boolean;
  /** What the operator has to do about an inert gate. */
  remedy: string;
}

/**
 * Hook points that a production call site actually emits. Everything else in
 * `HookPoint` is declared but unreachable, so a hook registered there never
 * runs. `PreToolUse` has an emit site in infra/permissions/racing.ts but only
 * inside `racePermissionDecision`, which no production caller invokes.
 */
export const EMITTED_HOOK_POINTS: ReadonlySet<HookPoint> = new Set<HookPoint>([
  "PreOrderPlacement",
  "PostOrderPlacement",
]);

export const DEFAULT_GATES: readonly GateDescriptor[] = [
  {
    id: "gate.filesystem-write-guard",
    label: "Filesystem write guard",
    flag: "GORDON_FILESYSTEM_WRITE_GUARD",
    enabled: () => isFilesystemWriteGuardEnabled(),
    enforced: () => isFilesystemWriteGuardInstalled().installed,
    remedy: "installProductionGuards() should run at process entry (src/index.tsx).",
  },
  {
    id: "gate.network-allowlist",
    label: "Outbound fetch guard",
    flag: "GORDON_NETWORK_ALLOWLIST",
    enabled: () => isNetworkAllowlistEnabled(),
    enforced: () => isOutboundFetchGuardInstalled().installed,
    remedy: "installProductionGuards() should run at process entry (src/index.tsx).",
  },
  {
    id: "gate.external-hook-runner",
    label: "External hook runner",
    flag: "GORDON_EXTERNAL_HOOK_RUNNER",
    enabled: () => isExternalHookRunnerEnabled(),
    // infra/hooks/externalHookRunner.ts is imported by nothing but its own
    // test: no code loads external hook configs or dispatches to it. Setting
    // the flag changes nothing today, and saying so is the whole point.
    enforced: () => false,
    remedy:
      "No caller wires externalHookRunner.ts — external hook handlers are never dispatched. Unset the flag or wire the runner.",
  },
];

export function checkGateEnforcement(
  gates: readonly GateDescriptor[] = DEFAULT_GATES,
): DiagnosticCheck[] {
  return gates.map((gate) => {
    if (!gate.enabled()) {
      return {
        id: gate.id,
        label: gate.label,
        status: "info" as const,
        message: `Disabled via ${gate.flag}.`,
      };
    }
    if (!gate.enforced()) {
      return {
        id: gate.id,
        label: gate.label,
        status: "fail" as const,
        message: `${gate.flag} is on but enforcement is not installed — the policy is inert. ${gate.remedy}`,
      };
    }
    return {
      id: gate.id,
      label: gate.label,
      status: "pass" as const,
      message: `${gate.flag} is on and enforcement is installed.`,
    };
  });
}

/**
 * `~/.gordon/policy.json` is the highest-precedence PERSISTENT settings layer:
 * it outranks the local layer that `/flags set` writes to, so anything in it
 * silently overrides what the operator sets through the UI. It carries no
 * signature (unlike the `synced` layer, which is HMAC-verified) and sits
 * inside the filesystem write guard's own allowlist, so any code that can
 * write `~/.gordon` can rewrite the "organization policy" that feeds both the
 * flag resolver and the subprocess-sandbox toggle.
 *
 * There is no signing scheme for this layer today, so the honest thing is to
 * make its presence and reach visible rather than imply it is trusted.
 */
export function checkPolicyLayerIntegrity(
  policyPath: string = join(GORDON_DIR, "policy.json"),
): DiagnosticCheck {
  const id = "gate.policy-layer";
  const label = "Organization policy layer";
  if (!existsSync(policyPath)) {
    return { id, label, status: "info", message: `No policy layer at ${policyPath}.` };
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(readFileSync(policyPath, "utf-8")) as Record<string, unknown>;
  } catch {
    return {
      id,
      label,
      status: "fail",
      message: `${policyPath} is unparseable — it is silently ignored, so any policy it was meant to carry is not applied.`,
    };
  }
  const overridden: string[] = [];
  const flags = parsed.flags;
  if (flags && typeof flags === "object" && !Array.isArray(flags)) {
    overridden.push(...Object.keys(flags as Record<string, unknown>));
  }
  if (parsed.sandbox) overridden.push("sandbox.subprocess");
  if (overridden.length === 0) {
    return {
      id,
      label,
      status: "warn",
      message: `${policyPath} exists and outranks the local settings layer, but is unsigned. It sets no flags today.`,
    };
  }
  return {
    id,
    label,
    status: "warn",
    message: `${policyPath} is UNSIGNED yet outranks the layer /flags writes to, and it overrides: ${overridden.join(", ")}. Anything able to write ~/.gordon can change these.`,
  };
}

/**
 * Registered hooks attached to a point nothing emits. Such a hook looks
 * installed to every caller of `listHooks` and never runs.
 */
export function checkHookCoverage(
  emitted: ReadonlySet<HookPoint> = EMITTED_HOOK_POINTS,
): DiagnosticCheck {
  const inert = listHooks()
    .filter((h) => !emitted.has(h.point))
    .map((h) => `${h.id}@${h.point}`);
  if (inert.length === 0) {
    return {
      id: "gate.hook-coverage",
      label: "Hook coverage",
      status: "pass",
      message: "Every registered hook is attached to a point that is actually emitted.",
    };
  }
  return {
    id: "gate.hook-coverage",
    label: "Hook coverage",
    status: "fail",
    message: `Registered at hook points nothing emits, so they never run: ${inert.join(", ")}. Emitted points: ${[...emitted].join(", ")}.`,
  };
}
