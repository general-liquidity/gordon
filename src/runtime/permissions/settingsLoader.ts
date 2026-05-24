/**
 * Settings Loader — FW5b (Deep Agents parity, loader layer).
 *
 * Reads operator-authored `.claude/settings.json` files (project-level
 * + user-level) and extracts the `interruptOn` block, feeding it through
 * the FW5a `parseInterruptOnConfig` parser to produce
 * `RuntimeApprovalRule[]` for registration with the runtime store.
 *
 * Loading precedence (matches Anthropic .claude/settings convention):
 *   1. Project-level: <projectRoot>/.claude/settings.json
 *   2. User-level:    ~/.claude/settings.json
 *
 * Project rules win on conflict — when both files contain the same key,
 * the project entry is taken and the user entry is dropped with a
 * warning. This mirrors how Anthropic's own settings layering works
 * (project > user > defaults).
 *
 * Robustness:
 *   - Missing files: silently skipped (no warning — operator may not
 *     have authored one)
 *   - Malformed JSON: file skipped, warning emitted with path
 *   - Settings without `interruptOn` field: file skipped, no warning
 *   - `interruptOn` not an object: warning emitted, file skipped
 *
 * Pure-ish I/O: file reads are real, but the function takes an optional
 * `paths` override for deterministic testing (no I/O when test paths
 * are supplied + a `readFileSync` override).
 *
 * Wiring this into runtime-store init is left to the call site (e.g.,
 * the agents/runtime startup path). This module just produces rules +
 * warnings + provenance.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  parseInterruptOnConfig,
  summarizeParsedInterruptOn,
  type InterruptOnConfig,
  type ParsedInterruptOn,
} from "./interruptOnConfig.ts";
import type { RuntimeApprovalRule } from "../contracts/types.ts";

export interface SettingsSourceFile {
  /** Resolved absolute path. */
  path: string;
  /** Origin label — "project" or "user" — used for provenance + precedence. */
  origin: "project" | "user";
}

export interface LoadSettingsOptions {
  /** Project root. Default: process.cwd(). */
  projectRoot?: string;
  /** User home directory. Default: homedir(). */
  userHome?: string;
  /**
   * Override the source files entirely (used by tests). When supplied,
   * the function reads these paths instead of the conventional ones.
   */
  sources?: ReadonlyArray<SettingsSourceFile>;
  /**
   * Optional in-memory file content map for deterministic testing.
   * Keys are absolute paths matching `sources[].path`. When a path
   * matches a key, the in-memory content is used instead of disk.
   */
  fileContent?: ReadonlyMap<string, string>;
  /** Strict mode propagates to parseInterruptOnConfig. Default false. */
  strict?: boolean;
  /** createdBy attribution. Default "settings.json:<origin>". */
  createdByOverride?: string;
}

export interface LoadedSettingsResult {
  /** Resolved rules, with project rules winning over user on conflict. */
  rules: RuntimeApprovalRule[];
  /** All warnings emitted during loading and parsing. */
  warnings: string[];
  /** Per-source-file breakdown. */
  sources: Array<{
    path: string;
    origin: "project" | "user";
    /** False when the file did not exist on disk / in the override map. */
    found: boolean;
    /** True when JSON parsed successfully. */
    parsed: boolean;
    /** Number of interruptOn entries accepted from this source. */
    accepted: number;
    /** Number rejected from this source. */
    rejected: number;
    /** True when the file had no interruptOn field. */
    hadInterruptOn: boolean;
  }>;
  /** Total accepted across all sources after conflict resolution. */
  totalAccepted: number;
  /** Total rejected (parser failures + dropped-on-conflict). */
  totalRejected: number;
}

function defaultSources(
  projectRoot: string,
  userHome: string,
): SettingsSourceFile[] {
  return [
    {
      path: join(projectRoot, ".claude", "settings.json"),
      origin: "project",
    },
    {
      path: join(userHome, ".claude", "settings.json"),
      origin: "user",
    },
  ];
}

function readSourceContent(
  source: SettingsSourceFile,
  fileContent: ReadonlyMap<string, string> | undefined,
): { found: boolean; content?: string; readError?: string } {
  if (fileContent?.has(source.path)) {
    return { found: true, content: fileContent.get(source.path) };
  }
  if (!existsSync(source.path)) {
    return { found: false };
  }
  try {
    return { found: true, content: readFileSync(source.path, "utf8") };
  } catch (err) {
    return {
      found: true,
      readError: err instanceof Error ? err.message : String(err),
    };
  }
}

function extractInterruptOn(
  parsed: unknown,
): { interruptOn?: InterruptOnConfig; warning?: string } {
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { warning: "settings root must be a JSON object" };
  }
  const root = parsed as Record<string, unknown>;
  const value = root.interruptOn;
  if (value === undefined) {
    return {}; // no field — silently skip
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return {
      warning: `interruptOn must be an object (got ${
        value === null ? "null" : Array.isArray(value) ? "array" : typeof value
      })`,
    };
  }
  return { interruptOn: value as InterruptOnConfig };
}

