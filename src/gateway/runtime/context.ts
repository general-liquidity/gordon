import { createModuleLogger } from "../../infra/logger/index.ts";
import { loadConfig } from "../../infra/storage/config.ts";
import { checkEnvStatus, loadEnvFile } from "../../infra/storage/env.ts";
import { getCurrentSession } from "../../infra/storage/session.ts";
import { createLLMClientFromEnv } from "../../infra/llm/index.ts";
import { BinanceClient } from "../../infra/binance/index.ts";
import { BinanceAdapter, ExchangeFactory, type Exchange } from "../../infra/exchange/index.ts";
import type { LLMClient } from "../../infra/llm/index.ts";
import type { GordonContext } from "../../infra/agents/types.ts";

const logger = createModuleLogger("gateway-context");

interface CachedContext {
  exchange: Exchange | null;
  binance: BinanceClient | null;
  llm: LLMClient | null;
  updatedAt: number;
}

export class GatewayContextResolver {
  private cache: CachedContext | null = null;
  private readonly ttlMs: number;

  constructor(ttlMs: number = 30_000) {
    this.ttlMs = ttlMs;
  }

  async resolve(sessionId: string): Promise<GordonContext> {
    const config = await loadConfig();
    const { exchange, binance, llm } = await this.resolveClients(config);
    const session = await getCurrentSession();

    return {
      binance,
      exchange,
      llm: (llm ?? ({} as LLMClient)),
      config,
      portfolioValue: 0,
      availableCash: 0,
      userId: session.resourceId || sessionId,
      threadId: session.threadId ?? undefined,
    };
  }

  invalidate(): void {
    this.cache = null;
  }

  private async resolveClients(config: Awaited<ReturnType<typeof loadConfig>>): Promise<{
    exchange: Exchange | null;
    binance: BinanceClient | null;
    llm: LLMClient | null;
  }> {
    if (this.cache && Date.now() - this.cache.updatedAt < this.ttlMs) {
      return {
        exchange: this.cache.exchange,
        binance: this.cache.binance,
        llm: this.cache.llm,
      };
    }

    await loadEnvFile();
    const env = await checkEnvStatus();

    let llm: LLMClient | null = null;
    try {
      llm = createLLMClientFromEnv();
    } catch (error) {
      logger.warn("LLM client unavailable in gateway context", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    let exchange: Exchange | null = null;
    let binance: BinanceClient | null = null;

    if (config.exchanges.length > 0) {
      const activeId = config.activeExchangeId || config.exchanges.find((ex) => ex.isDefault)?.id;
      const active = config.exchanges.find((ex) => ex.id === activeId) || config.exchanges[0];
      if (active) {
        try {
          exchange = ExchangeFactory.create(active.type, {
            apiKey: active.apiKey,
            apiSecret: active.apiSecret,
            passphrase: active.passphrase,
            sandbox: active.sandbox,
            walletPrivateKey: active.walletPrivateKey,
          });

          if (active.type === "binance" || active.type === "binance_us") {
            const baseUrl = active.type === "binance_us" ? "https://api.binance.us" : undefined;
            binance = new BinanceClient(active.apiKey, active.apiSecret, baseUrl);
          }
        } catch (error) {
          logger.warn("Failed to initialize configured exchange for gateway", {
            error: error instanceof Error ? error.message : String(error),
            exchangeId: active.id,
          });
        }
      }
    }

    if (!exchange && env.hasBinanceKeys && env.keys.BINANCE_API_KEY && env.keys.BINANCE_API_SECRET) {
      try {
        binance = new BinanceClient(env.keys.BINANCE_API_KEY, env.keys.BINANCE_API_SECRET);
        exchange = new BinanceAdapter(env.keys.BINANCE_API_KEY, env.keys.BINANCE_API_SECRET);
      } catch (error) {
        logger.warn("Failed to initialize Binance fallback exchange for gateway", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    this.cache = {
      exchange,
      binance,
      llm,
      updatedAt: Date.now(),
    };

    return { exchange, binance, llm };
  }
}

