/**
 * Policy layer integrity: the `policy` settings layer, signed with the SAME
 * scheme the `synced` layer already uses.
 *
 * WHY: `~/.gordon/policy.json` is the highest-precedence PERSISTENT settings
 * layer. It outranks the `local` layer that `/flags set` writes to, it sits
 * inside the filesystem write guard's own allowlist, and it feeds both the
 * flag resolver and the subprocess-sandbox toggle. Unsigned, that makes any
 * code able to write `~/.gordon` able to silently outrank the operator and
 * turn off a sandbox.
 *
 * SCHEME: deliberately not a second integrity mechanism. A policy file is a
 * `SettingsSnapshot`, the exact envelope `pushSettings`/`loadRemoteSyncLayer`
 * produce and verify, so `signSnapshot` / `verifySnapshot` / the canonical
 * HMAC-SHA256 in `./index.ts` are reused verbatim. Only the key env and the
 * failure policy differ: the synced layer is opt-in and its absence is the
 * norm, whereas a policy file that EXISTS but does not verify is refused loudly.
 *
 * KEY HANDLING: mirrors the synced layer. The key is read from the environment
 * and is never generated: a per-host minted key would make every signature
 * invalid, and a policy layer is only meaningful when the deployment that
 * authored it holds the key. No key configured means the layer cannot be
 * verified, so it is not applied.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { GORDON_DIR } from "../../storage/paths.ts";
import type { LayeredSettings } from "../settingsLayers.ts";
import {
  signSnapshot,
  verifySnapshot,
  type SettingsSnapshot,
  type SnapshotContent,
} from "./index.ts";

/** HMAC key the policy envelope is verified against. */
export const POLICY_KEY_ENV = "GORDON_POLICY_KEY";
/** Path override (tests / non-default deployments). */
export const POLICY_PATH_ENV = "GORDON_POLICY_PATH";

export function policyPath(env: NodeJS.ProcessEnv = process.env): string {
  return env[POLICY_PATH_ENV] ?? join(GORDON_DIR, "policy.json");
}

export type PolicyRefusalReason =
  | "no_key"
  | "unreadable"
  | "unsigned"
  | "signature_mismatch"
  | "malformed";

export type PolicyLayerState =
  | { state: "absent"; path: string }
  | {
      state: "applied";
      path: string;
      origin: string;
      signedAt: number;
      keys: string[];
    }
  | {
      state: "refused";
      path: string;
      reason: PolicyRefusalReason;
      detail: string;
    };

/**
 * Classify the policy layer without applying it. This is the surface the
 * doctor's gate-enforcement lens reads: `absent` is the normal case and must
 * stay quiet, `applied` means a verified policy is in force, `refused` means a
 * file is present on disk and is NOT being applied.
 */
export function inspectPolicyLayer(env: NodeJS.ProcessEnv = process.env): PolicyLayerState {
  const path = policyPath(env);
  if (!existsSync(path)) return { state: "absent", path };

  const key = env[POLICY_KEY_ENV];
  if (!key || key.length === 0) {
    return {
      state: "refused",
      path,
      reason: "no_key",
      detail: `a policy file exists but ${POLICY_KEY_ENV} is not set, so its signature cannot be verified`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return {
      state: "refused",
      path,
      reason: "unreadable",
      detail: "policy file is not readable JSON",
    };
  }

  const verification = verifySnapshot(parsed, key);
  if (!verification.valid) {
    return {
      state: "refused",
      path,
      reason: verification.reason,
      detail: verification.detail,
    };
  }

  const snapshot = parsed as SettingsSnapshot;
  return {
    state: "applied",
    path,
    origin: snapshot.origin,
    signedAt: snapshot.signedAt,
    keys: Object.keys(snapshot.values),
  };
}

const warned = new Set<string>();

/** Clear the warn-once dedupe (tests). */
export function resetPolicyWarnings(): void {
  warned.clear();
}

/**
 * Load the policy layer, or `null` when there is nothing trustworthy to apply.
 *
 * A file that fails verification is REFUSED, not demoted. Demotion would leave
 * the file still able to set keys the operator never set (the sandbox toggle
 * among them), so it does not close the privilege path; and a layer that
 * silently loses its authority is as confusing to a managed deployment as one
 * that silently gains it. Refusal is loud and total.
 *
 * A MISSING policy file is the overwhelmingly normal case and is silent.
 */
export function loadPolicyLayer(
  env: NodeJS.ProcessEnv = process.env,
  warn: (msg: string, meta: Record<string, unknown>) => void = (m, meta) =>
    console.warn(m, meta),
): LayeredSettings | null {
  const state = inspectPolicyLayer(env);
  if (state.state === "absent") return null;

  if (state.state === "refused") {
    const dedupe = `${state.path}:${state.reason}`;
    if (!warned.has(dedupe)) {
      warned.add(dedupe);
      warn(
        "REFUSED organization policy layer: it is NOT applied and settings fall back to the operator's own layers",
        { path: state.path, reason: state.reason, detail: state.detail },
      );
    }
    return null;
  }

  const parsed = JSON.parse(readFileSync(state.path, "utf-8")) as SettingsSnapshot;
  return { layer: "policy", values: parsed.values, source: state.path };
}

export interface WritePolicyOptions {
  origin?: string;
  now?: () => number;
  env?: NodeJS.ProcessEnv;
}

/**
 * Sign `values` into a policy envelope and write it. The authoring side of the
 * same scheme `pushSettings` uses for the synced layer.
 */
export function writeSignedPolicy(
  values: Record<string, unknown>,
  key: string,
  options: WritePolicyOptions = {},
): SettingsSnapshot {
  const content: SnapshotContent = {
    version: 1,
    origin: options.origin ?? process.env.HOSTNAME ?? "unknown",
    signedAt: (options.now ?? Date.now)(),
    values,
  };
  const snapshot = signSnapshot(content, key);
  const path = policyPath(options.env ?? process.env);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(snapshot, null, 2), { mode: 0o600 });
  return snapshot;
}
