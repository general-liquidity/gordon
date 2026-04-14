import type {
  AgentRailsConfig,
  ChainProviderConfig,
  GordonConfig,
  PaymentProviderConfig,
  WalletProviderConfig,
} from "../../../types/index.ts";
import type { AgentRailsRegistry, ChainDataProvider, PaymentProvider, WalletProvider } from "./types.ts";
import { HeliusProvider } from "./providers/helius.ts";
import { MoonPayProvider } from "./providers/moonpay.ts";
import { PolygonX402Provider } from "./providers/polygon.ts";

function pickDefault<T extends { id: string; isDefault: boolean; enabled: boolean }>(
  items: T[],
  activeId?: string,
): T | null {
  const filtered = items.filter((item) => item.enabled);
  if (filtered.length === 0) return null;
  return filtered.find((item) => item.id === activeId)
    || filtered.find((item) => item.isDefault)
    || filtered[0]
    || null;
}

function inferWalletProviders(config: AgentRailsConfig): WalletProviderConfig[] {
  if (config.walletProviders.length > 0) {
    return config.walletProviders;
  }

  if (!process.env.MOONPAY_API_KEY && !process.env.MOONPAY_WIDGET_URL && !process.env.MOONPAY_SECRET_KEY) {
    return [];
  }

  return [{
    id: "moonpay-default",
    type: "moonpay",
    authMode: process.env.MOONPAY_API_KEY ? "hybrid" : "mcp",
    enabled: true,
    isDefault: true,
    network: "base",
    mcpServerId: "moonpay",
  }];
}

function inferChainProviders(config: AgentRailsConfig): ChainProviderConfig[] {
  if (config.chainProviders.length > 0) {
    return config.chainProviders;
  }

  if (!process.env.HELIUS_API_KEY && !(process.env.SOLANA_RPC_URL || "").includes("helius")) {
    return [];
  }

  return [{
    id: "helius-default",
    type: "helius",
    authMode: process.env.HELIUS_API_KEY ? "hybrid" : "native",
    enabled: true,
    isDefault: true,
    network: "solana",
    apiBaseUrl: process.env.SOLANA_RPC_URL?.includes("helius") ? process.env.SOLANA_RPC_URL : undefined,
    mcpServerId: "helius",
  }];
}

function inferPaymentProviders(config: AgentRailsConfig): PaymentProviderConfig[] {
  if (config.paymentProviders.length > 0) {
    return config.paymentProviders;
  }

  if (!process.env.POLYGON_X402_PRIVATE_KEY && !process.env.POLYGON_X402_RECIPIENT) {
    return [];
  }

  return [{
    id: "polygon-default",
    type: "polygon",
    authMode: "native",
    enabled: true,
    isDefault: true,
    network: process.env.POLYGON_X402_CHAIN_ID || "polygon",
    facilitatorUrl: process.env.POLYGON_X402_FACILITATOR_URL,
    recipient: process.env.POLYGON_X402_RECIPIENT,
  }];
}

function createWalletProviders(agentRails: AgentRailsConfig): WalletProvider[] {
  return inferWalletProviders(agentRails)
    .filter((provider) => provider.enabled)
    .map((provider) => new MoonPayProvider(provider));
}

function createChainProviders(agentRails: AgentRailsConfig): ChainDataProvider[] {
  return inferChainProviders(agentRails)
    .filter((provider) => provider.enabled)
    .map((provider) => new HeliusProvider(provider));
}

function createPaymentProviders(agentRails: AgentRailsConfig): PaymentProvider[] {
  return inferPaymentProviders(agentRails)
    .filter((provider) => provider.enabled)
    .map((provider) => new PolygonX402Provider(provider));
}

export function createAgentRailsRegistry(config: GordonConfig): AgentRailsRegistry {
  const agentRails = config.agentRails;
  const walletProviders = createWalletProviders(agentRails);
  const chainProviders = createChainProviders(agentRails);
  const paymentProviders = createPaymentProviders(agentRails);

  const activeWalletConfig = pickDefault(inferWalletProviders(agentRails), agentRails.activeWalletProviderId);
  const activeChainConfig = pickDefault(inferChainProviders(agentRails), agentRails.activeChainProviderId);
  const activePaymentConfig = pickDefault(inferPaymentProviders(agentRails), agentRails.activePaymentProviderId);

  return {
    config: agentRails,
    walletProviders,
    chainProviders,
    paymentProviders,
    activeWalletProvider: activeWalletConfig
      ? walletProviders.find((provider) => provider.config.id === activeWalletConfig.id) || null
      : null,
    activeChainProvider: activeChainConfig
      ? chainProviders.find((provider) => provider.config.id === activeChainConfig.id) || null
      : null,
    activePaymentProvider: activePaymentConfig
      ? paymentProviders.find((provider) => provider.config.id === activePaymentConfig.id) || null
      : null,
    getStatuses() {
      return [
        ...walletProviders.map((provider) => provider.getStatus()),
        ...chainProviders.map((provider) => provider.getStatus()),
        ...paymentProviders.map((provider) => provider.getStatus()),
      ];
    },
  };
}

export function getAgentRailsSummary(config: GordonConfig): {
  walletProviderIds: string[];
  chainProviderIds: string[];
  paymentProviderIds: string[];
} {
  const registry = createAgentRailsRegistry(config);
  return {
    walletProviderIds: registry.walletProviders.map((provider) => provider.config.id),
    chainProviderIds: registry.chainProviders.map((provider) => provider.config.id),
    paymentProviderIds: registry.paymentProviders.map((provider) => provider.config.id),
  };
}
