/**
 * Rotating Self-Audit (GORDON_SELF_AUDIT).
 *
 * Port of AITrader's "one deep pass per run" self-inspection loop. Each
 * run the agent audits ONE rotating theme of its own tooling, hunting
 * silent failures and dead weight rather than trading edge. A pointer
 * advances across runs so that over five runs every theme is covered,
 * without paying the cost of auditing all five every run.
 *
 * Distinct from the anti-rot strategy gates (`infra/safety/anti-rot/`),
 * which audit STRATEGIES (universe drift, coherence, strategy mandates).
 * This audits the AGENT'S OWN scripts, discovery coverage, unused
 * assets, guardrail wiring, and data-API budgets.
 *
 * Themes (fixed rotation order):
 *   - script_health      — cron/utility scripts silently failing or stale
 *   - discovery_coverage — how much of the universe is actually scanned
 *   - unused_assets      — skills / playbooks / tools never referenced
 *   - guardrails_risk    — safety guardrails disabled or currently tripped
 *   - data_api_tokens    — provider budgets low, expiring, or expired
 *
 * The auditor is PURE: it examines injected health inputs and returns
 * findings. It reads no files and makes no calls. Callers gather the
 * inputs (from cron logs, the tool registry, provider clients) and feed
 * them in; the module only reasons over them.
 */

export const SELF_AUDIT_FLAG_ENV = "GORDON_SELF_AUDIT";

export function isSelfAuditEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[SELF_AUDIT_FLAG_ENV] === "1" || env[SELF_AUDIT_FLAG_ENV] === "true";
}

export const AUDIT_THEMES = [
  "script_health",
  "discovery_coverage",
  "unused_assets",
  "guardrails_risk",
  "data_api_tokens",
] as const;

export type AuditTheme = (typeof AUDIT_THEMES)[number];

export type FindingSeverity = "info" | "warn" | "critical";

export interface Finding {
  theme: AuditTheme;
  severity: FindingSeverity;
  /** What the finding is about (script name, provider, asset id, ...). */
  subject: string;
  message: string;
  /** Concrete next step, when there is one. */
  remediation?: string;
}

/** Pointer state carried across runs. Immutable; `nextTheme` returns a new one. */
export interface RotationState {
  /** Index into AUDIT_THEMES of the theme to audit THIS run. */
  index: number;
  /** How many full rotations have completed. */
  rotations: number;
}

export function initRotationState(startIndex = 0): RotationState {
  const index = ((startIndex % AUDIT_THEMES.length) + AUDIT_THEMES.length) % AUDIT_THEMES.length;
  return { index, rotations: 0 };
}

export function currentTheme(state: RotationState): AuditTheme {
  return AUDIT_THEMES[state.index]!;
}

/** Advance the pointer to the next theme, wrapping and counting rotations. */
export function nextTheme(state: RotationState): RotationState {
  const nextIndex = (state.index + 1) % AUDIT_THEMES.length;
  const rotations = nextIndex === 0 ? state.rotations + 1 : state.rotations;
  return { index: nextIndex, rotations };
}

// --- Injected health inputs -------------------------------------------------

export interface ScriptHealth {
  name: string;
  /** Exit code of the last run. Non-zero => failing. Undefined => never run. */
  lastExitCode?: number;
  /** Epoch ms of the last run. Undefined => never run. */
  lastRunAtMs?: number;
  /** Expected cadence in ms. If exceeded since lastRunAtMs => stale. */
  expectedIntervalMs?: number;
}

export interface DiscoveryCoverage {
  universeSize: number;
  scannedCount: number;
  /** Symbols whose last scan is older than the freshness window. */
  staleCount?: number;
}

export interface AssetUsage {
  id: string;
  /** e.g. "skill" | "playbook" | "tool" | "recipe". Free-form. */
  kind: string;
  /** Epoch ms of last use. Undefined => never used. */
  lastUsedAtMs?: number;
  /** True if referenced anywhere in the registry / config. */
  referenced?: boolean;
}

export interface GuardrailStatus {
  name: string;
  enabled: boolean;
  /** True if the guardrail is currently in a tripped/blocking state. */
  tripped?: boolean;
}

export interface DataApiToken {
  provider: string;
  /** Remaining call/credit budget. */
  remaining?: number;
  /** Total budget, used to derive a low-budget ratio. */
  limit?: number;
  /** Epoch ms the token/plan expires. */
  expiresAtMs?: number;
}

export interface SelfAuditInputs {
  scripts?: readonly ScriptHealth[];
  discovery?: DiscoveryCoverage;
  assets?: readonly AssetUsage[];
  guardrails?: readonly GuardrailStatus[];
  dataApis?: readonly DataApiToken[];
}

