import type { BrokerId } from "../broker/types.ts";
import type { ExchangeId } from "../exchange/types.ts";

export type IntegrationDomain =
  | "model_provider"
  | "model_gateway"
  | "execution_venue"
  | "market_data_source"
  | "research_analytics_provider"
  | "wallet_rail"
  | "payment_rail"
  | "chain_infrastructure"
  | "agent_toolkit"
  | "automation_provider"
  | "observability_provider"
  | "plugin_runtime"
  | "service_backend"
  | "system";

export type IntegrationMarketFamily = "crypto" | "stocks";
export type VenueKind = "cex" | "dex" | "broker";
export type VenueSubtype =
  | "spot_cex"
  | "amm_dex"
  | "perps_dex"
  | "dex_aggregator"
  | "launchpad_protocol"
  | "crypto_broker"
  | "retail_broker";
export type ExecutionModel = "centralized" | "decentralized" | "brokerage";
export type MarketDataSourceKind =
  | "venue_native"
  | "indexer"
  | "oracle"
  | "analytics_vendor"
  | "registry"
  | "explorer"
  | "aggregator";
export type RailKind = "funding_onramp_offramp" | "agentic_micropayments";
export type InfrastructureKind =
  | "rpc_data_platform"
  | "bridge_protocol"
  | "chain_ecosystem";
export type ModelProviderKind = "native" | "gateway";
export type ModelAccessPath = "native" | "routed" | "direct_openai_compatible";
export type AutomationKind = "web_agent";
export type TaxonomyScope = "first_class" | "nested_dependency";

export interface IntegrationSurfaceMetadata {
  id: string;
  displayName: string;
  integrationDomain: IntegrationDomain;
  marketFamily?: IntegrationMarketFamily;
  venueKind?: VenueKind;
  venueSubtype?: VenueSubtype;
  executionModel?: ExecutionModel;
  sourceKind?: MarketDataSourceKind;
  railKind?: RailKind;
  infraKind?: InfrastructureKind;
  providerKind?: ModelProviderKind;
  accessPath?: ModelAccessPath;
  gatewayParent?: string;
  automationKind?: AutomationKind;
  taxonomyScope?: TaxonomyScope;
  parentSurfaceId?: string;
  vendorSupportedMarkets?: string[];
  gordonEnabledMarkets?: string[];
  notes?: string[];
}

