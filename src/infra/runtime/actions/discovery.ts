import type { GordonConfig } from "../../types/index.ts";
import { BrokerFactory } from "../../broker/factory.ts";
import { ExchangeFactory } from "../../exchange/factory.ts";
import {
  getExecutionVenueMetadata,
  getIntegrationSurfaceMetadata,
} from "../../domain/integrations/taxonomy.ts";
import { pluginInstaller } from "../../ai/mcp/marketplace/installer.ts";
import { createAgentRailsRegistry } from "../rails/registry.ts";
import { getCanonicalActions } from "./registry.ts";
import type { CapabilitySnapshot } from "./types.ts";

function actionCapabilitiesForKind(kind: CapabilitySnapshot["providerKind"]): string[] {
  return getCanonicalActions()
    .filter((action) => action.providerRequirements.some((requirement) => requirement.kind === kind))
    .map((action) => action.id)
    .sort();
}

export async function discoverProviderCapabilities(config: GordonConfig): Promise<CapabilitySnapshot[]> {
  const snapshots: CapabilitySnapshot[] = [];

  for (const exchangeId of ExchangeFactory.getSupportedExchanges()) {
    const integration = getExecutionVenueMetadata(exchangeId);
    snapshots.push({
      providerId: exchangeId,
      providerKind: "exchange",
      label: integration.displayName,
      supportsExecution: true,
      capabilities: actionCapabilitiesForKind("exchange"),
      notes: ["Execution remains behind Gordon-native normalized exchange adapters."],
      integration,
    });
  }

  for (const brokerId of BrokerFactory.getSupportedBrokers()) {
    const integration = getExecutionVenueMetadata(brokerId);
    snapshots.push({
      providerId: brokerId,
      providerKind: "broker",
      label: integration.displayName,
      supportsExecution: true,
      capabilities: actionCapabilitiesForKind("broker"),
      notes: ["Read-only discovery is allowed; live broker operations stay behind normalized broker adapters."],
      integration,
    });
  }

  for (const providerId of ["openai", "anthropic", "google", "inception", "dedalus"] as const) {
    snapshots.push({
      providerId,
      providerKind: "llm",
      label: getIntegrationSurfaceMetadata(providerId).displayName,
      supportsExecution: false,
      capabilities: actionCapabilitiesForKind("llm"),
      notes: providerId === "dedalus"
        ? ["Multi-model gateway parent for routed model catalogs."]
        : ["Native model provider surface."],
      integration: getIntegrationSurfaceMetadata(providerId),
    });
  }

  for (const routedId of ["dedalus/openai", "dedalus/anthropic", "dedalus/google", "dedalus/xai", "dedalus/moonshot"] as const) {
    snapshots.push({
      providerId: routedId,
      providerKind: "llm",
      label: getIntegrationSurfaceMetadata(routedId).displayName,
      supportsExecution: false,
      capabilities: [],
      notes: ["Routed model surface behind the Dedalus gateway."],
      integration: getIntegrationSurfaceMetadata(routedId),
    });
  }

  const rails = createAgentRailsRegistry(config);
  for (const provider of rails.walletProviders) {
    const integration = getIntegrationSurfaceMetadata(provider.config.type);
    snapshots.push({
      providerId: provider.config.id,
      providerKind: "wallet",
      label: integration.displayName,
      supportsExecution: false,
      capabilities: actionCapabilitiesForKind("wallet"),
      notes: [`authMode=${provider.config.authMode}`],
      integration,
    });
  }
  for (const provider of rails.chainProviders) {
    const integration = getIntegrationSurfaceMetadata(provider.config.type);
    snapshots.push({
      providerId: provider.config.id,
      providerKind: "chain",
      label: integration.displayName,
      supportsExecution: false,
      capabilities: actionCapabilitiesForKind("chain"),
      notes: [`network=${provider.config.network}`],
      integration,
    });
  }

  for (const chainSurfaceId of ["base_rpc", "base_flashblocks"] as const) {
    snapshots.push({
      providerId: chainSurfaceId,
      providerKind: "chain",
      label: getIntegrationSurfaceMetadata(chainSurfaceId).displayName,
      supportsExecution: false,
      capabilities: [],
      notes: ["Chain infrastructure surface available for routing and observability only."],
      integration: getIntegrationSurfaceMetadata(chainSurfaceId),
    });
  }
  for (const provider of rails.paymentProviders) {
    const integration = getIntegrationSurfaceMetadata(provider.config.type);
    snapshots.push({
      providerId: provider.config.id,
      providerKind: "payments",
      label: integration.displayName,
      supportsExecution: false,
      capabilities: actionCapabilitiesForKind("payments"),
      notes: [`network=${provider.config.network}`],
      integration,
    });
  }

  for (const dataSourceId of [
    "thegraph",
    "synthdata",
    "dexscreener",
    "defillama",
    "basescan",
    "base_registry",
    "chainlink_data_streams",
    "chainlink_data_feeds",
  ] as const) {
    snapshots.push({
      providerId: dataSourceId,
      providerKind: "data",
      label: getIntegrationSurfaceMetadata(dataSourceId).displayName,
      supportsExecution: false,
      capabilities: actionCapabilitiesForKind("data"),
      notes: dataSourceId === "synthdata"
        ? ["Research analytics and probabilistic forecasting surface."]
        : ["Read-only market data surface."],
      integration: getIntegrationSurfaceMetadata(dataSourceId),
    });
  }

  for (const toolkitId of ["agentkit", "solanakit", "polkadotkit"] as const) {
    snapshots.push({
      providerId: toolkitId,
      providerKind: "system",
      label: getIntegrationSurfaceMetadata(toolkitId).displayName,
      supportsExecution: false,
      capabilities: [],
      notes: ["Agent toolkit surface with domain-specific tool wrappers."],
      integration: getIntegrationSurfaceMetadata(toolkitId),
    });
  }

  for (const nestedSurfaceId of ["jupiter", "drift", "pumpfun"] as const) {
    const integration = getIntegrationSurfaceMetadata(nestedSurfaceId);
    snapshots.push({
      providerId: nestedSurfaceId,
      providerKind: "system",
      label: integration.displayName,
      supportsExecution: false,
      capabilities: [],
      notes: [`Nested dependency under ${getIntegrationSurfaceMetadata(integration.parentSurfaceId ?? "solanakit").displayName}.`],
      integration,
    });
  }

  snapshots.push({
    providerId: "tinyfish",
    providerKind: "automation",
    label: getIntegrationSurfaceMetadata("tinyfish").displayName,
    supportsExecution: false,
    capabilities: actionCapabilitiesForKind("automation"),
    notes: ["Browser automation and web research surface."],
    integration: getIntegrationSurfaceMetadata("tinyfish"),
  });

  for (const observabilityId of ["axiom", "opentelemetry"] as const) {
    snapshots.push({
      providerId: observabilityId,
      providerKind: "observability",
      label: getIntegrationSurfaceMetadata(observabilityId).displayName,
      supportsExecution: false,
      capabilities: actionCapabilitiesForKind("observability"),
      notes: ["Observability surface."],
      integration: getIntegrationSurfaceMetadata(observabilityId),
    });
  }

  snapshots.push({
    providerId: "supabase_license",
    providerKind: "system",
    label: getIntegrationSurfaceMetadata("supabase_license").displayName,
    supportsExecution: false,
    capabilities: [],
    notes: ["System backend surface for licensing and heartbeat telemetry."],
    integration: getIntegrationSurfaceMetadata("supabase_license"),
  });

  try {
    await pluginInstaller.initialize();
    for (const plugin of pluginInstaller.getInstalled()) {
      const category = plugin.manifest.category;
      const supportsExecution = category === "execution" || category === "exchange";
      snapshots.push({
        providerId: plugin.id,
        providerKind: "mcp",
        label: plugin.manifest.name,
        supportsExecution: false,
        capabilities: plugin.manifest.tools.map((tool) => `${plugin.id}.${tool.name}`),
        notes: [
          `category=${category}`,
          supportsExecution
            ? "Execution-class MCP surfaces are inspectable but remain blocked from raw passthrough execution."
            : "Read-only MCP surface.",
        ],
        integration: getIntegrationSurfaceMetadata("gordon_mcp"),
      });
    }
  } catch {
    // Discovery must stay best-effort and read-only.
  }

  return snapshots.sort((a, b) => a.providerKind.localeCompare(b.providerKind) || a.providerId.localeCompare(b.providerId));
}
