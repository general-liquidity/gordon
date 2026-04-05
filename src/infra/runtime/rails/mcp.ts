import type { MarketplaceListing } from "../mcp/marketplace/types.ts";
import { pluginInstaller } from "../../ai/mcp/marketplace/installer.ts";
import type { GordonConfig } from "../../types/index.ts";
import { getAuditLogger } from "../../platform/audit/audit-log.ts";
import { createAgentRailsRegistry } from "./registry.ts";

function buildHeliusListing(): MarketplaceListing {
  return {
    id: "helius",
    repository: "https://www.helius.dev/docs/agents/mcp",
    verified: true,
    officialProvider: true,
    lastUpdated: "2026-03-06T00:00:00.000Z",
    pricing: {
      type: "freemium",
      freeUsage: "API credits and MCP install depend on Helius account tier",
    },
    manifest: {
      id: "helius",
      name: "Helius MCP",
      version: "1.0.0",
      description: "Solana wallet, transaction, asset, and RPC tooling from Helius.",
      author: "Helius",
      category: "infrastructure",
      authentication: {
        type: "api_key",
        envVar: "HELIUS_API_KEY",
      },
      command: "npx",
      args: ["-y", "helius-mcp@latest"],
      tools: [
        {
          name: "getWalletPortfolio",
          description: "Inspect a Solana wallet and its token holdings.",
          inputSchema: { type: "object" },
        },
        {
          name: "getTransactions",
          description: "Fetch recent Solana transactions for an address.",
          inputSchema: { type: "object" },
        },
      ],
    },
    routingManifest: {
      pluginId: "helius",
      defaultAgent: "Analyst",
      alsoOnGordon: true,
    },
  };
}

function buildMoonPayListing(): MarketplaceListing {
  return {
    id: "moonpay",
    repository: "https://www.moonpay.com/agents",
    verified: true,
    officialProvider: true,
    lastUpdated: "2026-03-06T00:00:00.000Z",
    pricing: {
      type: "freemium",
      freeUsage: "MoonPay wallet/onramp access depends on account and region",
    },
    manifest: {
      id: "moonpay",
      name: "MoonPay MCP",
      version: "1.0.0",
      description: "Wallet funding, swaps, bridges, and on/off-ramp tooling from MoonPay.",
      author: "MoonPay",
      category: "execution",
      authentication: {
        type: "none",
      },
      command: "mp",
      args: ["mcp"],
      tools: [
        {
          name: "createWallet",
          description: "Create or connect a MoonPay wallet.",
          inputSchema: { type: "object" },
        },
        {
          name: "createOnRampQuote",
          description: "Generate a buy/funding flow for a wallet.",
          inputSchema: { type: "object" },
        },
      ],
    },
    routingManifest: {
      pluginId: "moonpay",
      defaultAgent: "Executor",
      alsoOnGordon: true,
    },
  };
}

export function getBuiltInAgentRailListings(): MarketplaceListing[] {
  return [buildHeliusListing(), buildMoonPayListing()];
}

function shouldInstallListing(config: GordonConfig, listingId: string): boolean {
  const registry = createAgentRailsRegistry(config);
  const statuses = registry.getStatuses();
  return statuses.some((status) => {
    if (!status.enabled) return false;
    if (status.mcpServerId !== listingId) return false;
    return status.transport === "mcp" || status.transport === "hybrid";
  });
}

export async function syncAgentRailMcpPlugins(config: GordonConfig): Promise<void> {
  if (!config.agentRails.autoSyncMcpPlugins) {
    return;
  }

  await pluginInstaller.initialize();
  const builtIns = getBuiltInAgentRailListings();
  const auditLogger = getAuditLogger("system");

  for (const listing of builtIns) {
    const shouldInstall = shouldInstallListing(config, listing.id);
    const installed = pluginInstaller.getPlugin(listing.id);

    if (shouldInstall && !installed) {
      await pluginInstaller.install(listing);
      auditLogger.record("AGENT_RAIL_MCP_SYNC", { pluginId: listing.id, action: "install" }, "SUCCESS");
      continue;
    }

    if (shouldInstall && installed && !installed.enabled) {
      await pluginInstaller.enable(listing.id);
      auditLogger.record("AGENT_RAIL_MCP_SYNC", { pluginId: listing.id, action: "enable" }, "SUCCESS");
      continue;
    }

    if (!shouldInstall && installed?.enabled) {
      await pluginInstaller.disable(listing.id);
      auditLogger.record("AGENT_RAIL_MCP_SYNC", { pluginId: listing.id, action: "disable" }, "SUCCESS");
    }
  }
}
