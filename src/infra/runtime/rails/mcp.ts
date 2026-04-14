import type { MarketplaceListing } from "../../ai/mcp/marketplace/types.ts";
import { pluginInstaller } from "../../ai/mcp/marketplace/installer.ts";
import type { GordonConfig } from "../../../types/index.ts";
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

function buildOkxTradeMcpListing(): MarketplaceListing {
  return {
    id: "okx-trade-mcp",
    repository: "https://github.com/okx/agent-trade-kit",
    verified: true,
    officialProvider: true,
    lastUpdated: "2026-04-10T00:00:00.000Z",
    pricing: {
      type: "freemium",
      freeUsage:
        "OKX API access included with an OKX account. Derivatives, futures, and options " +
        "are geo-restricted in some jurisdictions.",
    },
    manifest: {
      id: "okx-trade-mcp",
      name: "OKX Agent Trade Kit",
      version: "1.3.0",
      description:
        "Official OKX stdio MCP server exposing 112 tools across 8 modules: market data " +
        "(16, incl. 70+ technical indicators — MA/EMA/RSI/MACD/BB/ATR/KDJ/AHR999/BTCRAINBOW), " +
        "spot (13), swap/perpetual (17, with leverage + TP/SL + OCO + trailing stop), " +
        "futures (18, delivery contracts), options (10, with Greeks and option chain), " +
        "account (14), earn (22 — Simple Earn, on-chain staking, DCD), and trading bots " +
        "(10 — Grid and DCA for spot and contract). Supports --read-only and --modules " +
        "filtering for safety. Uses OKX_API_KEY / OKX_API_SECRET / OKX_PASSPHRASE (already " +
        "wired in Gordon). Published and maintained by OKX (shaolong.wang@okg.com).",
      author: "OKX",
      category: "execution",
      authentication: {
        type: "api_key",
        envVar: "OKX_API_KEY",
      },
      command: "npx",
      args: ["-y", "@okx_ai/okx-trade-mcp@latest"],
      tools: [
        {
          name: "market_ticker",
          description: "Get spot, swap, futures, or option ticker with price, volume, and 24h stats.",
          inputSchema: { type: "object" },
        },
        {
          name: "market_indicator",
          description: "Compute any of 70+ technical indicators (RSI, MACD, BB, ATR, KDJ, AHR999, BTCRAINBOW) on a symbol's candles. No auth required.",
          inputSchema: { type: "object" },
        },
        {
          name: "spot_place_order",
          description: "Place a spot order (market, limit, post-only, FOK, IOC). Supports amend and batch orders.",
          inputSchema: { type: "object" },
        },
        {
          name: "swap_place_order",
          description: "Place a perpetual swap order with leverage, conditional TP/SL, OCO, or trailing stop.",
          inputSchema: { type: "object" },
        },
        {
          name: "futures_place_order",
          description: "Place a delivery futures contract order with TP/SL, OCO, or trailing stop algo orders.",
          inputSchema: { type: "object" },
        },
        {
          name: "option_place_order",
          description: "Place an options order. Position responses include full Greeks (delta, gamma, theta, vega).",
          inputSchema: { type: "object" },
        },
        {
          name: "bot_grid_create",
          description: "Create a spot or contract grid bot with configurable price range, grid count, and investment.",
          inputSchema: { type: "object" },
        },
        {
          name: "bot_dca_create",
          description: "Create a DCA (dollar-cost averaging) bot for spot or contract markets.",
          inputSchema: { type: "object" },
        },
        {
          name: "earn_savings_purchase",
          description: "Purchase Simple Earn flexible or fixed-term product.",
          inputSchema: { type: "object" },
        },
        {
          name: "account_positions",
          description: "List all open positions (spot, swap, futures, options) with Greeks for options.",
          inputSchema: { type: "object" },
        },
      ],
    },
    routingManifest: {
      pluginId: "okx-trade-mcp",
      defaultAgent: "Gordon",
      alsoOnGordon: true,
    },
  };
}

