/**
 * Skill Usage Tracker — JSONL-backed per-skill invocation log.
 *
 * Operator-facing answer to "which skills do I actually use?"
 * Append-only JSONL at ~/.gordon/skill-usage.jsonl, same persistence
 * pattern as trade ledger + agent-feedback.
 *
 * Wired into `resolveSkillInvocation` so every user-triggered skill
 * call records a row. Model-invoked skills (when the agent chooses
 * a skill autonomously) are tracked via the same path — see the
 * registry's invocation logic.
 *
 * Privacy + scope:
 *   - Records skillId + timestamp + source + optional context tag
 *   - Does NOT record skill arguments by default (operator data)
 *   - Override via `GORDON_SKILL_USAGE_PATH` env for testing
 *   - Disable entirely with `GORDON_SKILL_USAGE_DISABLED=1`
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { GORDON_DIR } from "../storage/paths.ts";

export interface SkillUsageRecord {
  /** ISO-8601 timestamp. */
  timestamp: string;
  /** Skill ID (matches Skill.id). */
  skillId: string;
  /** "user" (slash command), "agent" (model-invoked), "test" (eval harness). */
  source: "user" | "agent" | "test";
  /** Optional tag — operator-defined context label. */
  context?: string;
}

export interface SkillUsageStats {
  skillId: string;
  totalInvocations: number;
  /** Invocations in the last `windowDays` days. */
  recentInvocations: number;
  lastInvoked: string | null;
  bySource: Record<string, number>;
}

export interface UsageReadOptions {
  /** Override path (test-only). Defaults to `~/.gordon/skill-usage.jsonl`. */
  path?: string;
  /** Window for "recent" rollup in days. Default 30. */
  windowDays?: number;
  /** Reference time (defaults to now — useful for deterministic tests). */
  now?: Date;
}

const DEFAULT_WINDOW_DAYS = 30;

/**
 * Default JSONL path. Override via GORDON_SKILL_USAGE_PATH.
 */
export function defaultSkillUsagePath(): string {
  return process.env.GORDON_SKILL_USAGE_PATH ?? join(GORDON_DIR, "skill-usage.jsonl");
}

function isDisabled(): boolean {
  return process.env.GORDON_SKILL_USAGE_DISABLED === "1";
}

/**
 * Append a skill invocation record. Silent on I/O failure — usage
 * tracking is a diagnostic, not a critical path; a tracker outage
 * must not break skill invocation.
 */
export function recordSkillUsage(
  skillId: string,
  source: SkillUsageRecord["source"] = "user",
  context?: string,
  pathOverride?: string,
): void {
  if (isDisabled()) return;
  try {
    const record: SkillUsageRecord = {
      timestamp: new Date().toISOString(),
      skillId,
      source,
      ...(context !== undefined && { context }),
    };
    const filePath = pathOverride ?? defaultSkillUsagePath();
    const dir = dirname(filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    appendFileSync(filePath, JSON.stringify(record) + "\n");
  } catch {
    // swallow — usage tracking must not fail the invocation
  }
}

/**
 * Read all usage records from the ledger. Returns empty array on
 * missing file. Malformed lines are skipped silently.
 */
export function readSkillUsage(pathOverride?: string): SkillUsageRecord[] {
  const filePath = pathOverride ?? defaultSkillUsagePath();
  if (!existsSync(filePath)) return [];
  try {
    const raw = readFileSync(filePath, "utf-8");
    const records: SkillUsageRecord[] = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line) as SkillUsageRecord;
        if (parsed.skillId && parsed.timestamp) {
          records.push(parsed);
        }
      } catch {
        // skip malformed
      }
    }
    return records;
  } catch {
    return [];
  }
}

/**
 * Aggregate per-skill usage statistics over the ledger.
 *
 * Returned array is sorted by `recentInvocations` descending (most
 * actively used in the window first) with totalInvocations as the
 * tiebreaker.
 */
export function getSkillUsageStats(options: UsageReadOptions = {}): SkillUsageStats[] {
  const records = readSkillUsage(options.path);
  const windowDays = options.windowDays ?? DEFAULT_WINDOW_DAYS;
  const now = options.now ?? new Date();
  const windowCutoff = now.getTime() - windowDays * 24 * 60 * 60 * 1000;

  const bySkill = new Map<string, SkillUsageStats>();
  for (const record of records) {
    const ts = new Date(record.timestamp).getTime();
    if (Number.isNaN(ts)) continue;

    let stats = bySkill.get(record.skillId);
    if (!stats) {
      stats = {
        skillId: record.skillId,
        totalInvocations: 0,
        recentInvocations: 0,
        lastInvoked: null,
        bySource: {},
      };
      bySkill.set(record.skillId, stats);
    }
    stats.totalInvocations++;
    if (ts >= windowCutoff) stats.recentInvocations++;
    if (!stats.lastInvoked || record.timestamp > stats.lastInvoked) {
      stats.lastInvoked = record.timestamp;
    }
    stats.bySource[record.source] = (stats.bySource[record.source] ?? 0) + 1;
  }

  const result = Array.from(bySkill.values());
  result.sort((a, b) => {
    if (b.recentInvocations !== a.recentInvocations) {
      return b.recentInvocations - a.recentInvocations;
    }
    return b.totalInvocations - a.totalInvocations;
  });
  return result;
}

/**
 * List skills that have NEVER been invoked according to the usage
 * ledger. Useful for the audit "dead weight" surface.
 *
 * @param allSkillIds The set of skill IDs from the registry — anything
 *                    not in this set is treated as a stale entry from
 *                    a deleted skill and excluded.
 */
export function neverInvokedSkills(
  allSkillIds: string[],
  options: UsageReadOptions = {},
): string[] {
  const stats = getSkillUsageStats(options);
  const invokedIds = new Set(stats.filter((s) => s.totalInvocations > 0).map((s) => s.skillId));
  return allSkillIds.filter((id) => !invokedIds.has(id));
}
