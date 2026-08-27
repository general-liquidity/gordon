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

import type { DiagnosticCheck } from "./doctor.ts";
import { isFilesystemWriteGuardEnabled } from "../safety/filesystemWriteGuard.ts";
import { isFilesystemWriteGuardInstalled } from "../safety/filesystemWriteGuardInstaller.ts";
import { isNetworkAllowlistEnabled } from "../safety/networkAllowlist.ts";
import { isOutboundFetchGuardInstalled } from "../safety/outboundFetchGuard.ts";
import { isExternalHookRunnerEnabled } from "../hooks/externalHookRunner.ts";
import { getExternalHookInstallerState } from "../hooks/externalHookRegistry.ts";
import { listHooks } from "../hooks/engine.ts";
import { HOOK_POINTS, type HookPoint } from "../hooks/types.ts";
import {
  inspectPolicyLayer,
  policyPath as resolvePolicyPath,
  POLICY_PATH_ENV,
} from "../config/settingsSync/policySignature.ts";

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
 * Production emit site per hook point: [module path relative to this file, the
 * emit call that module must contain]. This table, NOT `HOOK_POINTS`, is what
 * "emitted" means. A point declared in `HOOK_POINTS` with no entry here is
 * inert and {@link checkHookCoverage} fails on it — deriving the set from the
 * declarations instead would make the check unable to fail. `gateEnforcement.test.ts`
 * reads each module and asserts the token is present, so an entry cannot
 * outlive the call site it names.
 */
export const PRODUCTION_HOOK_BRIDGES: Partial<Record<HookPoint, readonly [string, string]>> = {
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
};

export const EMITTED_HOOK_POINTS: ReadonlySet<HookPoint> = new Set(
  Object.keys(PRODUCTION_HOOK_BRIDGES) as HookPoint[],
);

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
    enforced: () => getExternalHookInstallerState().installed,
    remedy: "Set GORDON_EXTERNAL_HOOKS_PATH to a valid hooks JSON file and restart Gordon.",
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

export function checkPolicyLayerIntegrity(
  path: string = resolvePolicyPath(),
  env: NodeJS.ProcessEnv = process.env,
): DiagnosticCheck {
  const id = "gate.policy-layer";
  const label = "Organization policy layer";
  const state = inspectPolicyLayer({ ...env, [POLICY_PATH_ENV]: path });
  if (state.state === "absent") {
    return { id, label, status: "info", message: `No policy layer at ${path}.` };
  }
  if (state.state === "refused") {
    return {
      id,
      label,
      status: "fail",
      message: `${path} is REFUSED and not applied (${state.reason}): ${state.detail}.`,
    };
  }
  return {
    id,
    label,
    status: "pass",
    message: `${path} is signed and verified (origin ${state.origin}, ${state.keys.length} top-level keys).`,
  };
}

/**
 * Two ways a hook point stops meaning anything: a point is declared and never
 * emitted, or a hook is registered on a point nothing emits. Both look
 * installed to every caller of `listHooks` and never run.
 */
export function checkHookCoverage(
  emitted: ReadonlySet<HookPoint> = EMITTED_HOOK_POINTS,
  declared: readonly HookPoint[] = HOOK_POINTS,
): DiagnosticCheck {
  const unemitted = declared.filter((point) => !emitted.has(point));
  const inert = listHooks()
    .filter((h) => !emitted.has(h.point))
    .map((h) => `${h.id}@${h.point}`);
  if (unemitted.length === 0 && inert.length === 0) {
    return {
      id: "gate.hook-coverage",
      label: "Hook coverage",
      status: "pass",
      message:
        "Every declared hook point is emitted, and every registered hook is attached to one.",
    };
  }
  const problems: string[] = [];
  if (unemitted.length > 0) {
    problems.push(`Declared with no production emit site: ${unemitted.join(", ")}`);
  }
  if (inert.length > 0) {
    problems.push(
      `Registered at hook points nothing emits, so they never run: ${inert.join(", ")}`,
    );
  }
  return {
    id: "gate.hook-coverage",
    label: "Hook coverage",
    status: "fail",
    message: `${problems.join(". ")}. Emitted points: ${[...emitted].join(", ")}.`,
  };
}
