/**
 * Skill Loader — Parse SKILL.md files and discover from directories
 *
 * Claude Code pattern: YAML frontmatter + markdown body, discovered from
 * ~/.gordon/skills/, .gordon/skills/, and builtin paths.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import type { Skill, SkillFrontmatter, SkillSource } from "./types.ts";

// ============================================================================
// YAML Frontmatter Parser (lightweight, no dependency)
// ============================================================================

function parseFrontmatter(content: string): { frontmatter: Record<string, unknown>; body: string } {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: content };

  const yamlBlock = match[1]!;
  const body = match[2]!;
  const frontmatter: Record<string, unknown> = {};

  for (const line of yamlBlock.split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    let value: unknown = line.slice(colonIdx + 1).trim();

    // Parse arrays: [a, b, c]
    if (typeof value === "string" && value.startsWith("[") && value.endsWith("]")) {
      value = value.slice(1, -1).split(",").map((s) => s.trim());
    }
    // Parse booleans
    if (value === "true") value = true;
    if (value === "false") value = false;

    frontmatter[key] = value;
  }

  return { frontmatter, body };
}

function toFrontmatter(raw: Record<string, unknown>): SkillFrontmatter {
  return {
    name: raw.name as string | undefined,
    description: raw.description as string | undefined,
    arguments: raw.arguments as string | string[] | undefined,
    argumentHint: (raw["argument-hint"] ?? raw.argumentHint) as string | undefined,
    allowedTools: (raw["allowed-tools"] ?? raw.allowedTools) as string[] | undefined,
    model: raw.model as string | undefined,
    userInvocable: (raw["user-invocable"] ?? raw.userInvocable ?? true) as boolean,
    disableModelInvocation: (raw["disable-model-invocation"] ?? raw.disableModelInvocation) as boolean | undefined,
    context: raw.context as "inline" | "fork" | undefined,
    agent: raw.agent as string | undefined,
    tags: raw.tags as string[] | undefined,
    version: raw.version as string | undefined,
  };
}

// ============================================================================
// Single File Loader
// ============================================================================

export function loadSkillFromFile(filePath: string, source: SkillSource): Skill | null {
  if (!existsSync(filePath)) return null;
  try {
    const raw = readFileSync(filePath, "utf-8");
    const { frontmatter, body } = parseFrontmatter(raw);
    const fm = toFrontmatter(frontmatter);
    const dirName = basename(join(filePath, ".."));
    const id = fm.name ?? dirName;

    return {
      id,
      name: fm.name ?? dirName,
      description: fm.description ?? "",
      body,
      frontmatter: fm,
      source,
      filePath,
    };
  } catch {
    return null;
  }
}

// ============================================================================
// Directory Discovery
// ============================================================================

/**
 * Discover all SKILL.md files in a skills directory.
 * Each skill lives in its own subdirectory: skills/my-skill/SKILL.md
 */
export function discoverSkillsFromDir(dir: string, source: SkillSource): Skill[] {
  if (!existsSync(dir)) return [];

  const skills: Skill[] = [];
  try {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      const entryPath = join(dir, entry);
      if (!statSync(entryPath).isDirectory()) continue;

      const skillFile = join(entryPath, "SKILL.md");
      const skill = loadSkillFromFile(skillFile, source);
      if (skill) skills.push(skill);
    }
  } catch {
    // Non-critical — directory may not be readable
  }

  return skills;
}
