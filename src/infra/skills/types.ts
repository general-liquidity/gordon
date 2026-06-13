/**
 * Gordon Skills System — Types
 *
 * Skills are user-authored reusable prompt templates with YAML frontmatter.
 * They bridge the gap between slash commands (developer-defined) and
 * natural language prompts (ephemeral).
 *
 * Claude Code pattern: SKILL.md files with frontmatter, discovered from
 * multiple directories, invocable by user (/skill-name) and by model.
 */

export interface SkillFrontmatter {
  name?: string;
  /**
   * Single combined description: WHAT the skill does + WHEN to use it +
   * literal user trigger phrases. Per Anthropic Agent Skills standard.
   * Authors should write the WHEN content inline rather than in a
   * separate field; the loader does not parse a `when_to_use` field.
   */
  description?: string;
  /** Argument names the skill accepts. */
  arguments?: string | string[];
  /** Hint text shown in typeahead. */
  argumentHint?: string;
  /** Tools the skill is allowed to use. */
  allowedTools?: string[];
  /** Model override for this skill. */
  model?: string;
  /** Can users invoke with /skill-name? Default true. */
  userInvocable?: boolean;
  /** Prevent the model from invoking this skill autonomously. */
  disableModelInvocation?: boolean;
  /** Execution context: inline (expand into chat) or fork (sub-agent). */
  context?: "inline" | "fork";
  /** Agent to route to (default: Gordon). */
  agent?: string;
  /** Tags for categorization. */
  tags?: string[];
  /** Version string. */
  version?: string;
  /**
   * License name or reference to a bundled license file (agentskills.io spec).
   * Optional. Useful when skills are published as standalone packages.
   */
  license?: string;
  /**
   * Environment requirements (intended product, system packages, network
   * access). Max 500 chars per agentskills.io spec. Optional.
   */
  compatibility?: string;
  /**
   * Arbitrary key-value map per agentskills.io spec. Clients can store
   * additional properties (author, version, last-updated, etc.) here.
   * Nested object parsing supported in the loader.
   */
  metadata?: Record<string, string>;

  // ────────────────────────────────────────────────────────────────
  // Governance fields (all optional, default-tolerant)
  //
  // Inspired by Mang Group's institutional skill-governance pattern.
  // None of these block loading — skills missing them default to
  // `experimental` + no review date, which the audit surface
  // highlights so the operator can backfill the governance metadata
  // as they review skills.
  // ────────────────────────────────────────────────────────────────

  /**
   * Lifecycle status. `active` = trusted/maintained; `experimental` =
   * default for new/unreviewed skills; `deprecated` = retain but
   * surface in audit as candidates for removal.
   */
  status?: SkillStatus;
  /** Skill owner — operator name, team, or "shared". Cosmetic but useful in audit reports. */
  owner?: string;
  /** ISO-8601 date string of the last operator review. Drives the staleness gate in audit. */
  lastReviewed?: string;
  /** ISO-8601 date string of skill creation. Useful for sorting / "added since" queries. */
  created?: string;
}

export type SkillStatus = "active" | "experimental" | "deprecated";

/**
 * Severity-tagged validation issue for a skill against the agentskills.io
 * formal spec. ERRORs cause the loader to skip the skill; WARNINGs are
 * logged but the skill still loads.
 */
export interface SkillValidationIssue {
  severity: "error" | "warning";
  field: string;
  message: string;
}

/**
 * Result of scanning a loaded skill's body/description for prompt injection.
 * Present on a Skill only when injection heuristics fired (loaded-but-flagged);
 * a skill blocked under the guard never becomes a Skill at all.
 */
export interface SkillSecurityScan {
  injectionDetected: boolean;
  riskLevel: "none" | "low" | "medium" | "high" | "critical";
  /** Matched injection categories (from injectionDefense). */
  categories: string[];
  reason?: string;
}

export interface Skill {
  /** Unique skill ID (directory name). */
  id: string;
  /** Display name (from frontmatter or directory name). */
  name: string;
  /** Combined description (WHAT + WHEN + triggers). */
  description: string;
  /** The prompt template body (markdown after frontmatter). */
  body: string;
  /** Parsed frontmatter. */
  frontmatter: SkillFrontmatter;
  /** Where this skill was loaded from. */
  source: SkillSource;
  /** Full file path. */
  filePath: string;
  /**
   * Non-blocking validation warnings against the agentskills.io spec.
   * ERRORs would have prevented loading; only WARN-level issues land here.
   * Empty array means fully compliant.
   */
  validationWarnings?: SkillValidationIssue[];
  /**
   * Prompt-injection scan result — present only on a non-builtin skill whose
   * body or description tripped the injection heuristics. The skill was loaded
   * anyway (warn mode); under GORDON_SKILL_INJECTION_GUARD a blocking match
   * prevents loading entirely, so this never carries a blocked verdict.
   */
  security?: SkillSecurityScan;
}

export type SkillSource =
  | "builtin"  // Shipped with Gordon
  | "user"     // ~/.gordon/skills/
  | "project"  // .gordon/skills/
  | "plugin";  // From MCP/plugin

export interface SkillInvocation {
  skillId: string;
  args: string;
  /** Resolved prompt to send to the agent. */
  prompt: string;
  /** Execution mode. */
  context: "inline" | "fork";
}
