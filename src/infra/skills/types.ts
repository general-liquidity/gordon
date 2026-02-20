/**
 * Gordon Skills Infrastructure — Type Definitions
 *
 * A "skill" is an MCP plugin plus agent routing metadata.
 * The skill.json file lives alongside the existing manifest.json
 * in ~/.gordon/plugins/<pluginId>/skill.json.
 */

/**
 * Valid Gordon sub-agent names that tools can be assigned to.
 */
export type AgentAffinity =
  | "Scanner"
  | "Analyst"
  | "Planner"
  | "Executor"
  | "Monitor"
  | "Teacher"
  | "Backtester"
  | "Gordon";

/**
 * Per-tool agent affinity override.
 * Allows a single skill to distribute tools across multiple agents.
 */
export interface ToolAgentMapping {
  /** Tool name as it appears in MCPServerManifest.tools (bare, not namespaced) */
  toolName: string;
  /** Which agent this tool should be assigned to */
  agent: AgentAffinity;
}

/**
 * Skill manifest — agent routing metadata for an MCP plugin.
 *
 * Stored at ~/.gordon/plugins/<pluginId>/skill.json.
 * If absent, the system falls back to defaultAgent: "Gordon" + alsoOnGordon: true
 * for backwards compatibility with plain MCP plugins.
 */
export interface SkillManifest {
  /** Must match the MCPServerManifest.id */
  pluginId: string;
  /** Default agent for all tools in this skill (if no per-tool overrides) */
  defaultAgent: AgentAffinity;
  /** Per-tool agent overrides. Takes precedence over defaultAgent. */
  toolAgentMap?: ToolAgentMapping[];
  /** Whether to also keep tools on Gordon (routing agent). Default: false. */
  alsoOnGordon?: boolean;
  /** Forward-compatible hints for future ToolSearchProcessor discovery. */
  searchHints?: string[];
}

/**
 * Resolved skill = MCP plugin + skill routing metadata.
 * This is what the SkillManager works with internally.
 */
export interface ResolvedSkill {
  pluginId: string;
  skillManifest: SkillManifest;
  enabled: boolean;
  toolCount: number;
}
