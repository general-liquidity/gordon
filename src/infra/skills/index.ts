/**
 * Gordon Skills System
 *
 * User-extensible prompt templates with YAML frontmatter.
 * Three tiers: builtin → user (~/.gordon/skills/) → project (.gordon/skills/)
 */

export {
  discoverSkills,
  getSkill,
  listSkillsForAgent,
  listUserInvocableSkills,
  clearSkillCache,
  resolveSkillInvocation,
  buildSkillMetadataSection,
} from "./registry.ts";

export {
  loadSkillFromFile,
  discoverSkillsFromDir,
} from "./loader.ts";

export type {
  Skill,
  SkillFrontmatter,
  SkillSource,
  SkillInvocation,
} from "./types.ts";
