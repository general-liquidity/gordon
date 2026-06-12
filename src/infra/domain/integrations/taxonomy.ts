import type { BrokerId } from "../../broker/types.ts";
import type { ExchangeId } from "../../exchange/types.ts";
import { isCcxtExchangeId, extractCcxtSubId, NATIVE_TO_CCXT_SUBID } from "../../exchange/types.ts";

export type IntegrationDomain =
  | "model_provider"
  | "model_gateway"
  | "execution_venue"
  | "market_data_source"
  | "research_analytics_provider"
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
    // Crypto execution is a SINGLE unified surface — CCXT. Individual venues
    // are not enumerated here (the live set is ccxt.exchanges, ~100+, maintained
    // upstream — hardcoding a subset would under-represent reach and drift).
    // Per-venue metadata is DERIVED from the canonical `ccxt:<subId>` id by
    // getExecutionVenueMetadata(); the first-class venues additionally carry
    // curated env-var names (EXCHANGE_ENV_MAP) + sandbox metadata
    // (EXCHANGE_SANDBOX_SUPPORT) outside this registry.
    id: "ccxt",
    displayName: "CCXT (unified crypto)",
    integrationDomain: "execution_venue",
    marketFamily: "crypto",
    venueKind: "cex",
    executionModel: "centralized",
    gordonEnabledMarkets: ["crypto"],
    notes: ["Single adapter over ~100+ CEX/DEX venues; address any as `ccxt:<sub-id>` (e.g. ccxt:binance, ccxt:bybit, ccxt:hyperliquid)."],
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

/**
 * CCXT sub-ids that are decentralized venues (DEX/onchain). CCXT does not
 * expose a reliable CEX-vs-DEX flag, and the distinction drives the risk
 * layer's executionModel + MEV-exposure handling — so this small structural
 * classifier is curated. Everything else defaults to a centralized CEX.
 */
const CCXT_DEX_SUBIDS = new Set<string>([
  "hyperliquid", "dydx", "vertex", "paradex", "apex",
  "derive", "pacifica", "lighter", "hibachi", "woofipro",
]);

/**
 * Derive metadata for a CCXT-routed crypto venue from its sub-id. Avoids
 * hardcoding the ~100+ venue catalog: marketFamily is always crypto, and
 * CEX/DEX is resolved from the curated DEX set (default CEX).
 */
function deriveCcxtVenueMetadata(subId: string, venueId: string): IntegrationSurfaceMetadata {
  const isDex = CCXT_DEX_SUBIDS.has(subId);
  const titled = subId.charAt(0).toUpperCase() + subId.slice(1);
  return {
    id: venueId,
    displayName: `${titled} (via CCXT)`,
    integrationDomain: "execution_venue",
    marketFamily: "crypto",
    venueKind: isDex ? "dex" : "cex",
    executionModel: isDex ? "decentralized" : "centralized",
    gordonEnabledMarkets: ["crypto"],
    notes: ["CCXT-routed crypto venue (metadata derived from the sub-id)."],
  };
}

export function getExecutionVenueMetadata(
  venueId: ExchangeId | BrokerId,
): IntegrationSurfaceMetadata {
  const direct = INTEGRATION_SURFACE_MAP.get(venueId);
  if (direct) return direct;
  // Crypto venues are not enumerated — derive from the CCXT id (canonical
  // `ccxt:<subId>` or a legacy bare first-class id). Brokers/providers live in
  // the map above, so they never reach here.
  if (isCcxtExchangeId(venueId)) {
    return deriveCcxtVenueMetadata(extractCcxtSubId(venueId), venueId);
  }
  if (venueId in NATIVE_TO_CCXT_SUBID) {
    return deriveCcxtVenueMetadata(NATIVE_TO_CCXT_SUBID[venueId as keyof typeof NATIVE_TO_CCXT_SUBID], venueId);
  }
  return {
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
