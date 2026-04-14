import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import {
  type ActionDefinition,
  discoverProviderCapabilities,
  getActionPromptExample,
  getCanonicalActions,
  getDerivedToolMetadata,
} from "../src/infra/runtime/actions/index.ts";
import { loadConfig } from "../src/infra/storage/config.ts";

async function main(): Promise<void> {
  const config = await loadConfig();
  const actions = getCanonicalActions();
  const toolMetadata = getDerivedToolMetadata();
  const capabilities = await discoverProviderCapabilities(config);

  const generatedDir = join(process.cwd(), "docs", "generated");
  await mkdir(generatedDir, { recursive: true });

  const actionPayload = actions.map((action: ActionDefinition) => ({
    id: action.id,
    title: action.title,
    description: action.description,
    domain: action.domain,
    capability: action.capability,
    taskScope: action.taskScope,
    sideEffectLevel: action.sideEffectLevel,
    approvalPolicy: action.approvalPolicy,
    dryRunSupported: action.dryRunSupported,
    visibility: action.visibility,
    providerRequirements: action.providerRequirements,
    slash: action.slash,
    tool: action.tool,
    cli: action.cli,
    promptExample: getActionPromptExample(action.id),
    tags: action.tags ?? [],
  }));

  const playbookMetadata = actions.map((action: ActionDefinition) => ({
    actionId: action.id,
    title: action.title,
    taskScope: action.taskScope,
    capability: action.capability,
    promptExample: getActionPromptExample(action.id),
    tags: action.tags ?? [],
  }));

  const markdownLines: string[] = [
    "# Canonical Gordon Actions",
    "",
    `Generated on ${new Date().toISOString()}.`,
    "",
    "## Actions",
    "",
  ];

  for (const action of actionPayload) {
    markdownLines.push(`### \`${action.id}\``);
    markdownLines.push("");
    markdownLines.push(action.description);
    markdownLines.push("");
    markdownLines.push(`- Domain: \`${action.domain}\``);
    markdownLines.push(`- Capability: \`${action.capability}\``);
    markdownLines.push(`- Task scope: \`${action.taskScope}\``);
    markdownLines.push(`- Side effects: \`${action.sideEffectLevel}\``);
    markdownLines.push(`- Approval: \`${action.approvalPolicy}\``);
    markdownLines.push(`- Dry run: \`${action.dryRunSupported}\``);
    markdownLines.push(`- Visibility: ${action.visibility.map((entry: string) => `\`${entry}\``).join(", ")}`);
    if (action.slash) {
      markdownLines.push(`- Slash: \`/${action.slash.name}\``);
      if (action.slash.workflow) {
        markdownLines.push(`- Workflow: \`${action.slash.workflow}\``);
      }
      if (action.slash.audience) {
        markdownLines.push(`- Audience: \`${action.slash.audience}\``);
      }
    }
    if (action.tool) {
      markdownLines.push(`- Tool: \`${action.tool.toolName}\``);
    }
    if (action.promptExample) {
      markdownLines.push(`- Example: \`${action.promptExample}\``);
    }
    markdownLines.push("");
  }

  markdownLines.push("## Derived Tool Metadata", "");
  for (const tool of toolMetadata) {
    markdownLines.push(`- \`${tool.toolName}\` -> \`${tool.actionId}\` (${tool.taskScope}, ${tool.sideEffectLevel})`);
  }

  markdownLines.push("", "## Provider Capability Discovery", "");
  for (const capability of capabilities) {
    const capabilityLabel = capability.integration
      ? [
        capability.integration.integrationDomain,
        capability.integration.venueKind,
        capability.integration.venueSubtype,
        capability.integration.sourceKind,
        capability.integration.providerKind,
        capability.integration.accessPath,
        capability.integration.railKind,
        capability.integration.infraKind,
        capability.integration.automationKind,
        capability.integration.taxonomyScope,
        capability.integration.parentSurfaceId
          ? `parent:${capability.integration.parentSurfaceId}`
          : undefined,
      ].filter(Boolean).join(" / ")
      : capability.providerKind;

    const capabilityName = capability.integration?.displayName ?? capability.providerId;
    markdownLines.push(
      `- \`${capabilityName}\` [${capabilityLabel}] supports ${capability.capabilities.length} capability binding(s)`,
    );
  }

  await Bun.write(join(generatedDir, "actions.md"), `${markdownLines.join("\n")}\n`);
  await Bun.write(join(generatedDir, "actions.json"), `${JSON.stringify(actionPayload, null, 2)}\n`);
  await Bun.write(join(generatedDir, "action-playbooks.json"), `${JSON.stringify(playbookMetadata, null, 2)}\n`);
}

await main();
