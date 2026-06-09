/**
 * Syphonix broker adapter — Model to Market competition venue (FX, gold/silver,
 * crypto; leverage available; paper sim).
 *
 * SCAFFOLD. This implements Gordon's `BrokerAdapter` contract, registers in the
 * factory, reads env/credential config, declares competition-appropriate
 * capabilities, and carries `clientOrderId` idempotency — but the wire-level
 * HTTP (endpoints, auth, payload shapes) is PENDING the Syphonix API spec
 * released at the kickoff (2026-06-15). Until then the live methods throw a
 * clear "spec pending" error AND the broker inclusion gate keeps it
 * `approved: false` (documentedExecutionEndpoints), so `BrokerFactory.create`
 * refuses to instantiate it and it cannot place a trade.
 *
 * June-15 steps: docs/model-to-market/SYPHONIX_INTEGRATION.md.
 */

import type { Candle } from "../../../types/index.ts";
import type {
  BrokerAccount,
  BrokerAdapter,
  BrokerCapabilities,
  BrokerClock,
  BrokerCredentials,
  BrokerHistoricalBarsParams,
  BrokerId,
  BrokerOrder,
  BrokerOrderListParams,
  BrokerOrderRequest,
  BrokerPosition,
  BrokerQuote,
} from "../types.ts";

const SPEC_PENDING_MESSAGE =
  "Syphonix API integration is pending the spec released at the Model to Market kickoff (2026-06-15). " +
  "See docs/model-to-market/SYPHONIX_INTEGRATION.md — the adapter is gated OFF until then.";

export class SyphonixAdapter implements BrokerAdapter {
  readonly brokerId: BrokerId = "syphonix";
  readonly displayName = "Syphonix";
  readonly isPaper: boolean;
  readonly capabilities: BrokerCapabilities = {
    supportsMarketOrders: true,
    supportsLimitOrders: true,
    supportsExtendedHours: false, // 24/7 markets — session concept N/A
    supportsFractionalShares: true, // FX/metals/crypto are notional/fractional
    supportsShortSelling: true, // leverage available
    supportsOptions: false, // "options support coming soon" per the brief
    supportsStreaming: true, // real-time market simulation feed
    supportsPaperTrading: true, // the competition is a paper sim
    supportsHistoricalBars: true,
  };

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly sessionId: string;
  private clientOrderCounter = 0;

  constructor(credentials: BrokerCredentials) {
    this.apiKey = credentials.apiKey;
    this.isPaper = credentials.paper ?? true;
    // Filled from the spec on 2026-06-15 (credentials.baseUrl or env override).
    this.baseUrl = credentials.baseUrl ?? process.env.GORDON_SYPHONIX_BASE_URL ?? "";
    this.sessionId = (credentials.accountId ?? "sess").slice(0, 8);
  }

  /** Exchange-level idempotency key so a retried order never double-fills. */
  private nextClientOrderId(): string {
    return `gordon_syph_${this.sessionId}_${this.clientOrderCounter++}`;
  }

  private pending(method: string): never {
    throw new Error(`Syphonix.${method}: ${SPEC_PENDING_MESSAGE}`);
  }

  async testConnection(): Promise<boolean> {
    // No documented endpoint/auth yet → not connectable.
    return false;
  }

  async getClock(): Promise<BrokerClock> {
    return this.pending("getClock");
  }

  async getAccount(): Promise<BrokerAccount> {
    return this.pending("getAccount");
  }

  async getPositions(): Promise<BrokerPosition[]> {
    return this.pending("getPositions");
  }

  async getOpenOrders(_limit?: number): Promise<BrokerOrder[]> {
    return this.pending("getOpenOrders");
  }

  async listOrders(_params?: BrokerOrderListParams): Promise<BrokerOrder[]> {
    return this.pending("listOrders");
  }

  async getOrder(_orderId: string): Promise<BrokerOrder> {
    return this.pending("getOrder");
  }

  async placeOrder(_params: BrokerOrderRequest): Promise<BrokerOrder> {
    // June 15: build the payload from _params, attach this.nextClientOrderId()
    // for idempotency, POST to the Syphonix order endpoint, map the response.
    void this.nextClientOrderId;
    return this.pending("placeOrder");
  }

  async cancelOrder(_orderId: string): Promise<void> {
    return this.pending("cancelOrder");
  }

  async cancelAllOrders(): Promise<void> {
    return this.pending("cancelAllOrders");
  }

  async getLatestQuote(_symbol: string): Promise<BrokerQuote> {
    return this.pending("getLatestQuote");
  }

  async getHistoricalBars(_params: BrokerHistoricalBarsParams): Promise<Candle[]> {
    return this.pending("getHistoricalBars");
  }
}
