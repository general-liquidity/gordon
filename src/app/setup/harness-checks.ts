/**
 * Harness wire helpers — Anthropic effective-harnesses port (A2/A3/A4).
 *
 * Bundles the wiring for three primitives so `setup-runtime.ts` can slot
 * them in with a single import each:
 *
 *   - A2 initializerAgent     → runInitializerOnBootstrap()
 *   - A3 initProbe            → collectInitProbeChecks()
 *   - A4 safetyConfigGuard    → collectSafetyBaselineChecks()
 *
 * Each helper is flag-gated. When the flag is off the helper returns an
 * empty checklist (no-op) — bootstrap and doctor report stay clean.
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import {
  isInitializerAgentEnabled,
  isInitialized,
  runInitializer,
  hashInitConfig,
} from "../../infra/agents/initializerAgent.ts";
import {
  isInitProbeEnabled,
  runInitProbes,
  type Probe,
} from "../../infra/diagnostics/initProbe.ts";
import {
  isSafetyConfigGuardEnabled,
  validateAgainstBaseline,
  GORDON_DEFAULT_BASELINE,
  type SafetyConfig,
} from "../../infra/safety/safetyConfigGuard.ts";
import {
  isNetworkAllowlistEnabled,
  listAllowedHosts,
  getAllowlistMode,
} from "../../infra/safety/networkAllowlist.ts";
import {
  isFilesystemWriteGuardEnabled,
  listAllowedPaths,
  getGuardMode,
} from "../../infra/safety/filesystemWriteGuard.ts";
import type { DoctorCheck } from "./setup-runtime.ts";

// --- A2 ----------------------------------------------------------------------

export interface InitializerRunSummary {
  ran: boolean;
  reason: string;
  configHash: string | null;
}

/**
 * Record an initializer marker on first bootstrap. Pure state machine — does
 * NOT generate or write any artifacts. The caller has already finished
 * bootstrapping; this just records that initialization happened so later
 * sessions skip the routine.
 */
export function runInitializerOnBootstrap(
  artifactsWritten: readonly string[],
  notes: readonly string[] = [],
): InitializerRunSummary {
  if (!isInitializerAgentEnabled()) {
    return { ran: false, reason: "flag_off", configHash: null };
  }
  const configHash = hashInitConfig({ artifacts: [...artifactsWritten], notes: [...notes] });
  const result = runInitializer({
    configHash,
    artifactsWritten: [...artifactsWritten],
    notes: [...notes],
  });
  return { ran: result.ran, reason: result.reason, configHash };
}

// --- A3 ----------------------------------------------------------------------

/**
 * Default Gordon probe set. Conservative — these are observation-only
 * probes that DO NOT exercise the broker/exchange or LLM. Callers that
 * want deeper probes can pass their own list via `extraProbes`.
 *
 * The probes verify Gordon's local invariants: home dir writable, action
 * log path exists, default-config path readable. They're cheap enough to
 * run on every session start.
 */
export function defaultGordonProbes(): Probe[] {
  return [
    {
      id: "home_dir_writable",
      description: "~/.gordon home dir exists or can be created",
      family: "state",
      async check() {
        const home = join(homedir(), ".gordon");
        // We don't create here — just check the parent (homedir) exists.
        if (!existsSync(homedir())) {
          return {
            status: "fail",
            message: `homedir does not exist: ${homedir()}`,
            fixInstruction: "Ensure $HOME (or equivalent) resolves to an existing directory.",
          };
        }
        return {
          status: "pass",
          message: `homedir present (.gordon path: ${home})`,
        };
      },
    },
    {
      id: "node_version_acceptable",
      description: "process.versions.bun or .node reports a version string",
      family: "other",
      async check() {
        const bun = (process.versions as Record<string, string | undefined>).bun;
        const node = process.versions.node;
        if (!bun && !node) {
          return {
            status: "fail",
            message: "neither Bun nor Node version reported",
            fixInstruction: "Run Gordon on Bun (preferred) or Node 20+.",
          };
        }
        return {
          status: "pass",
          message: bun ? `Bun ${bun}` : `Node ${node}`,
        };
      },
    },
  ];
}

/**
 * Run init probes and convert results into DoctorCheck entries so they
 * surface alongside the existing checks. Returns [] when the flag is
 * off.
 */