const EXECUTION_SURFACES: IntegrationSurfaceMetadata[] = [
  {
    id: "binance",
    displayName: "Binance",
    integrationDomain: "execution_venue",
    marketFamily: "crypto",
    venueKind: "cex",
    venueSubtype: "spot_cex",
    executionModel: "centralized",
    vendorSupportedMarkets: ["spot", "margin", "perps"],
    gordonEnabledMarkets: ["crypto"],
  },
  {
    id: "binance_us",
    displayName: "Binance US",
    integrationDomain: "execution_venue",
    marketFamily: "crypto",
    venueKind: "cex",
    venueSubtype: "spot_cex",
    executionModel: "centralized",
    vendorSupportedMarkets: ["spot"],
    gordonEnabledMarkets: ["crypto"],
  },
  {
    id: "coinbase",
    displayName: "Coinbase Advanced Trade",
    integrationDomain: "execution_venue",
    marketFamily: "crypto",
    venueKind: "cex",
    venueSubtype: "spot_cex",
    executionModel: "centralized",
    vendorSupportedMarkets: ["spot"],
    gordonEnabledMarkets: ["crypto"],
  },
  {
    id: "kraken",
    displayName: "Kraken",
    integrationDomain: "execution_venue",
    marketFamily: "crypto",
    venueKind: "cex",
    venueSubtype: "spot_cex",
    executionModel: "centralized",
    vendorSupportedMarkets: ["spot", "margin"],
    gordonEnabledMarkets: ["crypto"],
  },
  {
    id: "bitfinex",
    displayName: "Bitfinex",
    integrationDomain: "execution_venue",
    marketFamily: "crypto",
    venueKind: "cex",
    venueSubtype: "spot_cex",
    executionModel: "centralized",
    vendorSupportedMarkets: ["spot", "margin", "derivatives"],
    gordonEnabledMarkets: ["crypto"],
  },
  {
    id: "hyperliquid",
    displayName: "Hyperliquid",
    integrationDomain: "execution_venue",
    marketFamily: "crypto",
    venueKind: "dex",
    venueSubtype: "perps_dex",
    executionModel: "decentralized",
    vendorSupportedMarkets: ["perpetuals"],
    gordonEnabledMarkets: ["crypto"],
    notes: ["Onchain perpetuals venue with DEX semantics."],
  },
  {
    id: "uniswap",
    displayName: "Uniswap Protocol",
    integrationDomain: "execution_venue",
    marketFamily: "crypto",
    venueKind: "dex",
    venueSubtype: "amm_dex",
    executionModel: "decentralized",
    vendorSupportedMarkets: ["spot", "lp_positions"],
    gordonEnabledMarkets: ["crypto"],
    notes: ["AMM protocol, not a centralized exchange."],
  },
  {
    id: "robinhood",
    displayName: "Robinhood Crypto",
    integrationDomain: "execution_venue",
    marketFamily: "crypto",
    venueKind: "broker",
    venueSubtype: "crypto_broker",
    executionModel: "brokerage",
    vendorSupportedMarkets: ["crypto"],
    gordonEnabledMarkets: ["crypto"],
  },
  {
    id: "alpaca",
    displayName: "Alpaca",
    integrationDomain: "execution_venue",
    marketFamily: "stocks",
    venueKind: "broker",
    venueSubtype: "retail_broker",
    executionModel: "brokerage",
    vendorSupportedMarkets: ["stocks", "options", "crypto"],
    gordonEnabledMarkets: ["stocks"],
  },
  {
    id: "webull",
    displayName: "Webull",
    integrationDomain: "execution_venue",
    marketFamily: "stocks",
    venueKind: "broker",
    venueSubtype: "retail_broker",
    executionModel: "brokerage",
    vendorSupportedMarkets: ["stocks", "options", "futures", "crypto"],
    gordonEnabledMarkets: ["stocks"],
  },
  {
    id: "schwab",
    displayName: "Schwab",
    integrationDomain: "execution_venue",
    marketFamily: "stocks",
    venueKind: "broker",
    venueSubtype: "retail_broker",
    executionModel: "brokerage",
    vendorSupportedMarkets: ["stocks", "options"],
    gordonEnabledMarkets: ["stocks"],
  },
  {
    id: "tradier",
    displayName: "Tradier",
    integrationDomain: "execution_venue",
    marketFamily: "stocks",
    venueKind: "broker",
    venueSubtype: "retail_broker",
    executionModel: "brokerage",
    vendorSupportedMarkets: ["stocks", "options"],
    gordonEnabledMarkets: ["stocks"],
  },
  {
    id: "tradestation",
    displayName: "TradeStation",
    integrationDomain: "execution_venue",
    marketFamily: "stocks",
    venueKind: "broker",
    venueSubtype: "retail_broker",
    executionModel: "brokerage",
    vendorSupportedMarkets: ["stocks", "options", "futures"],
    gordonEnabledMarkets: ["stocks"],
  },
  {
    id: "tastytrade",
    displayName: "tastytrade",
    integrationDomain: "execution_venue",
    marketFamily: "stocks",
    venueKind: "broker",
    venueSubtype: "retail_broker",
    executionModel: "brokerage",
    vendorSupportedMarkets: ["stocks", "options", "futures"],
    gordonEnabledMarkets: ["stocks"],
  },
  {
    id: "trading212",
    displayName: "Trading 212",
    integrationDomain: "execution_venue",
    marketFamily: "stocks",
    venueKind: "broker",
    venueSubtype: "retail_broker",
    executionModel: "brokerage",
    vendorSupportedMarkets: ["stocks"],
    gordonEnabledMarkets: ["stocks"],
  },
  {
    id: "etrade",
    displayName: "E*TRADE",
    integrationDomain: "execution_venue",
    marketFamily: "stocks",
    venueKind: "broker",
    venueSubtype: "retail_broker",
    executionModel: "brokerage",
    vendorSupportedMarkets: ["stocks", "options"],
    gordonEnabledMarkets: ["stocks"],
  },
  {
    id: "ibkr",
    displayName: "Interactive Brokers",
    integrationDomain: "execution_venue",
    marketFamily: "stocks",
    venueKind: "broker",
    venueSubtype: "retail_broker",
    executionModel: "brokerage",
    vendorSupportedMarkets: ["stocks", "options", "futures", "forex"],
    gordonEnabledMarkets: ["stocks"],
  },
];

