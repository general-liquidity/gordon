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

export const EMITTED_HOOK_POINTS: ReadonlySet<HookPoint> = new Set(HOOK_POINTS);

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
    remedy:
      "Set GORDON_EXTERNAL_HOOKS_PATH to a valid hooks JSON file and restart Gordon.",
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
