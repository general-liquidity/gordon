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
  description?: string;
  /** When the model should auto-invoke this skill. */
  whenToUse?: string;
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
}

export interface Skill {
  /** Unique skill ID (directory name). */
  id: string;
  /** Display name (from frontmatter or directory name). */
  name: string;
  /** Description for help/typeahead. */
  description: string;
  /** When the model should use this skill. */
  whenToUse?: string;
  /** The prompt template body (markdown after frontmatter). */
  body: string;
  /** Parsed frontmatter. */
  frontmatter: SkillFrontmatter;
  /** Where this skill was loaded from. */
  source: SkillSource;
  /** Full file path. */
  filePath: string;
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