const NON_EXECUTION_SURFACES: IntegrationSurfaceMetadata[] = [
  {
    id: "openai",
    displayName: "OpenAI",
    integrationDomain: "model_provider",
    providerKind: "native",
    accessPath: "native",
  },
  {
    id: "anthropic",
    displayName: "Anthropic",
    integrationDomain: "model_provider",
    providerKind: "native",
    accessPath: "native",
  },
  {
    id: "google",
    displayName: "Google",
    integrationDomain: "model_provider",
    providerKind: "native",
    accessPath: "native",
  },
  {
    id: "inception",
    displayName: "Inception Labs",
    integrationDomain: "model_provider",
    providerKind: "native",
    accessPath: "direct_openai_compatible",
  },
  {
    id: "dedalus",
    displayName: "Dedalus",
    integrationDomain: "model_gateway",
    providerKind: "gateway",
    accessPath: "native",
  },
  {
    id: "dedalus/openai",
    displayName: "OpenAI via Dedalus",
    integrationDomain: "model_provider",
    providerKind: "native",
    accessPath: "routed",
    gatewayParent: "dedalus",
  },
  {
    id: "dedalus/anthropic",
    displayName: "Anthropic via Dedalus",
    integrationDomain: "model_provider",
    providerKind: "native",
    accessPath: "routed",
    gatewayParent: "dedalus",
  },
  {
    id: "dedalus/google",
    displayName: "Google via Dedalus",
    integrationDomain: "model_provider",
    providerKind: "native",
    accessPath: "routed",
    gatewayParent: "dedalus",
  },
  {
    id: "dedalus/xai",
    displayName: "xAI via Dedalus",
    integrationDomain: "model_provider",
    providerKind: "native",
    accessPath: "routed",
    gatewayParent: "dedalus",
  },
  {
    id: "dedalus/moonshot",
    displayName: "Moonshot via Dedalus",
    integrationDomain: "model_provider",
    providerKind: "native",
    accessPath: "routed",
    gatewayParent: "dedalus",
  },
  {
    id: "moonpay",
    displayName: "MoonPay",
    integrationDomain: "wallet_rail",
    railKind: "funding_onramp_offramp",
    marketFamily: "crypto",
    gordonEnabledMarkets: ["crypto"],
  },
  {
    id: "polygon",
    displayName: "Polygon x402",
    integrationDomain: "payment_rail",
    railKind: "agentic_micropayments",
  },
  {
    id: "helius",
    displayName: "Helius",
    integrationDomain: "chain_infrastructure",
    infraKind: "rpc_data_platform",
    marketFamily: "crypto",
    gordonEnabledMarkets: ["crypto"],
  },
  {
    id: "thegraph",
    displayName: "The Graph",
    integrationDomain: "market_data_source",
    sourceKind: "indexer",
    marketFamily: "crypto",
    gordonEnabledMarkets: ["crypto"],
  },
  {
    id: "synthdata",
    displayName: "SynthData",
    integrationDomain: "research_analytics_provider",
    marketFamily: "crypto",
    vendorSupportedMarkets: ["crypto", "commodities", "tokenized_equities"],
    gordonEnabledMarkets: ["crypto", "stocks"],
    notes: [
      "Probabilistic analytics and forecasting surface, not a raw market-data feed.",
    ],
  },
  {
    id: "dexscreener",
    displayName: "DexScreener",
    integrationDomain: "market_data_source",
    sourceKind: "analytics_vendor",
    marketFamily: "crypto",
    gordonEnabledMarkets: ["crypto"],
  },
  {
    id: "defillama",
    displayName: "DefiLlama",
    integrationDomain: "market_data_source",
    sourceKind: "aggregator",
    marketFamily: "crypto",
    gordonEnabledMarkets: ["crypto"],
  },
  {
    id: "basescan",
    displayName: "Basescan",
    integrationDomain: "market_data_source",
    sourceKind: "explorer",
    marketFamily: "crypto",
    gordonEnabledMarkets: ["crypto"],
  },
  {
    id: "base_registry",
    displayName: "Base Registry API",
    integrationDomain: "market_data_source",
    sourceKind: "registry",
    marketFamily: "crypto",
    gordonEnabledMarkets: ["crypto"],
  },
  {
    id: "base_rpc",
    displayName: "Base RPC",
    integrationDomain: "chain_infrastructure",
    infraKind: "chain_ecosystem",
    marketFamily: "crypto",
    gordonEnabledMarkets: ["crypto"],
  },
  {
    id: "base_flashblocks",
    displayName: "Base Flashblocks",
    integrationDomain: "chain_infrastructure",
    infraKind: "chain_ecosystem",
    marketFamily: "crypto",
    gordonEnabledMarkets: ["crypto"],
    notes: ["Preconfirmation and low-latency Base block streaming surface."],
  },
  {
    id: "chainlink_data_streams",
    displayName: "Chainlink Data Streams",
    integrationDomain: "market_data_source",
    sourceKind: "oracle",
    marketFamily: "crypto",
    gordonEnabledMarkets: ["crypto"],
  },
  {
    id: "chainlink_data_feeds",
    displayName: "Chainlink Data Feeds",
    integrationDomain: "market_data_source",
    sourceKind: "oracle",
    marketFamily: "crypto",
    gordonEnabledMarkets: ["crypto"],
  },
  {
    id: "chainlink_ccip",
    displayName: "Chainlink CCIP",
    integrationDomain: "chain_infrastructure",
    infraKind: "bridge_protocol",
  },
  {
    id: "agentkit",
    displayName: "Coinbase CDP AgentKit",
    integrationDomain: "agent_toolkit",
    marketFamily: "crypto",
    gordonEnabledMarkets: ["crypto"],
  },
  {
    id: "solanakit",
    displayName: "Solana Agent Kit",
    integrationDomain: "agent_toolkit",
    marketFamily: "crypto",
    gordonEnabledMarkets: ["crypto"],
  },
  {
    id: "jupiter",
    displayName: "Jupiter",
    integrationDomain: "execution_venue",
    marketFamily: "crypto",
    venueKind: "dex",
    venueSubtype: "dex_aggregator",
    executionModel: "decentralized",
    taxonomyScope: "nested_dependency",
    parentSurfaceId: "solanakit",
    vendorSupportedMarkets: ["spot", "routing", "aggregated_swaps"],
    gordonEnabledMarkets: ["crypto"],
    notes: ["Nested Solana routing dependency exposed through Solana Agent Kit."],
  },
  {
    id: "drift",
    displayName: "Drift",
    integrationDomain: "execution_venue",
    marketFamily: "crypto",
    venueKind: "dex",
    venueSubtype: "perps_dex",
    executionModel: "decentralized",
    taxonomyScope: "nested_dependency",
    parentSurfaceId: "solanakit",
    vendorSupportedMarkets: ["perpetuals", "spot_swaps", "vaults"],
    gordonEnabledMarkets: ["crypto"],
    notes: ["Nested Solana perps venue exposed through Solana Agent Kit."],
  },
  {
    id: "pumpfun",
    displayName: "Pump.fun",
    integrationDomain: "execution_venue",
    marketFamily: "crypto",
    venueKind: "dex",
    venueSubtype: "launchpad_protocol",
    executionModel: "decentralized",
    taxonomyScope: "nested_dependency",
    parentSurfaceId: "solanakit",
    vendorSupportedMarkets: ["token_launch", "launchpad_trading"],
    gordonEnabledMarkets: ["crypto"],
    notes: ["Nested launchpad protocol exposed through Solana Agent Kit."],
  },
  {
    id: "polkadotkit",
    displayName: "Polkadot Agent Kit",
    integrationDomain: "agent_toolkit",
    marketFamily: "crypto",
    gordonEnabledMarkets: ["crypto"],
  },
  {
    id: "tinyfish",
    displayName: "Tinyfish",
    integrationDomain: "automation_provider",
    automationKind: "web_agent",
  },
  {
    id: "axiom",
    displayName: "Axiom",
    integrationDomain: "observability_provider",
  },
  {
    id: "opentelemetry",
    displayName: "OpenTelemetry",
    integrationDomain: "observability_provider",
  },
  {
    id: "gordon_mcp",
    displayName: "Gordon MCP Runtime",
    integrationDomain: "plugin_runtime",
  },
  {
    id: "supabase_license",
    displayName: "Supabase License Backend",
    integrationDomain: "service_backend",
    notes: ["Supabase-backed licensing and heartbeat backend used by Gordon system services."],
  },
];

