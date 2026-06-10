// ============================================================================
// Protocols — DeFi and on-chain protocol integrations
//
// Registry of all DeFi/on-chain protocols with unified interface.
// Each protocol provides data feeds, trading, or yield capabilities.
// ============================================================================

// Protocol registry for discovery and health monitoring
export interface ProtocolInfo {
  id: string;
  name: string;
  category: "oracle" | "dex" | "yield" | "lending" | "chain" | "wallet";
  chains: string[];
  capabilities: string[];
  healthEndpoint?: string;
}

// PROTOCOL_REGISTRY is intentionally empty post-onchain-removal.
// All onchain protocol integrations (Base/AgentKit + earlier
// Solana/Polkadot/Uniswap/Chainlink) were removed — Gordon trades via CCXT
// (CEX) + Hyperliquid (DEX); onchain/DeFi/wallet surfaces live in OpenSolvency.
export const PROTOCOL_REGISTRY: ProtocolInfo[] = [];

export function getProtocol(id: string): ProtocolInfo | undefined {
  return PROTOCOL_REGISTRY.find((p) => p.id === id);
}

export function getProtocolsByCategory(category: ProtocolInfo["category"]): ProtocolInfo[] {
  return PROTOCOL_REGISTRY.filter((p) => p.category === category);
}

export function getProtocolsByChain(chain: string): ProtocolInfo[] {
  return PROTOCOL_REGISTRY.filter((p) => p.chains.includes(chain));
}
