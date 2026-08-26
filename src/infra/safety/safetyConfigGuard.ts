/**
 * Safety Config Guard (GORDON_SAFETY_CONFIG_GUARD).
 *
 * Trading-domain analog of Anthropic's "it is unacceptable to remove or
 * edit tests" rule from "Effective harnesses for long-running agents"
 * (2026). In a coding agent, removing tests = silently broken features.
 * In a trading agent, weakening safety config = silent loss of capital.
 *
 * This guard enforces a structured baseline of safety thresholds that
 * the agent (or any caller) cannot weaken. It checks:
 *
 *   - deny-list integrity     — required tools must remain denied
 *   - position limits         — maxPositionUsd cannot be raised
 *   - leverage cap            — maxLeverage cannot be raised
 *   - daily loss limit        — dailyLossLimitPct cannot be raised
 *   - kill-switch presence    — killSwitch must remain configured
 *   - mandate scope           — symbol set cannot be expanded
 *
 * Like `strategyCodeValidator.ts`, this is a structural enforcement
 * primitive — the violations are surfaced; the *caller* decides whether
 * to block. Default convention: any `severity: "block"` violation halts
 * the proposed change.
 *
 * Two modes:
 *   - validateAgainstBaseline(baseline, current) — does the live config
 *     still match (or strictly tighten) the baseline?
 *   - validateDiff(prev, next) — is the proposed diff safe? (catches
 *     attempts to weaken in-flight)
 */

export const SAFETY_CONFIG_GUARD_FLAG_ENV = "GORDON_SAFETY_CONFIG_GUARD";

export type GuardSeverity = "block" | "warn";

export interface SafetyConfig {
  /** Hard-deny tools. Must be a SUPERSET of the baseline list. */
  denyList: string[];
  /** Max single-position USD notional. Must be <= baseline. */
  maxPositionUsd: number;
  /** Max leverage multiplier. Must be <= baseline. */
  maxLeverage: number;
  /** Daily loss cutoff as a fraction (e.g. 0.05 = 5%). Must be <= baseline. */
  dailyLossLimitPct: number;
  /** Kill-switch enabled? Cannot flip true→false. */
  killSwitchEnabled: boolean;
  /** Allowed symbol universe. Must be a SUBSET of the baseline. */
  allowedSymbols: string[];
  /** Optional free-form notes. */
  notes?: string[];
}

export interface GuardViolation {
  rule: string;
  severity: GuardSeverity;
  message: string;
  fixInstruction: string;
  baselineValue?: unknown;
  currentValue?: unknown;
}

import { flagEnv } from "../config/flagResolver.ts";

export interface GuardResult {
  passes: boolean;
  violations: GuardViolation[];
  blockingFixInstruction: string | null;
}

export function isSafetyConfigGuardEnabled(env: NodeJS.ProcessEnv = flagEnv()): boolean {
  return (
    env[SAFETY_CONFIG_GUARD_FLAG_ENV] === "1" ||
    env[SAFETY_CONFIG_GUARD_FLAG_ENV] === "true"
  );
}

/**
 * Default Gordon safety baseline. Mirrors the deny-list in CLAUDE.md and
 * the trading-constitution defaults. Callers may extend by passing a
 * different `baseline` to the validators.
 */
export const GORDON_DEFAULT_BASELINE: SafetyConfig = {
  denyList: [
    "place_order",
    "execute_trade",
    "cancel_order",
    "cancel_all_orders",
    "cancel_replace_order",
    "cancel_order_list",
    "wallet_transfer",
  ],
  maxPositionUsd: 10_000,
  maxLeverage: 2,
  dailyLossLimitPct: 0.05,
  killSwitchEnabled: true,
  allowedSymbols: [],
};

// ============================================================================
// Validators
// ============================================================================

