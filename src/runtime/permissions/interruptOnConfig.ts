/**
 * interruptOn Config Parser — FW5a (Deep Agents parity, parser layer).
 *
 * Operator-facing config shape inspired by Deep Agents'
 * `interruptOn: { tool_name: true | { allowedDecisions: [...] } }`.
 *
 * Converts a friendly JSON config (suitable for .claude/settings.json or
 * any other operator-authored source) into the internal
 * `RuntimeApprovalRule[]` shape that Gordon's existing PermissionEngine
 * already consumes. No changes to PermissionEngine itself.
 *
 * Wiring to a specific config-loading source (.claude/settings.json,
 * env-supplied JSON, TUI command) is FW5b for a future session.
 *
 * Operator surface:
 *
 *   {
 *     "interruptOn": {
 *       "place_order": "deny",                 // shorthand: always deny
 *       "cancel_*":    "allow",                // shorthand: pattern-allow
 *       "research_*":  { "decision": "allow", "scope": "persistent" },
 *       "execute_plan": {
 *         "decision": "deny",
 *         "permissionScope": "livetrade.execute",
 *         "expiresAt": "2026-12-31T00:00:00Z"
 *       }
 *     }
 *   }
 *
 * Keys: tool name (exact) OR glob pattern (contains `*` or `?`).
 * Specific names always win over patterns at evaluation time
 * (PermissionEngine.ruleSpecificity).
 *
 * Values:
 *   - "allow" | "deny"                shorthand for { decision: <v> }
 *   - InterruptOnRule object           explicit shape
 *
 * Defaults applied per rule:
 *   scope         = "session"
 *   createdBy     = options.createdBy ?? "operator-config"
 *   createdAt     = options.now ?? new Date() ISO string
 *   expiresAt     = undefined (no expiry)
 *
 * Pure function. No I/O. No PermissionEngine mutation. Caller is
 * responsible for registering the resulting rules with the runtime
 * store (or filtering, persisting, etc.).
 */

import { randomUUID } from "node:crypto";
import type {
  RuntimeApprovalRule,
  RuntimePermissionScope,
} from "../contracts/types.ts";

export type InterruptOnDecision = "allow" | "deny";

/**
 * Full per-tool rule shape. The operator-facing surface accepts either
 * this object or the shorthand string ("allow" / "deny").
 */
export interface InterruptOnRule {
  decision: InterruptOnDecision;
  scope?: "session" | "persistent";
  permissionScope?: RuntimePermissionScope;
  /** ISO string. Rules past this are filtered out by PermissionEngine. */
  expiresAt?: string | null;
}

/** Map of (tool name or glob pattern) → rule or shorthand. */
export type InterruptOnConfig = Record<string, InterruptOnDecision | InterruptOnRule>;

export interface ParseInterruptOnOptions {
  /**
   * Attribution string for `RuntimeApprovalRule.createdBy`. Default
   * "operator-config".
   */
  createdBy?: string;
  /**
   * Timestamp seed for `createdAt`. Default current time. Exposed for
   * deterministic tests.
   */
  now?: Date;
  /**
   * If true, throw on invalid entries instead of silently dropping them.
   * Default false — invalid entries are reported in `result.warnings`.
   */
  strict?: boolean;
  /**
   * Optional id generator (e.g., to inject a deterministic counter in
   * tests). Default: crypto.randomUUID().
   */
  idGenerator?: () => string;
}

export interface ParsedInterruptOn {
  rules: RuntimeApprovalRule[];
  warnings: string[];
  /** Number of input entries that produced a rule. */
  acceptedCount: number;
  /** Number of input entries that were dropped (with reason in warnings). */
  rejectedCount: number;
}

/**
 * True iff `key` contains glob wildcards (`*` or `?`).
 */
function isGlobPattern(key: string): boolean {
  return key.includes("*") || key.includes("?");
}

/**
 * Validate an InterruptOnRule object. Returns null when valid, else a
 * human-readable error.
 */
function validateRule(value: unknown): string | null {
  if (typeof value !== "object" || value === null) {
    return "rule must be an object or the shorthand string 'allow' | 'deny'";
  }
  const rule = value as Record<string, unknown>;
  if (rule.decision !== "allow" && rule.decision !== "deny") {
    return `decision must be 'allow' or 'deny' (got ${JSON.stringify(rule.decision)})`;
  }
  if (
    rule.scope !== undefined &&
    rule.scope !== "session" &&
    rule.scope !== "persistent"
  ) {
    return `scope must be 'session' or 'persistent' (got ${JSON.stringify(rule.scope)})`;
  }
  if (
    rule.expiresAt !== undefined &&
    rule.expiresAt !== null &&
    typeof rule.expiresAt !== "string"
  ) {
    return "expiresAt must be an ISO string, null, or undefined";
  }
  if (rule.expiresAt && typeof rule.expiresAt === "string") {
    const parsed = Date.parse(rule.expiresAt);
    if (Number.isNaN(parsed)) {
      return `expiresAt is not a parseable ISO timestamp: ${rule.expiresAt}`;
    }
  }
  if (
    rule.permissionScope !== undefined &&
    typeof rule.permissionScope !== "string"
  ) {
    return "permissionScope must be a string";
  }
  return null;
}

