import type { GordonConfig } from "../../types/index.ts";
import { BrokerFactory } from "../broker/factory.ts";
import { ExchangeFactory } from "../exchange/factory.ts";
import { pluginInstaller } from "../mcp/marketplace/installer.ts";
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
    snapshots.push({
      providerId: exchangeId,
      providerKind: "exchange",
      label: exchangeId,
      supportsExecution: true,
      capabilities: actionCapabilitiesForKind("exchange"),
      notes: ["Execution remains behind Gordon-native normalized exchange adapters."],
    });
  }

  for (const brokerId of BrokerFactory.getSupportedBrokers()) {
    snapshots.push({
      providerId: brokerId,
      providerKind: "broker",
      label: brokerId,
      supportsExecution: true,
      capabilities: actionCapabilitiesForKind("broker"),
      notes: ["Read-only discovery is allowed; live broker operations stay behind normalized broker adapters."],
    });
  }

  const rails = createAgentRailsRegistry(config);
  for (const provider of rails.walletProviders) {
    snapshots.push({
      providerId: provider.config.id,
      providerKind: "wallet",
      label: provider.config.type,
      supportsExecution: false,
      capabilities: actionCapabilitiesForKind("wallet"),
      notes: [`authMode=${provider.config.authMode}`],
    });
  }
  for (const provider of rails.chainProviders) {
    snapshots.push({
      providerId: provider.config.id,
      providerKind: "chain",
      label: provider.config.type,
      supportsExecution: false,
      capabilities: actionCapabilitiesForKind("chain"),
      notes: [`network=${provider.config.network}`],
    });
  }
  for (const provider of rails.paymentProviders) {
    snapshots.push({
      providerId: provider.config.id,
      providerKind: "payments",
      label: provider.config.type,
      supportsExecution: false,
      capabilities: actionCapabilitiesForKind("payments"),
      notes: [`network=${provider.config.network}`],
    });
  }

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
      });
    }
  } catch {
    // Discovery must stay best-effort and read-only.
  }

  return snapshots.sort((a, b) => a.providerKind.localeCompare(b.providerKind) || a.providerId.localeCompare(b.providerId));
}
