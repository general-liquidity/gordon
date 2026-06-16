/**
 * Broker Factory
 * Creates and caches broker adapter instances.
 */

import { AlpacaAdapter } from "./adapters/alpaca.ts";
import { WebullAdapter } from "./adapters/webull.ts";
import { SchwabAdapter } from "./adapters/schwab.ts";
import { TradierAdapter } from "./adapters/tradier.ts";
import { TradeStationAdapter } from "./adapters/tradestation.ts";
import { TastytradeAdapter } from "./adapters/tastytrade.ts";
import { Trading212Adapter } from "./adapters/trading212.ts";
import { EtradeAdapter } from "./adapters/etrade.ts";
import { IbkrAdapter } from "./adapters/ibkr.ts";
import { SyphonixAdapter } from "./adapters/syphonix.ts";
import { Mt5Adapter } from "./adapters/mt5.ts";
import {
  assertBrokerPassesInclusionGate,
  getBrokerInclusionDecision,
  validateBrokerInclusionGate,
} from "./quality/inclusion-gate.ts";
import { loadOAuthBrokerCredentials, brokerSupportsOAuth } from "./auth/oauth-bridge.ts";
import { assertBrokerPaperSupported } from "./brokerPaperSupport.ts";
import type { BrokerAdapter, BrokerCredentials, BrokerId } from "./types.ts";

const SUPPORTED_BROKERS: BrokerId[] = [
  "alpaca",
  "webull",
  "schwab",
  "tradier",
  "tradestation",
  "tastytrade",
  "trading212",
  "etrade",
  "ibkr",
  "mt5", // Model to Market competition execution path (via the MT5 bridge sidecar).
  // "syphonix" is intentionally NOT listed — there is no Syphonix REST API;
  // trading goes through "mt5". The scaffold stays gated off.
];

function getCacheKey(brokerId: BrokerId, credentials: BrokerCredentials): string {
  const keyPrefix = credentials.apiKey.substring(0, 8);
  const mode = credentials.paper ?? true ? "paper" : "live";
  return `${brokerId}:${keyPrefix}:${mode}`;
}

/**
 * BrokerFactory - creates and manages broker adapter instances.
 */
export class BrokerFactory {
  private static instanceCache: Map<string, BrokerAdapter> = new Map();

  static create(brokerId: BrokerId, credentials: BrokerCredentials): BrokerAdapter {
    if (!SUPPORTED_BROKERS.includes(brokerId)) {
      throw new Error(
        `Unsupported broker: ${brokerId}. Supported brokers: ${SUPPORTED_BROKERS.join(", ")}`
      );
    }
    assertBrokerPassesInclusionGate(brokerId);
    // Fail fast at construction instead of on the first paper-routed method call.
    assertBrokerPaperSupported(brokerId, credentials.paper === true);

    const cacheKey = getCacheKey(brokerId, credentials);
    const cached = this.instanceCache.get(cacheKey);
    if (cached) return cached;

    let broker: BrokerAdapter;
    switch (brokerId) {
      case "alpaca":
        broker = new AlpacaAdapter(credentials);
        break;
      case "webull":
        broker = new WebullAdapter(credentials);
        break;
      case "schwab":
        broker = new SchwabAdapter(credentials);
        break;
      case "tradier":
        broker = new TradierAdapter(credentials);
        break;
      case "tradestation":
        broker = new TradeStationAdapter(credentials);
        break;
      case "tastytrade":
        broker = new TastytradeAdapter(credentials);
        break;
      case "trading212":
        broker = new Trading212Adapter(credentials);
        break;
      case "etrade":
        broker = new EtradeAdapter(credentials);
        break;
      case "ibkr":
        broker = new IbkrAdapter(credentials);
        break;
      case "syphonix":
        broker = new SyphonixAdapter(credentials);
        break;
      case "mt5":
        broker = new Mt5Adapter(credentials);
        break;
      default:
        throw new Error(`No adapter available for broker: ${brokerId}`);
    }

    this.instanceCache.set(cacheKey, broker);
    return broker;
  }

  /**
   * Create a broker adapter, preferring OAuth tokens from the oauth-store
   * over static API keys when the broker supports OAuth and a connection exists.
   */
  static async createWithAuth(
    brokerId: BrokerId,
    fallbackCredentials: BrokerCredentials,
    oauthClientId?: string,
  ): Promise<BrokerAdapter> {
    if (brokerSupportsOAuth(brokerId)) {
      const oauthCreds = await loadOAuthBrokerCredentials(brokerId, {
        clientId: oauthClientId,
        paper: fallbackCredentials.paper,
        accountId: fallbackCredentials.accountId,
        baseUrl: fallbackCredentials.baseUrl,
      });
      if (oauthCreds) {
        return this.create(brokerId, oauthCreds);
      }
    }
    return this.create(brokerId, fallbackCredentials);
  }

  static brokerSupportsOAuth(brokerId: BrokerId): boolean {
    return brokerSupportsOAuth(brokerId);
  }

  static getSupportedBrokers(): BrokerId[] {
    return [...SUPPORTED_BROKERS];
  }

  static isSupported(brokerId: string): brokerId is BrokerId {
    return SUPPORTED_BROKERS.includes(brokerId as BrokerId);
  }

  static getInclusionDecision(brokerId: BrokerId) {
    return getBrokerInclusionDecision(brokerId);
  }

  static validateInclusionGate() {
    return validateBrokerInclusionGate(SUPPORTED_BROKERS);
  }

  static clearCache(): void {
    this.instanceCache.clear();
  }

  static removeFromCache(brokerId: BrokerId, credentials: BrokerCredentials): void {
    this.instanceCache.delete(getCacheKey(brokerId, credentials));
  }

  static getCacheSize(): number {
    return this.instanceCache.size;
  }
}