const INTEGRATION_SURFACE_MAP = new Map<string, IntegrationSurfaceMetadata>(
  [...EXECUTION_SURFACES, ...NON_EXECUTION_SURFACES].map((surface) => [surface.id, surface]),
);

export function getExecutionVenueMetadata(
  venueId: ExchangeId | BrokerId,
): IntegrationSurfaceMetadata {
  return INTEGRATION_SURFACE_MAP.get(venueId) ?? {
    id: venueId,
    displayName: venueId,
    integrationDomain: "execution_venue",
  };
}

export function getIntegrationSurfaceMetadata(id: string): IntegrationSurfaceMetadata {
  return INTEGRATION_SURFACE_MAP.get(id) ?? {
    id,
    displayName: id,
    integrationDomain: "system",
  };
}

export function listIntegrationSurfaces(): IntegrationSurfaceMetadata[] {
  return [...INTEGRATION_SURFACE_MAP.values()].sort((a, b) => {
    if (a.integrationDomain !== b.integrationDomain) {
      return a.integrationDomain.localeCompare(b.integrationDomain);
    }
    return a.displayName.localeCompare(b.displayName);
  });
}

export function formatExecutionVenueLabel(metadata: IntegrationSurfaceMetadata): string {
  if (metadata.integrationDomain !== "execution_venue") {
    return metadata.displayName;
  }

  const kind = metadata.venueKind?.toUpperCase() ?? "VENUE";
  return `${kind} · ${metadata.displayName}`;
}
