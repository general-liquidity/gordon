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
  SkillStatus,
  SkillValidationIssue,
} from "./types.ts";

// ── Governance ────────────────────────────────────────────────
export {
  assessSkillStaleness,
  skillStatus,
  summarizeSkillStatuses,
  skillsNeedingReview,
  type StalenessVerdict,
  type SkillStalenessOptions,
  type SkillStalenessResult,
  type SkillStatusBreakdown,
} from "./governance.ts";

// ── Usage tracking ────────────────────────────────────────────
export {
  recordSkillUsage,
  readSkillUsage,
  getSkillUsageStats,
  neverInvokedSkills,
  defaultSkillUsagePath,
  type SkillUsageRecord,
  type SkillUsageStats,
  type UsageReadOptions,
} from "./usage-tracker.ts";

// ── Audit ─────────────────────────────────────────────────────
export {
  runSkillAudit,
  formatAuditReport,
  type AuditVerdict,
  type SkillAuditReport,
  type AuditOptions,
} from "./audit.ts";
