import { createModuleLogger } from "../../../logger/index.ts";
import type { ChainDataProvider, ChainTokenMetadata, ChainTransactionSummary, ChainWalletOverview } from "../types.ts";
import type { ChainProviderConfig } from "../../../../types/index.ts";

const logger = createModuleLogger("rails-helius");
const DEFAULT_HELIUS_API_BASE = "https://mainnet.helius-rpc.com";

function normalizeHeliusEndpoint(apiBaseUrl: string, apiKey?: string): string {
  const url = new URL(apiBaseUrl || DEFAULT_HELIUS_API_BASE);
  if (apiKey && !url.searchParams.has("api-key")) {
    url.searchParams.set("api-key", apiKey);
  }
  return url.toString();
}

async function heliusRpcRequest<T>(
  endpoint: string,
  method: string,
  params: unknown,
): Promise<T> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: `${method}-${Date.now()}`,
      method,
      params,
    }),
  });

  if (!response.ok) {
    throw new Error(`Helius request failed: ${response.status} ${response.statusText}`);
  }

  const payload = await response.json() as { error?: { message?: string }; result?: T };
  if (payload.error) {
    throw new Error(payload.error.message || `Helius RPC error calling ${method}`);
  }

  return payload.result as T;
}

export class HeliusProvider implements ChainDataProvider {
  readonly id = "helius" as const;
  readonly config: ChainProviderConfig;
  private readonly apiKey?: string;
  private readonly endpoint: string;

  constructor(config: ChainProviderConfig) {
    this.config = config;
    this.apiKey = process.env.HELIUS_API_KEY;
    this.endpoint = normalizeHeliusEndpoint(
      config.apiBaseUrl || process.env.SOLANA_RPC_URL || DEFAULT_HELIUS_API_BASE,
      this.apiKey,
    );
  }

  getStatus() {
    const warnings: string[] = [];
    if (!this.apiKey) {
      warnings.push("HELIUS_API_KEY is not configured; native portfolio and metadata calls will fail.");
    }
    const transport: "native" | "mcp" | "hybrid" =
      this.config.authMode === "hybrid" ? "hybrid" : this.config.authMode;
    return {
      id: this.id,
      kind: "chain" as const,
      configured: Boolean(this.apiKey),
      enabled: this.config.enabled,
      authMode: this.config.authMode,
      transport,
      mcpServerId: this.config.mcpServerId,
      warnings,
      details: {
        network: this.config.network,
        endpoint: this.endpoint,
      },
    };
  }

  async getWalletOverview(address: string, limit: number = 25): Promise<ChainWalletOverview> {
    if (!this.apiKey) {
      throw new Error("HELIUS_API_KEY is required for native Helius wallet queries.");
    }

    const result = await heliusRpcRequest<{
      items?: Array<Record<string, unknown>>;
      nativeBalance?: number;
      total?: number;
    }>(this.endpoint, "getAssetsByOwner", {
      ownerAddress: address,
      page: 1,
      limit,
      displayOptions: {
        showFungible: true,
      },
    });

    const assets = (result.items || []).map((item, index) => {
      const tokenInfo = (item.token_info || {}) as Record<string, unknown>;
      const content = (item.content || {}) as Record<string, unknown>;
      const metadata = (content.metadata || {}) as Record<string, unknown>;
      return {
        id: String(item.id || `${address}-${index}`),
        symbol: String(metadata.symbol || tokenInfo.symbol || "UNKNOWN"),
        name: metadata.name ? String(metadata.name) : undefined,
        amount: typeof tokenInfo.balance === "number" ? tokenInfo.balance : undefined,
        usdValue: typeof tokenInfo.price_info === "object"
          ? Number((tokenInfo.price_info as Record<string, unknown>).total_price || 0)
          : undefined,
        metadata: item,
      };
    });

    return {
      provider: this.id,
      address,
      nativeBalanceLamports: result.nativeBalance,
      assetCount: result.total ?? assets.length,
      assets,
    };
  }

  async getRecentTransactions(address: string, limit: number = 10): Promise<ChainTransactionSummary[]> {
    const signatures = await heliusRpcRequest<Array<{
      signature: string;
      slot: number;
      blockTime?: number;
      err?: unknown;
      memo?: string | null;
      confirmationStatus?: string;
    }>>(this.endpoint, "getSignaturesForAddress", [
      address,
      { limit },
    ]);

    return signatures.map((entry) => ({
      signature: entry.signature,
      slot: entry.slot,
      timestamp: typeof entry.blockTime === "number"
        ? new Date(entry.blockTime * 1000).toISOString()
        : undefined,
      err: entry.err ? JSON.stringify(entry.err) : null,
      memo: entry.memo ?? null,
      confirmationStatus: entry.confirmationStatus,
    }));
  }

  async getTokenMetadata(mint: string): Promise<ChainTokenMetadata> {
    if (!this.apiKey) {
      throw new Error("HELIUS_API_KEY is required for native Helius token metadata queries.");
    }

    try {
      const asset = await heliusRpcRequest<Record<string, unknown>>(this.endpoint, "getAsset", {
        id: mint,
      });
      const content = (asset.content || {}) as Record<string, unknown>;
      const metadata = (content.metadata || {}) as Record<string, unknown>;
      const tokenInfo = (asset.token_info || {}) as Record<string, unknown>;
      const files = Array.isArray(content.files) ? content.files : [];
      const imageEntry = files.find((file) => typeof file === "object" && file && "uri" in file) as Record<string, unknown> | undefined;

      return {
        mint,
        symbol: metadata.symbol ? String(metadata.symbol) : undefined,
        name: metadata.name ? String(metadata.name) : undefined,
        decimals: typeof tokenInfo.decimals === "number" ? tokenInfo.decimals : undefined,
        description: metadata.description ? String(metadata.description) : undefined,
        image: imageEntry?.uri ? String(imageEntry.uri) : undefined,
        metadata: asset,
      };
    } catch (error) {
      logger.warn("Helius token metadata lookup failed", {
        mint,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
