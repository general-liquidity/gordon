import { createModuleLogger } from "../../infra/logger/index.ts";
import { loadConfig } from "../../infra/storage/config/config.ts";
import { checkEnvStatus, loadEnvFile } from "../../infra/storage/config/env.ts";
import { getCurrentSession } from "../../infra/storage/entities/session.ts";
import { createLLMClientFromEnv } from "../../infra/ai/llm/index.ts";
import { BinanceClient } from "../../infra/venues/exchange/clients/binance/index.ts";
import { BinanceAdapter, ExchangeFactory, type Exchange } from "../../infra/exchange/index.ts";
import { BrokerFactory } from "../../infra/broker/factory.ts";
import { BROKER_ENV_MAP, type BrokerId } from "../../infra/broker/types.ts";
import { isBrokerPaperSupported } from "../../infra/broker/brokerPaperSupport.ts";
import { getSandboxOverride } from "../../infra/runtime/sandboxOverride.ts";
import { createAgentRailsRegistry } from "../../infra/runtime/rails/index.ts";
import type { LLMClient } from "../../infra/ai/llm/index.ts";
import type { GordonContext } from "../../infra/agents/types.ts";
import type { BrokerAdapter } from "../../infra/broker/types.ts";

const logger = createModuleLogger("gateway-context");

interface CachedContext {
  exchange: Exchange | null;
  binance: BinanceClient | null;
  broker: BrokerAdapter | null;
  llm: LLMClient | null;
  portfolioValue: number;
  availableCash: number;
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
    const { exchange, binance, broker, llm, portfolioValue, availableCash } = await this.resolveClients(config);
    const session = await getCurrentSession();

    return {
      binance,
      exchange,
      broker,
      agentRails: createAgentRailsRegistry(config),
      llm: (llm ?? ({} as LLMClient)),
      config,
      portfolioValue,
      availableCash,
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
    broker: BrokerAdapter | null;
    llm: LLMClient | null;
    portfolioValue: number;
    availableCash: number;
  }> {
    if (this.cache && Date.now() - this.cache.updatedAt < this.ttlMs) {
      return {
        exchange: this.cache.exchange,
        binance: this.cache.binance,
        broker: this.cache.broker,
        llm: this.cache.llm,
        portfolioValue: this.cache.portfolioValue,
        availableCash: this.cache.availableCash,
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

    const sandboxOverride = getSandboxOverride();

    let exchange: Exchange | null = null;
    let binance: BinanceClient | null = null;

    if (config.exchanges.length > 0) {
      const activeId = config.activeExchangeId || config.exchanges.find((ex) => ex.isDefault)?.id;
      const active = config.exchanges.find((ex) => ex.id === activeId) || config.exchanges[0];
      if (active) {
        const useSandbox = sandboxOverride !== null ? sandboxOverride : active.sandbox;
        try {
          exchange = ExchangeFactory.create(active.type, {
            apiKey: active.apiKey,
            apiSecret: active.apiSecret,
            passphrase: active.passphrase,
            sandbox: useSandbox,
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

    if (!exchange && env.hasRobinhoodKeys && env.keys.ROBINHOOD_API_KEY && env.keys.ROBINHOOD_API_SECRET) {
      try {
        exchange = ExchangeFactory.create("robinhood", {
          apiKey: env.keys.ROBINHOOD_API_KEY,
          apiSecret: env.keys.ROBINHOOD_API_SECRET,
        });
      } catch (error) {
        logger.warn("Failed to initialize Robinhood fallback exchange for gateway", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Resolve the first broker that has env-var credentials configured.
    let broker: BrokerAdapter | null = null;
    for (const brokerId of Object.keys(BROKER_ENV_MAP) as BrokerId[]) {
      const envEntry = BROKER_ENV_MAP[brokerId];
      const apiKey = process.env[envEntry.key] || "";
      const apiSecret = process.env[envEntry.secret] || "";
      if (!apiKey || !apiSecret) continue;

      // Determine paper mode: sandboxOverride wins, then env var, then false.
      const paperFromEnv = envEntry.paper
        ? parseBoolEnv(process.env[envEntry.paper])
        : false;
      const paperMode = sandboxOverride !== null
        ? (sandboxOverride && isBrokerPaperSupported(brokerId))
        : paperFromEnv;

      try {
        broker = await BrokerFactory.createWithAuth(brokerId, {
          apiKey,
          apiSecret,
          paper: paperMode,
          accountId: envEntry.accountId ? process.env[envEntry.accountId] : undefined,
        });
        break;
      } catch (error) {
        logger.warn(`Failed to initialize ${brokerId} broker for gateway`, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Fetch live portfolio data from exchange
    let portfolioValue = 0;
    let availableCash = 0;

    if (exchange) {
      try {
        const details = await exchange.getFullAccountDetails();
        portfolioValue = details.totalUsdtValue;

        const stableAssets = ["USD", "USDT", "BUSD", "USDC", "FDUSD"];
        for (const asset of stableAssets) {
          try {
            availableCash += await exchange.getBalance(asset);
          } catch {
            // Asset not found or no balance
          }
        }
      } catch (error) {
        logger.warn("Failed to fetch portfolio data from exchange", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    this.cache = {
      exchange,
      binance,
      broker,
      llm,
      portfolioValue,
      availableCash,
      updatedAt: Date.now(),
    };

    return { exchange, binance, broker, llm, portfolioValue, availableCash };
  }
}

function parseBoolEnv(value: string | undefined): boolean {
  if (!value) return false;
  const v = value.trim().toLowerCase();
  return ["1", "true", "yes", "on", "paper"].includes(v);
}

// Singleton — allows tools to toggle sandbox mode and bust the cache
// without restarting the daemon.
let _instance: GatewayContextResolver | null = null;

export function getGatewayContextResolver(): GatewayContextResolver {
  if (!_instance) _instance = new GatewayContextResolver();
  return _instance;
}
