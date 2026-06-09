// ============================================================================
// Protocols — DeFi and on-chain protocol integrations
//
// Registry of all DeFi/on-chain protocols with unified interface.
// Each protocol provides data feeds, trading, or yield capabilities.
// ============================================================================

// Protocol re-exports
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