function buildOkxOnchainosListing(): MarketplaceListing {
  return {
    id: "okx-onchainos",
    repository: "https://github.com/okx/onchainos-skills",
    verified: true,
    officialProvider: true,
    lastUpdated: "2026-04-10T00:00:00.000Z",
    pricing: {
      type: "freemium",
      freeUsage:
        "OKX OnchainOS API — apply for credentials at https://web3.okx.com/onchain-os/dev-portal. " +
        "Free tier covers most read operations; execution paths may have rate limits.",
    },
    manifest: {
      id: "okx-onchainos",
      name: "OKX OnchainOS Skills",
      version: "1.0.0",
      description:
        "Official OKX on-chain MCP server covering 13 capability skills across 20+ chains " +
        "(Ethereum, Base, BSC, Arbitrum, Polygon, Solana, XLayer, and more): multi-chain " +
        "DEX aggregation (500+ liquidity sources), smart money / whale / KOL signal tracking, " +
        "meme pump/trenches scanning with dev reputation + bundle detection, security scanning " +
        "(token risk, phishing, tx pre-execution, signature safety), DeFi portfolio and " +
        "positions across Aave/Lido/PancakeSwap/Kamino/NAVI and more, wallet lifecycle (auth, " +
        "balance, PnL, send, tx history), gas estimation + simulation + broadcasting via " +
        "OKX infrastructure (MEV protection), and x402 payment authorization signing via TEE. " +
        "PREREQUISITE: install the onchainos binary once via the official script before " +
        "enabling this listing: `curl -sSL https://raw.githubusercontent.com/okx/onchainos-skills/main/install.sh | sh` " +
        "(macOS/Linux) or install.ps1 (Windows). Binary installs to ~/.local/bin/onchainos. " +
        "Uses a SEPARATE OnchainOS API key from the CEX trade credentials.",
      author: "OKX",
      category: "data-provider",
      authentication: {
        type: "api_key",
        envVar: "OKX_API_KEY",
      },
      command: "onchainos",
      args: ["mcp"],
      tools: [
        {
          name: "okx_dex_swap",
          description: "Execute a cross-chain token swap via OKX DEX aggregation across 20+ chains and 500+ liquidity sources.",
          inputSchema: { type: "object" },
        },
        {
          name: "okx_dex_market",
          description: "Real-time token prices, K-line charts, index prices, wallet PnL analysis, address tracker activities.",
          inputSchema: { type: "object" },
        },
        {
          name: "okx_dex_signal",
          description: "Smart money, whale, and KOL signal tracking with leaderboard rankings.",
          inputSchema: { type: "object" },
        },
        {
          name: "okx_dex_trenches",
          description: "Meme pump/trenches token scanning with dev reputation, bundle detection, and aped wallet analysis.",
          inputSchema: { type: "object" },
        },
        {
          name: "okx_dex_token",
          description: "Token search, metadata, market cap, rankings, liquidity pools, hot tokens, holder analysis, top traders, trade history, holder cluster analysis.",
          inputSchema: { type: "object" },
        },
        {
          name: "okx_security",
          description: "Token risk scanning, DApp phishing detection, transaction pre-execution simulation, signature safety, approval management.",
          inputSchema: { type: "object" },
        },
        {
          name: "okx_defi_invest",
          description: "Discover, deposit, withdraw, and claim rewards from DeFi products across Aave, Lido, PancakeSwap, Kamino, NAVI and more.",
          inputSchema: { type: "object" },
        },
        {
          name: "okx_defi_portfolio",
          description: "DeFi positions and holdings overview across protocols and chains.",
          inputSchema: { type: "object" },
        },
        {
          name: "okx_agentic_wallet",
          description: "Wallet lifecycle: auth, balance, portfolio PnL, send, tx history, contract call.",
          inputSchema: { type: "object" },
        },
        {
          name: "okx_onchain_gateway",
          description: "Gas estimation, transaction simulation, broadcasting, order tracking via OKX infrastructure with MEV protection.",
          inputSchema: { type: "object" },
        },
      ],
    },
    routingManifest: {
      pluginId: "okx-onchainos",
      defaultAgent: "Gordon",
      alsoOnGordon: true,
    },
  };
}

export function getBuiltInAgentRailListings(): MarketplaceListing[] {
  return [
    buildHeliusListing(),
    buildMoonPayListing(),
    buildCdpCliListing(),
    buildOkxTradeMcpListing(),
    buildOkxOnchainosListing(),
  ];
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