export function validateAgainstBaseline(
  baseline: SafetyConfig,
  current: SafetyConfig,
): GuardResult {
  const violations: GuardViolation[] = [];

  // Deny-list: every baseline-denied tool must still be denied.
  const currentDeny = new Set(current.denyList);
  for (const tool of baseline.denyList) {
    if (!currentDeny.has(tool)) {
      violations.push({
        rule: "deny_list_integrity",
        severity: "block",
        message: `Tool "${tool}" was removed from the deny-list.`,
        fixInstruction: `Re-add "${tool}" to denyList. Safety-critical tools cannot be silently approved.`,
        baselineValue: baseline.denyList,
        currentValue: current.denyList,
      });
    }
  }

  if (current.maxPositionUsd > baseline.maxPositionUsd) {
    violations.push({
      rule: "max_position_raised",
      severity: "block",
      message: `maxPositionUsd raised from ${baseline.maxPositionUsd} to ${current.maxPositionUsd}.`,
      fixInstruction: `Restore maxPositionUsd to <= ${baseline.maxPositionUsd}, or update the baseline through the authorized channel.`,
      baselineValue: baseline.maxPositionUsd,
      currentValue: current.maxPositionUsd,
    });
  }

  if (current.maxLeverage > baseline.maxLeverage) {
    violations.push({
      rule: "max_leverage_raised",
      severity: "block",
      message: `maxLeverage raised from ${baseline.maxLeverage}x to ${current.maxLeverage}x.`,
      fixInstruction: `Restore maxLeverage to <= ${baseline.maxLeverage}, or update the baseline through the authorized channel.`,
      baselineValue: baseline.maxLeverage,
      currentValue: current.maxLeverage,
    });
  }

  if (current.dailyLossLimitPct > baseline.dailyLossLimitPct) {
    violations.push({
      rule: "daily_loss_limit_raised",
      severity: "block",
      message: `dailyLossLimitPct raised from ${baseline.dailyLossLimitPct} to ${current.dailyLossLimitPct}.`,
      fixInstruction: `Restore dailyLossLimitPct to <= ${baseline.dailyLossLimitPct}.`,
      baselineValue: baseline.dailyLossLimitPct,
      currentValue: current.dailyLossLimitPct,
    });
  }

  if (baseline.killSwitchEnabled && !current.killSwitchEnabled) {
    violations.push({
      rule: "kill_switch_disabled",
      severity: "block",
      message: "Kill-switch was disabled.",
      fixInstruction: "Re-enable the kill-switch. It cannot be turned off after baseline was set.",
      baselineValue: true,
      currentValue: false,
    });
  }

  // Allowed-symbol expansion: current must be a subset of baseline
  // (unless baseline is empty, which means "no restriction").
  if (baseline.allowedSymbols.length > 0) {
    const baselineSet = new Set(baseline.allowedSymbols);
    const added = current.allowedSymbols.filter((s) => !baselineSet.has(s));
    if (added.length > 0) {
      violations.push({
        rule: "symbol_universe_expanded",
        severity: "block",
        message: `Symbols added outside the baseline universe: ${added.join(", ")}.`,
        fixInstruction: `Remove ${added.join(", ")} from allowedSymbols, or expand the baseline through the authorized channel.`,
        baselineValue: baseline.allowedSymbols,
        currentValue: current.allowedSymbols,
      });
    }
  }

  return buildResult(violations);
}

/**
 * Validate that a proposed change (prev → next) does not weaken safety
 * relative to `prev`. Used when an agent (or operator) proposes an
 * in-flight modification.
 */
export function validateDiff(prev: SafetyConfig, next: SafetyConfig): GuardResult {
  // Diff is just a baseline check against the *previous* config.
  return validateAgainstBaseline(prev, next);
}

function buildResult(violations: GuardViolation[]): GuardResult {
  const passes = violations.every((v) => v.severity !== "block");
  const blocking = violations.filter((v) => v.severity === "block");
  const blockingFixInstruction =
    blocking.length === 0
      ? null
      : blocking.map((v) => `[${v.rule}] ${v.fixInstruction}`).join(" ");
  return { passes, violations, blockingFixInstruction };
}

export function formatGuardResult(result: GuardResult): string {
  const lines: string[] = [];
  lines.push(`Safety config guard: ${result.passes ? "PASS" : "BLOCK"}`);
  for (const v of result.violations) {
    lines.push(`  [${v.severity.toUpperCase()}] ${v.rule}: ${v.message}`);
    lines.push(`    fix: ${v.fixInstruction}`);
  }
  return lines.join("\n");
}

export function guardResultToPayload(result: GuardResult): Record<string, unknown> {
  return {
    kind: "safety_config_guard.result_recorded",
    passes: result.passes,
    violationCount: result.violations.length,
    blockingCount: result.violations.filter((v) => v.severity === "block").length,
    blockingFixInstruction: result.blockingFixInstruction,
    violations: result.violations.map((v) => ({
      rule: v.rule,
      severity: v.severity,
      baselineValue: v.baselineValue,
      currentValue: v.currentValue,
    })),
  };
}
