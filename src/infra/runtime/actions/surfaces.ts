import { getCanonicalActions, getActionBySlashName, getActionByToolName } from "./registry.ts";
import type { ActionDefinition, SlashActionSurface } from "./types.ts";

export interface DerivedToolMetadata {
  actionId: string;
  toolName: string;
  description: string;
  taskScope: ActionDefinition["taskScope"];
  approvalPolicy: ActionDefinition["approvalPolicy"];
  sideEffectLevel: ActionDefinition["sideEffectLevel"];
  agentTarget?: string;
}

export function getGeneratedSlashCommands(): SlashActionSurface[] {
  return getCanonicalActions()
    .flatMap((action) => (action.slash ? [action.slash] : []));
}

export function mergeSlashCommands<T extends { name: string; aliases: string[] }>(
  generated: T[],
  legacy: T[],
): T[] {
  const merged: T[] = [];
  const seen = new Set<string>();

  for (const command of [...generated, ...legacy]) {
    const primary = command.name.toLowerCase();
    if (seen.has(primary)) {
      continue;
    }
    seen.add(primary);
    merged.push(command);
  }

  return merged;
}

export function getDerivedToolMetadata(): DerivedToolMetadata[] {
  return getCanonicalActions()
    .flatMap((action) => action.tool ? [{
      actionId: action.id,
      toolName: action.tool.toolName,
      description: action.tool.description,
      taskScope: action.taskScope,
      approvalPolicy: action.approvalPolicy,
      sideEffectLevel: action.sideEffectLevel,
      agentTarget: action.tool.agentTarget,
    }] : []);
}

export function getDerivedToolMetadataByName(toolName: string): DerivedToolMetadata | undefined {
  const action = getActionByToolName(toolName);
  if (!action?.tool) return undefined;
  return {
    actionId: action.id,
    toolName: action.tool.toolName,
    description: action.tool.description,
    taskScope: action.taskScope,
    approvalPolicy: action.approvalPolicy,
    sideEffectLevel: action.sideEffectLevel,
    agentTarget: action.tool.agentTarget,
  };
}

export function buildGeneratedPrompt(commandName: string, args: string): string | null {
  const action = getActionBySlashName(commandName);
  if (!action) return null;
  return action.prompt({ args });
}

export function getActionPromptExample(actionId: string): string | null {
  const action = getCanonicalActions().find((entry) => entry.id === actionId);
  if (!action?.slash) return null;
  const usage = action.slash.usage.replace(/^\//, "");
  return `/${usage}`;
}