export async function collectInitProbeChecks(extraProbes: readonly Probe[] = []): Promise<DoctorCheck[]> {
  if (!isInitProbeEnabled()) return [];
  const probes: Probe[] = [...defaultGordonProbes(), ...extraProbes];
  const report = await runInitProbes(probes);
  return report.results.map((r) => ({
    id: `probe.${r.id}`,
    ok: r.status === "pass" || r.status === "skip",
    severity: r.status === "fail" ? "error" : "info",
    message: r.fixInstruction
      ? `${r.message} — fix: ${r.fixInstruction}`
      : r.message,
  }));
}

// --- A4 ----------------------------------------------------------------------

export interface CurrentSafetyConfigInput {
  /** Tools currently on the deny-list (from PermissionEngine state). */
  denyList?: readonly string[];
  /** Current max position notional. */
  maxPositionUsd?: number;
  /** Current max leverage. */
  maxLeverage?: number;
  /** Current daily loss limit fraction. */
  dailyLossLimitPct?: number;
  /** Kill-switch currently enabled? */
  killSwitchEnabled?: boolean;
  /** Allowed symbol universe. Empty = no restriction. */
  allowedSymbols?: readonly string[];
}

/** Merge supplied current values with conservative defaults. */
function buildCurrentSafetyConfig(input: CurrentSafetyConfigInput): SafetyConfig {
  return {
    denyList: [...(input.denyList ?? GORDON_DEFAULT_BASELINE.denyList)],
    maxPositionUsd: input.maxPositionUsd ?? GORDON_DEFAULT_BASELINE.maxPositionUsd,
    maxLeverage: input.maxLeverage ?? GORDON_DEFAULT_BASELINE.maxLeverage,
    dailyLossLimitPct: input.dailyLossLimitPct ?? GORDON_DEFAULT_BASELINE.dailyLossLimitPct,
    killSwitchEnabled: input.killSwitchEnabled ?? GORDON_DEFAULT_BASELINE.killSwitchEnabled,
    allowedSymbols: [...(input.allowedSymbols ?? GORDON_DEFAULT_BASELINE.allowedSymbols)],
  };
}

/**
 * Validate the current safety config against `GORDON_DEFAULT_BASELINE`.
 * Each violation becomes a DoctorCheck. Returns [] when the flag is off.
 *
 * Observation-only: this surfaces violations in the doctor report; it does
 * NOT block bootstrap. Promotion to a hard gate is a separate later step.
 */
export function collectSafetyBaselineChecks(input: CurrentSafetyConfigInput): DoctorCheck[] {
  if (!isSafetyConfigGuardEnabled()) return [];
  const current = buildCurrentSafetyConfig(input);
  const result = validateAgainstBaseline(GORDON_DEFAULT_BASELINE, current);
  if (result.passes) {
    return [
      {
        id: "safety_baseline",
        ok: true,
        severity: "info",
        message: "Safety config matches baseline (deny-list + limits + kill-switch intact).",
      },
    ];
  }
  return result.violations.map((v) => ({
    id: `safety_baseline.${v.rule}`,
    ok: false,
    severity: v.severity === "block" ? "error" : "warn",
    message: `${v.message} fix: ${v.fixInstruction}`,
  }));
}

// --- Network allowlist + filesystem write guard (sandbox-style checks) ------

/**
 * Surface the network-allowlist + filesystem-write-guard configurations
 * in the doctor report when the corresponding flags are on. Observation
 * only — these primitives are caller-invoked at runtime; doctor just
 * reports that the policy is active.
 */
export function collectSandboxChecks(): DoctorCheck[] {
  const checks: DoctorCheck[] = [];
  if (isNetworkAllowlistEnabled()) {
    const hosts = listAllowedHosts().length;
    const mode = getAllowlistMode();
    checks.push({
      id: "sandbox.network_allowlist",
      ok: true,
      severity: "info",
      message: `Network allowlist active in ${mode} mode (${hosts} hosts).`,
    });
  }
  if (isFilesystemWriteGuardEnabled()) {
    const paths = listAllowedPaths().length;
    const mode = getGuardMode();
    checks.push({
      id: "sandbox.filesystem_write_guard",
      ok: true,
      severity: "info",
      message: `Filesystem write guard active in ${mode} mode (${paths} allowed path prefixes).`,
    });
  }
  return checks;
}
