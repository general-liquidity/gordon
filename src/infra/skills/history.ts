/**
 * Skill version history — append-only snapshot log per skill.
 *
 * Skills are SKILL.md files that change over time as operators refine
 * recipes (and as future automation, like SkillOpt-style optimization,
 * proposes edits). Git captures source-controlled history, but not
 * runtime edits or the rationale for changes. This module records a
 * snapshot of the SKILL.md text every time a change is recorded, so
 * the operator can diff, audit, and roll back.
 *
 * Layout:
 *   ~/.gordon/skills/history/<skill-id>/
 *     index.json                         — ordered list of snapshots
 *     <timestamp>-<short-hash>.md        — one snapshot per change
 *
 * Snapshots are immutable. The index carries the change reason +
 * the diff stat. Roll-back is "read the snapshot and write the file"
 * — no in-place mutation of historical artifacts.
 */

import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createModuleLogger } from "../logger/index.ts";

const logger = createModuleLogger("skill-history");

export interface SkillSnapshot {
  /** Skill id (directory name, kebab-case). */
  skillId: string;
  /** ISO timestamp of the snapshot. */
  takenAt: string;
  /** First 12 chars of sha256(content). Filename suffix + diff identity. */
  contentHash: string;
  /** Relative path to the snapshot file within the history dir. */
  filename: string;
  /** Free-form reason for the change ("manual edit", "ace lesson distilled", etc.). */
  reason: string;
  /** Byte length of the snapshot. */
  bytes: number;
  /** Line count of the snapshot. */
  lines: number;
}

export interface SkillHistoryIndex {
  version: 1;
  skillId: string;
  snapshots: SkillSnapshot[];
}

export function getSkillHistoryRoot(): string {
  const override = process.env.GORDON_SKILL_HISTORY_PATH;
  if (override && override.trim()) return override;
  return join(homedir(), ".gordon", "skills", "history");
}

function skillDir(skillId: string): string {
  return join(getSkillHistoryRoot(), skillId);
}

function indexPath(skillId: string): string {
  return join(skillDir(skillId), "index.json");
}

function ensureDir(path: string): void {
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
}

function emptyIndex(skillId: string): SkillHistoryIndex {
  return { version: 1, skillId, snapshots: [] };
}

function loadIndex(skillId: string): SkillHistoryIndex {
  const path = indexPath(skillId);
  if (!existsSync(path)) return emptyIndex(skillId);
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as Partial<SkillHistoryIndex>;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.snapshots)) {
      return emptyIndex(skillId);
    }
    return {
      version: 1,
      skillId,
      snapshots: parsed.snapshots,
    };
  } catch (error) {
    logger.warn("Failed to load skill history index — starting fresh", {
      skillId,
      error: (error as Error).message,
    });
    return emptyIndex(skillId);
  }
}

function saveIndex(index: SkillHistoryIndex): void {
  const dir = skillDir(index.skillId);
  ensureDir(dir);
  writeFileSync(indexPath(index.skillId), JSON.stringify(index, null, 2), "utf8");
}

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 12);
}

function timestampSlug(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

/**
 * Record a snapshot of the given SKILL.md content under the given skill id.
 *
 * No-op when the new content's hash matches the latest snapshot's hash —
 * recording the same content twice is wasted bytes. Returns the snapshot
 * record either way (the latest existing one, if the no-op path runs).
 */
export function recordSkillSnapshot(input: {
  skillId: string;
  content: string;
  reason: string;
}): SkillSnapshot {
  const { skillId, content, reason } = input;
  const contentHash = hashContent(content);
  const index = loadIndex(skillId);
  const latest = index.snapshots[index.snapshots.length - 1];
  if (latest && latest.contentHash === contentHash) {
    return latest;
  }
  const dir = skillDir(skillId);
  ensureDir(dir);
  const ts = timestampSlug();
  const filename = `${ts}-${contentHash}.md`;
  writeFileSync(join(dir, filename), content, "utf8");
  const snapshot: SkillSnapshot = {
    skillId,
    takenAt: new Date().toISOString(),
    contentHash,
    filename,
    reason,
    bytes: content.length,
    lines: content.split("\n").length,
  };
  index.snapshots.push(snapshot);
  saveIndex(index);
  logger.info("Recorded skill snapshot", { skillId, contentHash, reason });
  return snapshot;
}

/** Return the index for a skill (oldest → newest snapshots). */
export function listSkillHistory(skillId: string): SkillHistoryIndex {
  return loadIndex(skillId);
}

/** Load the content of a specific snapshot. Returns null if missing. */
export function loadSkillSnapshot(skillId: string, filename: string): string | null {
  const path = join(skillDir(skillId), filename);
  if (!existsSync(path)) return null;
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    logger.warn("Failed to load skill snapshot", {
      skillId,
      filename,
      error: (error as Error).message,
    });
    return null;
  }
}

/** Enumerate every skill that has at least one recorded snapshot. */
export function listSkillsWithHistory(): string[] {
  const root = getSkillHistoryRoot();
  if (!existsSync(root)) return [];
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }
}
