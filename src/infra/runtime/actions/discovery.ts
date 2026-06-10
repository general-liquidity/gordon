import type { GordonConfig } from "../../../types/index.ts";
import { BrokerFactory } from "../../broker/factory.ts";
import { ExchangeFactory } from "../../exchange/factory.ts";
import {
  getExecutionVenueMetadata,
  getIntegrationSurfaceMetadata,
} from "../../domain/integrations/taxonomy.ts";
import { pluginInstaller } from "../../ai/mcp/marketplace/installer.ts";
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
