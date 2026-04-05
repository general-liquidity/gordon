/**
 * Gemini Exchange REST Client
 *
 * Supports TWO authentication modes:
 *   1. OAuth 2.0 bearer token (preferred) — obtained via /oauth connect gemini
 *   2. HMAC-SHA384 with API key+secret (legacy) — for users with existing keys
 *
 * Docs: https://docs.gemini.com/rest-api/
 */

import { createHmac } from "node:crypto";
import type {
  GeminiSymbolDetails,
  GeminiTickerV2,
  GeminiPubTicker,
  GeminiOrderBook,
  GeminiBalance,
  GeminiOrder,
  GeminiNewOrderRequest,
  GeminiTrade,
  GeminiCandle,
  GeminiTimeframe,
  GeminiErrorResponse,
} from "./types.ts";

const LIVE_BASE = "https://api.gemini.com";
const SANDBOX_BASE = "https://api.sandbox.gemini.com";

export interface GeminiClientConfig {
  /** OAuth bearer token (takes precedence over HMAC if provided). */
  accessToken?: string;
  /** HMAC API key (used if no accessToken). */
  apiKey?: string;
  /** HMAC API secret (used if no accessToken). */
  apiSecret?: string;
  /** Use sandbox base URL. */
  sandbox?: boolean;
}

export class GeminiError extends Error {
  constructor(
    message: string,
    public readonly reason?: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "GeminiError";
  }
}

export class GeminiClient {
  private readonly baseUrl: string;
  private readonly accessToken?: string;
  private readonly apiKey?: string;
  private readonly apiSecret?: string;
  private nonceCounter: number = Date.now();

  constructor(config: GeminiClientConfig) {
    this.baseUrl = config.sandbox ? SANDBOX_BASE : LIVE_BASE;
    this.accessToken = config.accessToken;
    this.apiKey = config.apiKey;
    this.apiSecret = config.apiSecret;

    if (!this.accessToken && !(this.apiKey && this.apiSecret)) {
      throw new GeminiError(
        "GeminiClient requires either an OAuth accessToken or an apiKey+apiSecret pair",
      );
    }
  }

  // ──────────────────────────── Public endpoints ────────────────────────────

  async getSymbols(): Promise<string[]> {
    return this.publicRequest<string[]>("/v1/symbols");
  }

  async getSymbolDetails(symbol: string): Promise<GeminiSymbolDetails> {
    return this.publicRequest<GeminiSymbolDetails>(`/v1/symbols/details/${symbol}`);
  }

  async getTicker(symbol: string): Promise<GeminiPubTicker> {
    return this.publicRequest<GeminiPubTicker>(`/v1/pubticker/${symbol}`);
  }

  async getTickerV2(symbol: string): Promise<GeminiTickerV2> {
    return this.publicRequest<GeminiTickerV2>(`/v2/ticker/${symbol}`);
  }

  async getOrderBook(
    symbol: string,
    limitBids: number = 50,
    limitAsks: number = 50,
  ): Promise<GeminiOrderBook> {
    const qs = `?limit_bids=${limitBids}&limit_asks=${limitAsks}`;
    return this.publicRequest<GeminiOrderBook>(`/v1/book/${symbol}${qs}`);
  }

  async getCandles(symbol: string, timeframe: GeminiTimeframe): Promise<GeminiCandle[]> {
    return this.publicRequest<GeminiCandle[]>(`/v2/candles/${symbol}/${timeframe}`);
  }

  // ──────────────────────────── Private endpoints ───────────────────────────

  async getBalances(): Promise<GeminiBalance[]> {
    return this.privateRequest<GeminiBalance[]>("/v1/balances");
  }

  async getActiveOrders(): Promise<GeminiOrder[]> {
    return this.privateRequest<GeminiOrder[]>("/v1/orders");
  }

  async getOrderStatus(orderId: string): Promise<GeminiOrder> {
    return this.privateRequest<GeminiOrder>("/v1/order/status", { order_id: orderId });
  }

  async placeOrder(req: GeminiNewOrderRequest): Promise<GeminiOrder> {
    return this.privateRequest<GeminiOrder>("/v1/order/new", req as unknown as Record<string, unknown>);
  }

  async cancelOrder(orderId: string): Promise<GeminiOrder> {
    return this.privateRequest<GeminiOrder>("/v1/order/cancel", { order_id: orderId });
  }

  async cancelAllActiveOrders(): Promise<{ result: string; details: { cancelledOrders: number[]; cancelRejects: number[] } }> {
    return this.privateRequest("/v1/order/cancel/all");
  }

  async getMyTrades(symbol: string, limitTrades: number = 50): Promise<GeminiTrade[]> {
    return this.privateRequest<GeminiTrade[]>("/v1/mytrades", {
      symbol,
      limit_trades: limitTrades,
    });
  }

  // ──────────────────────────── HTTP plumbing ────────────────────────────

  private async publicRequest<T>(path: string): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: "GET",
      headers: { accept: "application/json" },
    });
    return this.handleResponse<T>(response);
  }

  private async privateRequest<T>(
    path: string,
    payload: Record<string, unknown> = {},
  ): Promise<T> {
    const nonce = this.nextNonce();
    const body = {
      request: path,
      nonce,
      ...payload,
    };

    const encodedPayload = Buffer.from(JSON.stringify(body)).toString("base64");
    const headers: Record<string, string> = {
      accept: "application/json",
      "content-type": "text/plain",
      "content-length": "0",
      "cache-control": "no-cache",
      "x-gemini-payload": encodedPayload,
    };

    if (this.accessToken) {
      // OAuth 2.0 bearer auth — signature still required? Per Gemini docs,
      // OAuth requests also use X-GEMINI-PAYLOAD but sign using Bearer instead
      // of X-GEMINI-APIKEY/X-GEMINI-SIGNATURE. Setup differs per OAuth scopes.
      headers.authorization = `Bearer ${this.accessToken}`;
    } else {
      // HMAC-SHA384 signed request
      const signature = createHmac("sha384", this.apiSecret!)
        .update(encodedPayload)
        .digest("hex");
      headers["x-gemini-apikey"] = this.apiKey!;
      headers["x-gemini-signature"] = signature;
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers,
    });
    return this.handleResponse<T>(response);
  }

  private async handleResponse<T>(response: Response): Promise<T> {
    const text = await response.text();

    if (!response.ok) {
      let reason: string | undefined;
      let message: string | undefined;
      try {
        const err = JSON.parse(text) as GeminiErrorResponse;
        reason = err.reason;
        message = err.message;
      } catch {
        // non-JSON error body
      }
      throw new GeminiError(
        message || `Gemini API ${response.status}: ${text.slice(0, 200)}`,
        reason,
        response.status,
      );
    }

    if (!text) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new GeminiError(`Gemini returned non-JSON response: ${text.slice(0, 200)}`);
    }
  }

  private nextNonce(): number {
    // Gemini requires strictly-increasing nonces per API key.
    this.nonceCounter = Math.max(this.nonceCounter + 1, Date.now());
    return this.nonceCounter;
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.getBalances();
      return true;
    } catch {
      return false;
    }
  }
}
