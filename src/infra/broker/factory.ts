/**
 * Broker Factory
 * Creates and caches broker adapter instances.
 */

import { AlpacaAdapter } from "./adapters/alpaca.ts";
import { TastytradeAdapter } from "./adapters/tastytrade.ts";
import { IbkrAdapter } from "./adapters/ibkr.ts";
import {
  assertBrokerPassesInclusionGate,
  getBrokerInclusionDecision,
  validateBrokerInclusionGate,
} from "./quality/inclusion-gate.ts";
import { loadOAuthBrokerCredentials, brokerSupportsOAuth } from "./auth/oauth-bridge.ts";
import { assertBrokerPaperSupported } from "./brokerPaperSupport.ts";
import type { BrokerAdapter, BrokerCredentials, BrokerId } from "./types.ts";

const SUPPORTED_BROKERS: BrokerId[] = ["alpaca", "tastytrade", "ibkr"];

function getCacheKey(brokerId: BrokerId, credentials: BrokerCredentials): string {
  const keyPrefix = credentials.apiKey.substring(0, 8);
  const mode = (credentials.paper ?? true) ? "paper" : "live";
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
        `Unsupported broker: ${brokerId}. Supported brokers: ${SUPPORTED_BROKERS.join(", ")}`,
      );
    }
    assertBrokerPassesInclusionGate(brokerId);
    // Fail fast at construction instead of on the first paper-routed method call.
    assertBrokerPaperSupported(brokerId, credentials.paper === true);

    const cacheKey = getCacheKey(brokerId, credentials);
    const cached = BrokerFactory.instanceCache.get(cacheKey);
    if (cached) return cached;

    let broker: BrokerAdapter;
    switch (brokerId) {
      case "alpaca":
        broker = new AlpacaAdapter(credentials);
        break;
      case "tastytrade":
        broker = new TastytradeAdapter(credentials);
        break;
      case "ibkr":
        broker = new IbkrAdapter(credentials);
        break;
      default:
        throw new Error(`No adapter available for broker: ${brokerId}`);
    }

    BrokerFactory.instanceCache.set(cacheKey, broker);
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
        return BrokerFactory.create(brokerId, oauthCreds);
      }
    }
    return BrokerFactory.create(brokerId, fallbackCredentials);
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
    BrokerFactory.instanceCache.clear();
  }

  static removeFromCache(brokerId: BrokerId, credentials: BrokerCredentials): void {
    BrokerFactory.instanceCache.delete(getCacheKey(brokerId, credentials));
  }

  static getCacheSize(): number {
    return BrokerFactory.instanceCache.size;
  }
}
