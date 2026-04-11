/**
 * Skill Registry
 *
 * Loads skill markdown files from this directory. Each skill is a
 * self-contained guide the agent can load on demand via the `load_skill`
 * tool, inspired by Vibe-Trading's SKILL.md pattern. Decoupling skills
 * from the monolithic GORDON_INSTRUCTIONS has a few benefits:
 *
 *   - System prompt stays small; skill details load only when needed
 *   - Each skill can be developed, versioned, and documented in one file
 *   - Users get the same docs the agent reads, no duplication
 *   - New skills can be added without touching the base prompt
 *
 * Skill files live at src/infra/agents/skills/*.md. The filename (without
 * extension) is the skill id.
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createModuleLogger } from "../../logger/index.ts";

const logger = createModuleLogger("skill-registry");

// Resolve the skills directory relative to this file so it works whether
// we're running from src/ or from dist/
const SKILLS_DIR = dirname(fileURLToPath(import.meta.url));

export interface Skill {
  id: string;
  content: string;
  summary: string;
}

// Cache skills after first load — content is static per process lifetime
const skillCache = new Map<string, Skill>();

/** List all available skill ids by scanning the skills directory. */
export function listSkillIds(): string[] {
  try {
    if (!existsSync(SKILLS_DIR)) return [];
    return readdirSync(SKILLS_DIR)
      .filter((f) => f.endsWith(".md"))
      .map((f) => f.slice(0, -3))
      .sort();
  } catch (err) {
    logger.warn("Failed to list skills", { err: String(err) });
    return [];
  }
}

/** Load a skill by id. Returns null if not found. Cached after first load. */
export function loadSkill(id: string): Skill | null {
  if (skillCache.has(id)) return skillCache.get(id)!;
  const safe = id.replace(/[^a-z0-9-]/gi, "");
  if (!safe) return null;
  const path = join(SKILLS_DIR, `${safe}.md`);
  if (!existsSync(path)) return null;
  try {
    const content = readFileSync(path, "utf8");
    const summary = extractSummary(content);
    const skill: Skill = { id: safe, content, summary };
    skillCache.set(safe, skill);
    return skill;
  } catch (err) {
    logger.warn("Failed to load skill", { id: safe, err: String(err) });
    return null;
  }
}

/** Return skill summaries (first non-heading paragraph) for all skills. */
export function listSkillSummaries(): Array<{ id: string; summary: string }> {
  return listSkillIds()
    .map((id) => loadSkill(id))
    .filter((s): s is Skill => s !== null)
    .map((s) => ({ id: s.id, summary: s.summary }));
}

function extractSummary(content: string): string {
  const lines = content.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("#")) continue;
    return trimmed.slice(0, 300);
  }
  return "";
}
