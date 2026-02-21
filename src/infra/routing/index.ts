/**
 * Gordon Tool Routing Infrastructure
 * Re-exports types and manager functions.
 */

export type {
  AgentAffinity,
  ToolAgentMapping,
  RoutingManifest,
  ResolvedRouting,
} from "./types.ts";

export {
  initRouting,
  reloadRouting,
  getRoutingToolsForAgent,
  getDynamicToolAgentMap,
  getResolvedRoutings,
  isRoutingInitialized,
  writeRoutingManifest,
} from "./manager.ts";
