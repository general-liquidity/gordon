/**
 * Gordon Tool Routing Infrastructure — Type Definitions
 *
 * A "routing config" is an MCP plugin plus agent routing metadata.
 * The routing.json file lives alongside the existing manifest.json
 * in ~/.gordon/plugins/<pluginId>/routing.json.
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
  | "Critic"
  | "Auditor"
  | "Gordon";

/**
 * Per-tool agent affinity override.
 * Allows a single routing config to distribute tools across multiple agents.
 */
export interface ToolAgentMapping {
  /** Tool name as it appears in MCPServerManifest.tools (bare, not namespaced) */
  toolName: string;
  /** Which agent this tool should be assigned to */
  agent: AgentAffinity;
}

/**
 * Routing manifest — agent routing metadata for an MCP plugin.
 *
 * Stored at ~/.gordon/plugins/<pluginId>/routing.json.
 * If absent, the system falls back to defaultAgent: "Gordon" + alsoOnGordon: true
 * for backwards compatibility with plain MCP plugins.
 */
export interface RoutingManifest {
  /** Must match the MCPServerManifest.id */
  pluginId: string;
  /** Default agent for all tools in this routing config (if no per-tool overrides) */
  defaultAgent: AgentAffinity;
  /** Per-tool agent overrides. Takes precedence over defaultAgent. */
  toolAgentMap?: ToolAgentMapping[];
  /** Whether to also keep tools on Gordon (routing agent). Default: false. */
  alsoOnGordon?: boolean;
  /** Forward-compatible hints for future discovery. */
  searchHints?: string[];
}

/**
 * Resolved routing = MCP plugin + routing metadata.
 * This is what the routing manager works with internally.
 */
export interface ResolvedRouting {
  pluginId: string;
  routingManifest: RoutingManifest;
  enabled: boolean;
  toolCount: number;
}
