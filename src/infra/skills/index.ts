/**
 * Gordon Skills Infrastructure
 * Re-exports types and manager functions.
 */

export type {
  AgentAffinity,
  ToolAgentMapping,
  SkillManifest,
  ResolvedSkill,
} from "./types.ts";

export {
  initSkills,
  reloadSkills,
  getSkillToolsForAgent,
  getDynamicToolAgentMap,
  getResolvedSkills,
  isSkillsInitialized,
  writeSkillManifest,
} from "./manager.ts";
