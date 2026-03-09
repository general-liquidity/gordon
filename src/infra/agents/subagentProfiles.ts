export interface CompiledSubagentProfile {
  agentName: string;
  allowedTools: string[];
  allowedTargets: string[];
}

export function compileSubagentProfiles(
  staticToolAgentMap: Record<string, string>,
  validHandoffRules: Record<string, string[]>,
  dynamicToolAgentMap: Record<string, string> = {},
): Record<string, CompiledSubagentProfile> {
  const combinedToolMap = {
    ...staticToolAgentMap,
    ...dynamicToolAgentMap,
  };

  const profiles: Record<string, CompiledSubagentProfile> = {};

  for (const [agentName, allowedTargets] of Object.entries(validHandoffRules)) {
    const allowedTools = Object.entries(combinedToolMap)
      .filter(([, owner]) => owner === agentName)
      .map(([toolName]) => toolName)
      .sort();

    profiles[agentName] = {
      agentName,
      allowedTools,
      allowedTargets: [...allowedTargets],
    };
  }

  return profiles;
}

export function isToolAllowedForAgent(
  profiles: Record<string, CompiledSubagentProfile>,
  agentName: string,
  toolName: string,
): boolean {
  const profile = profiles[agentName];
  if (!profile) {
    return false;
  }
  return profile.allowedTools.includes(toolName);
}
