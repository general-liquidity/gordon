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
}

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
