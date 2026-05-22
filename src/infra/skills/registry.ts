/**
 * Skill Registry — Discover, cache, and resolve skills
 *
 * Loads from 3 tiers (later overrides earlier by skill ID):
 *   1. Builtin: src/infra/skills/builtin/
 *   2. User:    ~/.gordon/skills/
 *   3. Project: .gordon/skills/
 *
 * Claude Code pattern: memoized by CWD, multi-source discovery,
 * precedence chain with project > user > builtin.
 */

import { join, resolve } from "node:path";
import { GORDON_DIR } from "../storage/paths.ts";
import { discoverSkillsFromDir } from "./loader.ts";
import { recordSkillUsage } from "./usage-tracker.ts";
import type { Skill, SkillSource, SkillInvocation } from "./types.ts";

// ============================================================================
// Paths
// ============================================================================

const BUILTIN_SKILLS_DIR = resolve(join(import.meta.dir ?? ".", "builtin"));
const USER_SKILLS_DIR = join(GORDON_DIR, "skills");

function getProjectSkillsDir(cwd: string = process.cwd()): string {
  return join(cwd, ".gordon", "skills");
}

// ============================================================================
// Cache
// ============================================================================

let cachedSkills: Skill[] | null = null;
let cachedCwd: string | null = null;

/**
 * Discover all skills from all sources. Memoized by CWD.
 */
export function discoverSkills(cwd?: string): Skill[] {
  const effectiveCwd = cwd ?? process.cwd();
  if (cachedSkills && cachedCwd === effectiveCwd) return cachedSkills;

  const builtinSkills = discoverSkillsFromDir(BUILTIN_SKILLS_DIR, "builtin");
  const userSkills = discoverSkillsFromDir(USER_SKILLS_DIR, "user");
  const projectSkills = discoverSkillsFromDir(getProjectSkillsDir(effectiveCwd), "project");

  // Merge with precedence: project > user > builtin
  const byId = new Map<string, Skill>();
  for (const skill of builtinSkills) byId.set(skill.id, skill);
  for (const skill of userSkills) byId.set(skill.id, skill);
  for (const skill of projectSkills) byId.set(skill.id, skill);

  cachedSkills = [...byId.values()];
  cachedCwd = effectiveCwd;
  return cachedSkills;
}

/**
 * Invalidate the skill cache (e.g., after user creates a new skill).
 */
export function clearSkillCache(): void {
  cachedSkills = null;
  cachedCwd = null;
}

/**
 * Get a specific skill by ID or name.
 */
export function getSkill(nameOrId: string): Skill | undefined {
  const normalized = nameOrId.toLowerCase();
  return discoverSkills().find(
    (s) => s.id.toLowerCase() === normalized || s.name.toLowerCase() === normalized,
  );
}

/**
 * List skills that a specific agent should know about.
 */
export function listSkillsForAgent(agentName: string): Skill[] {
  return discoverSkills().filter((s) => {
    if (s.frontmatter.disableModelInvocation) return false;
    if (s.frontmatter.agent && s.frontmatter.agent !== agentName) return false;
    return true;
  });
}

/**
 * List user-invocable skills (for /skill typeahead).
 */
export function listUserInvocableSkills(): Skill[] {
  return discoverSkills().filter((s) => s.frontmatter.userInvocable !== false);
}

// ============================================================================
// Invocation
// ============================================================================

/**
 * Resolve a skill invocation: find the skill, substitute arguments,
 * and return the prompt to send to the agent.
 */
export function resolveSkillInvocation(
  skillName: string,
  args: string,
  source: "user" | "agent" | "test" = "user",
): SkillInvocation | null {
  const skill = getSkill(skillName);
  if (!skill) return null;

  // Record usage — silent on failure, gated by GORDON_SKILL_USAGE_DISABLED
  recordSkillUsage(skill.id, source);

  // Substitute arguments into the body
  let prompt = skill.body;
  const argNames = Array.isArray(skill.frontmatter.arguments)
    ? skill.frontmatter.arguments
    : skill.frontmatter.arguments
      ? [skill.frontmatter.arguments]
      : [];

  const argValues = args.split(/\s+/).filter(Boolean);
  for (let i = 0; i < argNames.length; i++) {
    const placeholder = `{${argNames[i]}}`;
    const value = argValues[i] ?? "";
    prompt = prompt.replace(placeholder, value);
  }

  // Also replace $1, $2, etc.
  for (let i = 0; i < argValues.length; i++) {
    prompt = prompt.replace(`$${i + 1}`, argValues[i]!);
  }

  return {
    skillId: skill.id,
    args,
    prompt,
    context: skill.frontmatter.context ?? "inline",
  };
}

/**
 * Build a metadata section for agent prompts listing available skills.
 */
export function buildSkillMetadataSection(agentName: string = "Gordon"): string {
  const skills = listSkillsForAgent(agentName);
  if (skills.length === 0) return "";

  const lines = ["[GORDON_AVAILABLE_SKILLS]"];
  for (const skill of skills) {
    // Single-field description per Anthropic Agent Skills standard.
    // Author is responsible for combining WHAT + WHEN + triggers in
    // the description field directly.
    lines.push(`- /${skill.id}: ${skill.description}`);
  }
  return lines.join("\n") + "\n";
}
