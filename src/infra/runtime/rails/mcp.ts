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

function buildCdpCliListing(): MarketplaceListing {
  return {
    id: "cdp-cli",
    repository: "https://docs.cdp.coinbase.com/get-started/tools/cdp-cli",
    verified: true,
    officialProvider: true,
    lastUpdated: "2026-04-10T00:00:00.000Z",
    pricing: {
      type: "freemium",
      freeUsage:
        "CDP free tier covers wallets, swaps, webhooks, policy engine, and 1000 SQL queries/month. " +
        "Paid tiers for higher SQL and data limits.",
    },
    manifest: {
      id: "cdp-cli",
      name: "Coinbase Developer Platform CLI",
      version: "2.0.1",
      description:
        "Full Coinbase Developer Platform (CDP) API surface as MCP tools: server wallets, " +
        "smart accounts, swaps, policy engine, paymaster, webhooks, SQL API, onramp, x402. " +
        "Tools auto-update with CDP's OpenAPI spec so new endpoints are instantly available.",
      author: "Coinbase",
      category: "infrastructure",
      authentication: {
        type: "api_key",
        envVar: "CDP_API_KEY_ID",
      },
      command: "npx",
      args: ["-y", "@coinbase/cdp-cli@latest", "mcp"],
      tools: [
        {
          name: "cdp_evm_accounts_create",
          description: "Create a new CDP-managed EVM account.",
          inputSchema: { type: "object" },
        },
        {
          name: "cdp_evm_accounts_send_transaction",
          description: "Sign and send an EVM transaction via the CDP wallet.",
          inputSchema: { type: "object" },
        },
        {
          name: "cdp_evm_swaps_quote",
          description: "Get a swap quote from the CDP Trade API.",
          inputSchema: { type: "object" },
        },
        {
          name: "cdp_webhooks_create",
          description: "Create a CDP webhook subscription for Base chain events.",
          inputSchema: { type: "object" },
        },
        {
          name: "cdp_data_query_run",
          description: "Run a SQL query against CDP's indexed Base data.",
          inputSchema: { type: "object" },
        },
        {
          name: "cdp_policies_create",
          description: "Create a wallet policy rule (spend caps, allowlists, network restrictions).",
          inputSchema: { type: "object" },
        },
      ],
    },
    routingManifest: {
      pluginId: "cdp-cli",
      defaultAgent: "Gordon",
      alsoOnGordon: true,
    },
  };
}

export function getBuiltInAgentRailListings(): MarketplaceListing[] {
  return [buildHeliusListing(), buildMoonPayListing(), buildCdpCliListing()];
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