function ruleKey(rule: RuntimeApprovalRule): string {
  return rule.toolName ?? rule.toolNamePattern ?? "<no-key>";
}

/**
 * Load `.claude/settings.json` files and extract approval rules from
 * the `interruptOn` field. Project-level rules win over user-level on
 * matching keys.
 *
 * The returned rules are NOT registered with any runtime store — the
 * caller is responsible for calling `runtimeStore.setApprovalState({
 * rules: [...existing, ...loaded.rules] })` or equivalent.
 */
export function loadOperatorSettings(
  options: LoadSettingsOptions = {},
): LoadedSettingsResult {
  const projectRoot = options.projectRoot ?? process.cwd();
  const userHome = options.userHome ?? homedir();
  const sources =
    options.sources ?? defaultSources(projectRoot, userHome);

  const warnings: string[] = [];
  const perSource: LoadedSettingsResult["sources"] = [];
  const seenKeys = new Set<string>();
  const accumulatedRules: RuntimeApprovalRule[] = [];
  let totalAcceptedAfterConflicts = 0;
  let totalRejected = 0;

  // Process project first so it wins on conflicts.
  const sorted = [...sources].sort((a, b) =>
    a.origin === b.origin ? 0 : a.origin === "project" ? -1 : 1,
  );

  for (const source of sorted) {
    const sourceEntry = {
      path: source.path,
      origin: source.origin,
      found: false,
      parsed: false,
      accepted: 0,
      rejected: 0,
      hadInterruptOn: false,
    };

    const read = readSourceContent(source, options.fileContent);
    if (!read.found) {
      perSource.push(sourceEntry);
      continue;
    }
    sourceEntry.found = true;

    if (read.readError) {
      warnings.push(
        `Could not read ${source.path} (${source.origin}): ${read.readError}`,
      );
      perSource.push(sourceEntry);
      continue;
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(read.content ?? "");
      sourceEntry.parsed = true;
    } catch (err) {
      warnings.push(
        `Malformed JSON in ${source.path} (${source.origin}): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      perSource.push(sourceEntry);
      continue;
    }

    const { interruptOn, warning } = extractInterruptOn(parsedJson);
    if (warning) {
      warnings.push(`${source.path} (${source.origin}): ${warning}`);
      perSource.push(sourceEntry);
      continue;
    }
    if (!interruptOn) {
      perSource.push(sourceEntry);
      continue;
    }
    sourceEntry.hadInterruptOn = true;

    const createdBy =
      options.createdByOverride ?? `settings.json:${source.origin}`;
    const parsed: ParsedInterruptOn = parseInterruptOnConfig(interruptOn, {
      createdBy,
      strict: options.strict,
    });

    // Apply per-source warnings with provenance.
    for (const w of parsed.warnings) {
      warnings.push(`${source.path} (${source.origin}): ${w}`);
    }
    sourceEntry.accepted = parsed.acceptedCount;
    sourceEntry.rejected = parsed.rejectedCount;
    totalRejected += parsed.rejectedCount;

    // Resolve conflicts: project rules already in seenKeys win; user
    // rules with the same key are dropped.
    for (const rule of parsed.rules) {
      const key = ruleKey(rule);
      if (seenKeys.has(key)) {
        warnings.push(
          `${source.path} (${source.origin}): rule "${key}" dropped — already defined by an earlier source.`,
        );
        totalRejected++;
        continue;
      }
      seenKeys.add(key);
      accumulatedRules.push(rule);
      totalAcceptedAfterConflicts++;
    }

    perSource.push(sourceEntry);
  }

  return {
    rules: accumulatedRules,
    warnings,
    sources: perSource,
    totalAccepted: totalAcceptedAfterConflicts,
    totalRejected,
  };
}

/**
 * One-line operator-facing summary of a loaded settings result.
 */
export function summarizeLoadedSettings(result: LoadedSettingsResult): string {
  const sourcesFound = result.sources.filter((s) => s.found).length;
  const totalSources = result.sources.length;
  const parts = [
    `${result.totalAccepted} rule${result.totalAccepted === 1 ? "" : "s"}`,
  ];
  if (result.totalRejected > 0) parts.push(`${result.totalRejected} dropped`);
  if (result.warnings.length > 0) {
    parts.push(`${result.warnings.length} warning${result.warnings.length === 1 ? "" : "s"}`);
  }
  return `operator settings loaded from ${sourcesFound}/${totalSources} sources: ${parts.join(", ")}.`;
}

/**
 * Reuse FW5a summarizer when caller only has the ParsedInterruptOn
 * shape (e.g., re-running through parseInterruptOnConfig after manual
 * filtering). Re-exported for convenience.
 */
export { summarizeParsedInterruptOn };