/**
 * Convert a single config entry to a RuntimeApprovalRule. Returns null
 * if the entry is invalid (caller appends a warning).
 */
function entryToRule(
  key: string,
  value: InterruptOnDecision | InterruptOnRule,
  createdAt: string,
  createdBy: string,
  idGenerator: () => string,
): RuntimeApprovalRule | null {
  // Normalize shorthand to full rule.
  let rule: InterruptOnRule;
  if (typeof value === "string") {
    if (value !== "allow" && value !== "deny") return null;
    rule = { decision: value };
  } else {
    rule = value;
  }

  const base: RuntimeApprovalRule = {
    id: idGenerator(),
    decision: rule.decision,
    scope: rule.scope ?? "session",
    createdAt,
    createdBy,
  };

  if (isGlobPattern(key)) {
    base.toolNamePattern = key;
  } else {
    base.toolName = key;
  }

  if (rule.permissionScope) {
    base.permissionScope = rule.permissionScope;
  }
  if (rule.expiresAt !== undefined) {
    base.expiresAt = rule.expiresAt;
  }

  return base;
}

/**
 * Parse an operator-authored interruptOn config into RuntimeApprovalRule[].
 *
 * Invalid entries are dropped (with a warning) by default, or throw an
 * Error in strict mode. The parser does NOT mutate any runtime state;
 * caller is responsible for registering rules with the runtime store.
 */
export function parseInterruptOnConfig(
  config: InterruptOnConfig | undefined | null,
  options: ParseInterruptOnOptions = {},
): ParsedInterruptOn {
  const createdAt = (options.now ?? new Date()).toISOString();
  const createdBy = options.createdBy ?? "operator-config";
  const idGen = options.idGenerator ?? randomUUID;
  const strict = options.strict === true;

  const rules: RuntimeApprovalRule[] = [];
  const warnings: string[] = [];
  let accepted = 0;
  let rejected = 0;

  if (!config || typeof config !== "object") {
    if (strict && config !== undefined && config !== null) {
      throw new Error(
        `interruptOn config must be an object, got ${typeof config}`,
      );
    }
    return {
      rules,
      warnings,
      acceptedCount: 0,
      rejectedCount: 0,
    };
  }

  for (const [key, value] of Object.entries(config)) {
    if (typeof key !== "string" || key.length === 0) {
      const msg = `Empty key in interruptOn config — entry dropped.`;
      if (strict) throw new Error(msg);
      warnings.push(msg);
      rejected++;
      continue;
    }

    // Validate value shape.
    if (typeof value !== "string" && typeof value !== "object") {
      const msg = `interruptOn["${key}"] must be a string or object (got ${typeof value}) — entry dropped.`;
      if (strict) throw new Error(msg);
      warnings.push(msg);
      rejected++;
      continue;
    }

    if (typeof value === "string") {
      if (value !== "allow" && value !== "deny") {
        const msg = `interruptOn["${key}"] shorthand must be "allow" or "deny" (got "${value}") — entry dropped.`;
        if (strict) throw new Error(msg);
        warnings.push(msg);
        rejected++;
        continue;
      }
    } else {
      const validationError = validateRule(value);
      if (validationError) {
        const msg = `interruptOn["${key}"]: ${validationError} — entry dropped.`;
        if (strict) throw new Error(msg);
        warnings.push(msg);
        rejected++;
        continue;
      }
    }

    const rule = entryToRule(key, value, createdAt, createdBy, idGen);
    if (!rule) {
      // Defensive — entryToRule shouldn't return null after validation passes.
      const msg = `interruptOn["${key}"]: failed to build rule (unexpected).`;
      if (strict) throw new Error(msg);
      warnings.push(msg);
      rejected++;
      continue;
    }
    rules.push(rule);
    accepted++;
  }

  return {
    rules,
    warnings,
    acceptedCount: accepted,
    rejectedCount: rejected,
  };
}

/**
 * Convenience: produce a one-line summary of a ParsedInterruptOn for
 * logging or operator feedback.
 */
export function summarizeParsedInterruptOn(result: ParsedInterruptOn): string {
  const parts: string[] = [];
  parts.push(`${result.acceptedCount} rule${result.acceptedCount === 1 ? "" : "s"}`);
  if (result.rejectedCount > 0) {
    parts.push(`${result.rejectedCount} dropped`);
  }
  if (result.warnings.length > 0) {
    parts.push(`${result.warnings.length} warning${result.warnings.length === 1 ? "" : "s"}`);
  }
  return `interruptOn parsed: ${parts.join(", ")}.`;
}
