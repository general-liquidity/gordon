// ============================================================================
// Protocols — DeFi and on-chain protocol integrations
//
// Registry of all DeFi/on-chain protocols with unified interface.
// Each protocol provides data feeds, trading, or yield capabilities.
// ============================================================================

// Protocol re-exports
export * as chainlink from "./chainlink/index.ts";
export * as uniswap from "./uniswap/index.ts";
export * as defillama from "./defillama/client.ts";
export * as solana from "./solana/index.ts";
export * as polkadot from "./polkadot/index.ts";
export * as base from "./base/index.ts";
export * as agentkit from "./agentkit/index.ts";

// Protocol registry for discovery and health monitoring
export interface ProtocolInfo {
  id: string;
  name: string;
  category: "oracle" | "dex" | "yield" | "lending" | "chain" | "wallet";
  chains: string[];
  capabilities: string[];
  healthEndpoint?: string;
}

export const PROTOCOL_REGISTRY: ProtocolInfo[] = [
  { id: "chainlink", name: "Chainlink", category: "oracle", chains: ["ethereum", "polygon", "arbitrum", "base"], capabilities: ["price-feeds", "ccip", "data-streams"] },
  { id: "uniswap", name: "Uniswap", category: "dex", chains: ["ethereum", "polygon", "arbitrum", "base", "optimism"], capabilities: ["swap", "pools", "token-data"] },
  { id: "defillama", name: "DeFiLlama", category: "yield", chains: ["multi-chain"], capabilities: ["yield-data", "tvl", "protocol-stats"] },
  { id: "solana", name: "Solana Kit", category: "chain", chains: ["solana"], capabilities: ["wallet", "trading", "lending", "perps", "pools", "bridge"] },
  { id: "polkadot", name: "Polkadot Kit", category: "chain", chains: ["polkadot", "kusama"], capabilities: ["staking", "assets", "defi"] },
  { id: "base", name: "Base", category: "chain", chains: ["base"], capabilities: ["indexers", "onchain", "signals", "dex-screener"] },
  { id: "agentkit", name: "CDP AgentKit", category: "wallet", chains: ["ethereum", "base"], capabilities: ["onchain", "defi"] },
];

export function getProtocol(id: string): ProtocolInfo | undefined {
  return PROTOCOL_REGISTRY.find((p) => p.id === id);
}

export function getProtocolsByCategory(category: ProtocolInfo["category"]): ProtocolInfo[] {
  return PROTOCOL_REGISTRY.filter((p) => p.category === category);
}

export function getProtocolsByChain(chain: string): ProtocolInfo[] {
  return PROTOCOL_REGISTRY.filter((p) => p.chains.includes(chain));
}