export interface AuditOptions {
  /** Clock injection for staleness/expiry checks. Default Date.now. */
  now?: () => number;
  /** Coverage below this fraction warns. Default 0.6. */
  minCoverageRatio?: number;
  /** Remaining/limit below this fraction warns. Default 0.15. */
  lowBudgetRatio?: number;
  /** A token expiring within this window (ms) warns. Default 24h. */
  tokenExpiryWarnMs?: number;
  /** An asset unused for longer than this (ms) warns as dead weight. Default 30d. */
  staleAssetMs?: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function resolveOptions(opts: AuditOptions): Required<AuditOptions> {
  return {
    now: opts.now ?? (() => Date.now()),
    minCoverageRatio: opts.minCoverageRatio ?? 0.6,
    lowBudgetRatio: opts.lowBudgetRatio ?? 0.15,
    tokenExpiryWarnMs: opts.tokenExpiryWarnMs ?? DAY_MS,
    staleAssetMs: opts.staleAssetMs ?? 30 * DAY_MS,
  };
}

// --- Per-theme auditors -----------------------------------------------------

function auditScriptHealth(
  scripts: readonly ScriptHealth[],
  o: Required<AuditOptions>,
): Finding[] {
  const findings: Finding[] = [];
  const now = o.now();
  for (const s of scripts) {
    if (s.lastExitCode === undefined && s.lastRunAtMs === undefined) {
      findings.push({
        theme: "script_health",
        severity: "info",
        subject: s.name,
        message: "script has never run",
        remediation: "confirm the script is scheduled or intentionally dormant",
      });
      continue;
    }
    if (s.lastExitCode !== undefined && s.lastExitCode !== 0) {
      findings.push({
        theme: "script_health",
        severity: "critical",
        subject: s.name,
        message: `last run exited non-zero (${s.lastExitCode})`,
        remediation: "inspect the script log; a silent failure may be masking missing work",
      });
    }
    if (
      s.lastRunAtMs !== undefined &&
      s.expectedIntervalMs !== undefined &&
      now - s.lastRunAtMs > s.expectedIntervalMs
    ) {
      findings.push({
        theme: "script_health",
        severity: "warn",
        subject: s.name,
        message: `stale: last run ${now - s.lastRunAtMs}ms ago, expected every ${s.expectedIntervalMs}ms`,
        remediation: "check the scheduler; the cadence has slipped",
      });
    }
  }
  return findings;
}

function auditDiscoveryCoverage(
  cov: DiscoveryCoverage,
  o: Required<AuditOptions>,
): Finding[] {
  const findings: Finding[] = [];
  if (cov.universeSize <= 0) return findings;
  const ratio = cov.scannedCount / cov.universeSize;
  if (ratio < o.minCoverageRatio) {
    findings.push({
      theme: "discovery_coverage",
      severity: "warn",
      subject: "universe",
      message: `only ${cov.scannedCount}/${cov.universeSize} scanned (${(ratio * 100).toFixed(0)}%)`,
      remediation: "widen the scan or investigate why symbols are being skipped",
    });
  }
  if (cov.staleCount && cov.staleCount > 0) {
    findings.push({
      theme: "discovery_coverage",
      severity: "info",
      subject: "freshness",
      message: `${cov.staleCount} symbol(s) past the freshness window`,
      remediation: "re-scan stale symbols before relying on their signals",
    });
  }
  return findings;
}

function auditUnusedAssets(
  assets: readonly AssetUsage[],
  o: Required<AuditOptions>,
): Finding[] {
  const findings: Finding[] = [];
  const now = o.now();
  for (const a of assets) {
    if (a.referenced === false) {
      findings.push({
        theme: "unused_assets",
        severity: "warn",
        subject: `${a.kind}:${a.id}`,
        message: "asset is not referenced anywhere",
        remediation: "wire it up or delete it (dead weight in the tool surface)",
      });
      continue;
    }
    if (a.lastUsedAtMs === undefined) {
      findings.push({
        theme: "unused_assets",
        severity: "info",
        subject: `${a.kind}:${a.id}`,
        message: "asset has never been used",
      });
      continue;
    }
    if (now - a.lastUsedAtMs > o.staleAssetMs) {
      findings.push({
        theme: "unused_assets",
        severity: "info",
        subject: `${a.kind}:${a.id}`,
        message: `unused for ${now - a.lastUsedAtMs}ms`,
        remediation: "consider retiring it if the disuse is deliberate",
      });
    }
  }
  return findings;
}

function auditGuardrails(guardrails: readonly GuardrailStatus[]): Finding[] {
  const findings: Finding[] = [];
  for (const g of guardrails) {
    if (!g.enabled) {
      findings.push({
        theme: "guardrails_risk",
        severity: "critical",
        subject: g.name,
        message: "guardrail is disabled",
        remediation: "re-enable it or record an explicit, time-boxed waiver",
      });
      continue;
    }
    if (g.tripped) {
      findings.push({
        theme: "guardrails_risk",
        severity: "warn",
        subject: g.name,
        message: "guardrail is currently tripped",
        remediation: "resolve the blocking condition before it degrades to a silent bypass",
      });
    }
  }
  return findings;
}

function auditDataApiTokens(
  tokens: readonly DataApiToken[],
  o: Required<AuditOptions>,
): Finding[] {
  const findings: Finding[] = [];
  const now = o.now();
  for (const t of tokens) {
    if (t.expiresAtMs !== undefined) {
      if (t.expiresAtMs <= now) {
        findings.push({
          theme: "data_api_tokens",
          severity: "critical",
          subject: t.provider,
          message: "token/plan has expired",
          remediation: "rotate the credential before the next data pull fails silently",
        });
      } else if (t.expiresAtMs - now <= o.tokenExpiryWarnMs) {
        findings.push({
          theme: "data_api_tokens",
          severity: "warn",
          subject: t.provider,
          message: `token expires in ${t.expiresAtMs - now}ms`,
          remediation: "schedule a rotation",
        });
      }
    }
    if (
      t.remaining !== undefined &&
      t.limit !== undefined &&
      t.limit > 0 &&
      t.remaining / t.limit < o.lowBudgetRatio
    ) {
      findings.push({
        theme: "data_api_tokens",
        severity: "warn",
        subject: t.provider,
        message: `budget low: ${t.remaining}/${t.limit} remaining`,
        remediation: "throttle non-essential pulls or raise the plan limit",
      });
    }
  }
  return findings;
}

/**
 * Audit a single theme over the injected inputs. Themes read only their
 * own slice; missing slices produce no findings (nothing to audit).
 */
export function audit(
  theme: AuditTheme,
  inputs: SelfAuditInputs,
  options: AuditOptions = {},
): Finding[] {
  const o = resolveOptions(options);
  switch (theme) {
    case "script_health":
      return inputs.scripts ? auditScriptHealth(inputs.scripts, o) : [];
    case "discovery_coverage":
      return inputs.discovery ? auditDiscoveryCoverage(inputs.discovery, o) : [];
    case "unused_assets":
      return inputs.assets ? auditUnusedAssets(inputs.assets, o) : [];
    case "guardrails_risk":
      return inputs.guardrails ? auditGuardrails(inputs.guardrails) : [];
    case "data_api_tokens":
      return inputs.dataApis ? auditDataApiTokens(inputs.dataApis, o) : [];
  }
}

export interface SelfAuditPass {
  theme: AuditTheme;
  findings: Finding[];
  criticalCount: number;
  warnCount: number;
  infoCount: number;
  /** Pointer to use on the NEXT run. */
  nextState: RotationState;
}

/**
 * Run ONE deep pass: audit the theme the pointer currently points at,
 * then hand back the advanced pointer for the next run.
 */
export function runSelfAuditPass(
  state: RotationState,
  inputs: SelfAuditInputs,
  options: AuditOptions = {},
): SelfAuditPass {
  const theme = currentTheme(state);
  const findings = audit(theme, inputs, options);
  return {
    theme,
    findings,
    criticalCount: findings.filter((f) => f.severity === "critical").length,
    warnCount: findings.filter((f) => f.severity === "warn").length,
    infoCount: findings.filter((f) => f.severity === "info").length,
    nextState: nextTheme(state),
  };
}

export function formatSelfAuditPass(pass: SelfAuditPass): string {
  const lines: string[] = [];
  lines.push(
    `Self-audit [${pass.theme}] — ${pass.criticalCount} critical, ${pass.warnCount} warn, ${pass.infoCount} info`,
  );
  for (const f of pass.findings) {
    const tag = f.severity === "critical" ? "!!" : f.severity === "warn" ? "! " : "  ";
    lines.push(`  ${tag} ${f.subject}: ${f.message}`);
    if (f.remediation) lines.push(`       fix: ${f.remediation}`);
  }
  return lines.join("\n");
}

export function selfAuditPassToPayload(pass: SelfAuditPass): Record<string, unknown> {
  return {
    kind: "self_audit.pass_recorded",
    theme: pass.theme,
    critical: pass.criticalCount,
    warn: pass.warnCount,
    info: pass.infoCount,
    nextTheme: currentTheme(pass.nextState),
    findings: pass.findings.map((f) => ({
      severity: f.severity,
      subject: f.subject,
      message: f.message,
    })),
  };
}
