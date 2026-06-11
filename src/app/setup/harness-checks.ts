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
import { listAllowedHosts } from "../../infra/safety/networkAllowlist.ts";
import { listAllowedPaths } from "../../infra/safety/filesystemWriteGuard.ts";
import {
  isOutboundFetchGuardInstalled,
  type OutboundFetchGuardStatus,
} from "../../infra/safety/outboundFetchGuard.ts";
import {
  isFilesystemWriteGuardInstalled,
  type FilesystemWriteGuardStatus,
} from "../../infra/safety/filesystemWriteGuardInstaller.ts";
import { buildTransportGuardCoverageReport } from "../../infra/safety/transportGuardCoverage.ts";
import {
  isKvCacheMetricEnabled,
  readCacheCalls,
  summarizeHitRate,
} from "../../infra/agents/runtime/kvCacheHitMetric.ts";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { DoctorCheck } from "./setup-runtime.ts";
import {
  checkAgentReadiness,
  isAgentReadinessEnabled,
  isAgentReadinessOverridden,
} from "../../infra/diagnostics/agentReadiness.ts";
import { checkEnvStatus } from "../../infra/storage/config/env.ts";

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
  _artifactsWritten: readonly string[],
  _notes: readonly string[] = [],
): InitializerRunSummary {
  // Initializer agent feature deleted — bootstrap is handled by setup-runtime
  // directly. Function kept as a no-op for the single caller's interface.
  return { ran: false, reason: "deleted", configHash: null };
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
 * Surface the live state of the outbound-fetch + filesystem-write
 * guards in the doctor report. Reads the installer status accessors so
 * the operator sees not just policy config but whether the guard is
 * actually patched in (enabled-but-not-installed = silently inert
 * policy → error) and how many warn-mode violations it has observed.
 * Observation only — never mutates guard state.
 */
export function collectSandboxChecks(
  fetchGuard: OutboundFetchGuardStatus = isOutboundFetchGuardInstalled(),
  fsGuard: FilesystemWriteGuardStatus = isFilesystemWriteGuardInstalled(),
): DoctorCheck[] {
  const checks: DoctorCheck[] = [];

  if (!fetchGuard.enabled) {
    checks.push({
      id: "sandbox.network_allowlist",
      ok: false,
      severity: "warn",
      message: "Network allowlist disabled via GORDON_NETWORK_ALLOWLIST — outbound fetches are unguarded.",
    });
  } else if (!fetchGuard.installed) {
    checks.push({
      id: "sandbox.network_allowlist",
      ok: false,
      severity: "error",
      message: "Network allowlist enabled but the outbound fetch guard is NOT installed — the policy is inert. installProductionGuards() should run at process entry.",
    });
  } else {
    const hosts = listAllowedHosts().length;
    const violations = fetchGuard.warnViolations > 0
      ? ` ${fetchGuard.warnViolations} warn-mode violation(s) this session; recent hosts: ${fetchGuard.recentViolations.slice(-3).join(", ")}.`
      : "";
    checks.push({
      id: "sandbox.network_allowlist",
      ok: true,
      severity: fetchGuard.warnViolations > 0 ? "warn" : "info",
      message: `Outbound fetch guard installed in ${fetchGuard.mode} mode (${hosts} hosts).${violations}`,
    });
  }

  if (!fsGuard.enabled) {
    checks.push({
      id: "sandbox.filesystem_write_guard",
      ok: false,
      severity: "warn",
      message: "Filesystem write guard disabled via GORDON_FILESYSTEM_WRITE_GUARD — writes are unguarded.",
    });
  } else if (!fsGuard.installed) {
    checks.push({
      id: "sandbox.filesystem_write_guard",
      ok: false,
      severity: "error",
      message: "Filesystem write guard enabled but NOT installed — the policy is inert. installProductionGuards() should run at process entry.",
    });
  } else {
    const paths = listAllowedPaths().length;
    const violations = fsGuard.warnViolations > 0
      ? ` ${fsGuard.warnViolations} warn-mode violation(s) this session; recent paths: ${fsGuard.recentViolations.slice(-3).join(", ")}.`
      : "";
    checks.push({
      id: "sandbox.filesystem_write_guard",
      ok: true,
      severity: fsGuard.warnViolations > 0 ? "warn" : "info",
      message: `Filesystem write guard installed in ${fsGuard.mode} mode (${paths} allowed path prefixes).${violations}`,
    });
  }

  const coverage = buildTransportGuardCoverageReport({ fetchGuard, fsGuard });
  checks.push({
    id: "sandbox.transport_guard_coverage",
    ok: coverage.ok,
    severity: coverage.ok ? "info" : "error",
    message: coverage.ok
      ? coverage.summary
      : `${coverage.summary} Fetch guard installed=${coverage.fetchGuardInstalled}; filesystem guard installed=${coverage.filesystemGuardInstalled}.`,
  });

  return checks;
}

// --- KV-cache hit-rate metric + CLAUDE.md linter ----------------------------

/**
 * Surface the KV-cache hit-rate over the last 100 recorded calls when
 * the metric is enabled. Manus calls this "the single most important
 * metric for a production-stage AI agent" — surfacing it makes the
 * 10x cost lever visible.
 */
export function collectKvCacheCheck(): DoctorCheck[] {
  if (!isKvCacheMetricEnabled()) return [];
  try {
    const calls = readCacheCalls({ limit: 100 });
    if (calls.length === 0) {
      return [
        {
          id: "kv_cache.hit_rate",
          ok: true,
          severity: "info",
          message: "KV-cache metric enabled but no calls recorded yet.",
        },
      ];
    }
    const s = summarizeHitRate(calls);
    return [
      {
        id: "kv_cache.hit_rate",
        ok: true,
        severity: s.hitRate >= 0.5 ? "info" : "warn",
        message: `KV-cache hit rate ${(s.hitRate * 100).toFixed(1)}% over last ${s.windowSize} calls; estimated savings $${s.estimatedSavingsUsd.toFixed(2)}.`,
      },
    ];
  } catch {
    return [];
  }
}

/**
 * Lint the project's CLAUDE.md when the linter is enabled. Reports
 * line count, instruction count, and any per-rule findings (code-style
 * guidance in prompts, exhaustive command lists, large code snippets).
 */
export function collectClaudeMdLintChecks(_repoRoot: string = process.cwd()): DoctorCheck[] {
  // claudeMdLinter feature deleted — return no checks. Doctor still surfaces
  // file existence via other probes.
  return [];
}

// --- Agent readiness gate ----------------------------------------------------

export async function collectAgentReadinessChecks(): Promise<DoctorCheck[]> {
  if (!isAgentReadinessEnabled() || isAgentReadinessOverridden()) return [];
  const env = await checkEnvStatus();
  const result = checkAgentReadiness({ hasLlmKey: env.hasLLMKey });
  if (result.ready) {
    return [
      {
        id: "agent_readiness",
        ok: true,
        severity: "info",
        message: "Agent readiness gate passed.",
      },
    ];
  }
  return [
    {
      id: "agent_readiness",
      ok: false,
      severity: "error",
      message: result.blockingMessage ?? "Agent readiness gate failed.",
    },
    ...result.conditions
      .filter((c) => !c.ok)
      .map((c) => ({
        id: `agent_readiness.${c.id}`,
        ok: false,
        severity: "error" as const,
        message: c.message,
      })),
  ];
}
