/**
 * CCXT Pro WebSocket implementation for the ExchangeWebSocket interface.
 *
 * CCXT Pro is bundled free with the base CCXT package (per the CCXT v4
 * docs). It exposes `watch*` methods that maintain incremental data
 * structures and stream updates over WebSocket. 73 of CCXT's 107
 * exchanges support Pro streaming; the rest throw NotSupported on
 * `watch*` calls and are detected at subscribe time.
 *
 * Lifecycle model:
 *   - `connect()`        — no-op; CCXT Pro auto-connects on first watch.
 *   - `subscribeTicker`  — spawns an async loop that awaits the next
 *                          `watchTicker` update, normalizes it, and
 *                          invokes the callback. Loop exits when an
 *                          AbortController fires from `unsubscribe`.
 *   - `subscribeOrderBook` — same shape, via `watchOrderBook`.
 *   - `unsubscribe`      — aborts all per-symbol loops + removes from map.
 *   - `disconnect()`     — aborts every active subscription, then calls
 *                          `client.close()` to release the underlying
 *                          WebSocket connection.
 *
 * Error handling: in-loop errors are caught and classified by
 * `isPermanentSubscribeError`. Transient errors retry with capped
 * exponential backoff (1s→30s); permanent errors (bad symbol, auth,
 * unsupported) abort the subscription so a junk symbol can't spin the
 * loop forever and trigger the exchange to close the shared WS.
 */

import ccxt, { type Exchange as CcxtBase } from "ccxt";
import type {
  ExchangeWebSocket,
  Ticker24hr,
  OrderBook,
} from "../types.ts";
import { createModuleLogger } from "../../logger/index.ts";
import { toCcxtSymbol } from "./ccxt-adapter.ts";

const logger = createModuleLogger("ccxt-websocket");

type CcxtProClass = new (config: Record<string, unknown>) => CcxtBase & {
  watchTicker(symbol: string): Promise<unknown>;
  watchOrderBook(symbol: string, limit?: number): Promise<unknown>;
  close?(): Promise<void>;
};

/**
 * Classify a subscribe-loop error as permanent (non-retryable) or transient.
 *
 * Permanent errors — bad symbol, malformed request, auth/permission failures,
 * unsupported operations — will NEVER succeed on retry, so the loop must stop
 * rather than hammer the exchange every second (which contributes to Binance
 * closing the shared WS with code 1008 and killing valid subscriptions too).
 *
 * Transient errors — network drops, timeouts, exchange-unavailable, generic
 * ExchangeError, and anything unrecognized — default to retryable so an
 * unknown-but-recoverable error never silently stops the stream.
 *
 * Detection is by CCXT error class NAME (`err.constructor.name`, e.g.
 * "BadSymbol") plus message matching, so we don't import the full CCXT error
 * hierarchy.
 */
export function isPermanentSubscribeError(err: unknown): boolean {
  const permanentNames = new Set([
    "BadSymbol",
    "BadRequest",
    "ArgumentsRequired",
    "AuthenticationError",
    "PermissionDenied",
    "NotSupported",
  ]);

  const name = (err as { constructor?: { name?: string } } | null | undefined)
    ?.constructor?.name;
  if (name && permanentNames.has(name)) return true;

  const message = err instanceof Error ? err.message : String(err ?? "");
  if (/does not have market|invalid symbol|symbol .* not found/i.test(message)) {
    return true;
  }

  return false;
}

function resolveCcxtProClass(subId: string): CcxtProClass {
  const pro = (ccxt as unknown as { pro?: Record<string, unknown> }).pro;
  if (!pro) {
    throw new Error("CCXT Pro module not available — install the full `ccxt` package (Pro is bundled).");
  }
  const klass = pro[subId];
  if (typeof klass !== "function") {
    throw new Error(`CCXT Pro does not support WebSocket streaming for '${subId}'. (Pro covers 73 of CCXT's 107 exchanges.)`);
  }
  return klass as CcxtProClass;
}

export interface CcxtWsCredentials {
  apiKey?: string;
  secret?: string;
  password?: string;
}

export class CcxtWebSocketImpl implements ExchangeWebSocket {
  private client: CcxtBase & {
    watchTicker(symbol: string): Promise<unknown>;
    watchOrderBook(symbol: string, limit?: number): Promise<unknown>;
    close?(): Promise<void>;
  };
  private subscriptions = new Map<string, AbortController>();
  private connected = false;
  readonly ccxtSubId: string;

  constructor(ccxtSubId: string, credentials: CcxtWsCredentials, sandbox?: boolean) {
    const Klass = resolveCcxtProClass(ccxtSubId);
    const config: Record<string, unknown> = { enableRateLimit: true };
    if (credentials.apiKey) config.apiKey = credentials.apiKey;
    if (credentials.secret) config.secret = credentials.secret;
    if (credentials.password) config.password = credentials.password;
    this.client = new Klass(config);
    this.ccxtSubId = ccxtSubId;
    if (sandbox) {
      try {
        (this.client as unknown as { setSandboxMode(b: boolean): void }).setSandboxMode(true);
      } catch {
        /* sandbox not supported on this exchange — proceed live */
      }
    }
  }

  async connect(): Promise<void> {
    // CCXT Pro auto-connects on first watch call; this just flips the flag
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    for (const ctrl of this.subscriptions.values()) {
      ctrl.abort();
    }
    this.subscriptions.clear();
    try {
      await this.client.close?.();
    } catch (err) {
      logger.debug("CCXT WS close threw", {
        peer: this.ccxtSubId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
    this.connected = false;
  }

  subscribeTicker(symbol: string, callback: (data: Ticker24hr) => void): void {
    if (!this.connected) this.connected = true;
    const key = `ticker:${symbol}`;
    if (this.subscriptions.has(key)) return; // already subscribed

    const ctrl = new AbortController();
    this.subscriptions.set(key, ctrl);
    const ccxtSymbol = toCcxtSymbol(symbol);

    (async () => {
      let backoffMs = 1000;
      while (!ctrl.signal.aborted) {
        try {
          const t = await this.client.watchTicker(ccxtSymbol);
          if (ctrl.signal.aborted) break;
          backoffMs = 1000;
          callback(normalizeTicker(t));
        } catch (err) {
          if (ctrl.signal.aborted) break;
          const reason = err instanceof Error ? err.message : String(err);
          if (isPermanentSubscribeError(err)) {
            logger.warn("CCXT watchTicker permanent error — stopping subscription", {
              peer: this.ccxtSubId,
              symbol,
              reason,
            });
            ctrl.abort();
            this.subscriptions.delete(key);
            break;
          }
          logger.debug("CCXT watchTicker error — looping", {
            peer: this.ccxtSubId,
            symbol,
            err: reason,
          });
          await new Promise((r) => setTimeout(r, backoffMs));
          backoffMs = Math.min(backoffMs * 2, 30000);
        }
      }
    })();
  }

  subscribeOrderBook(symbol: string, callback: (data: OrderBook) => void): void {
    if (!this.connected) this.connected = true;
    const key = `orderbook:${symbol}`;
    if (this.subscriptions.has(key)) return;

    const ctrl = new AbortController();
    this.subscriptions.set(key, ctrl);
    const ccxtSymbol = toCcxtSymbol(symbol);

    (async () => {
      let backoffMs = 1000;
      while (!ctrl.signal.aborted) {
        try {
          const ob = await this.client.watchOrderBook(ccxtSymbol);
          if (ctrl.signal.aborted) break;
          backoffMs = 1000;
          callback(normalizeOrderBook(ob));
        } catch (err) {
          if (ctrl.signal.aborted) break;
          const reason = err instanceof Error ? err.message : String(err);
          if (isPermanentSubscribeError(err)) {
            logger.warn("CCXT watchOrderBook permanent error — stopping subscription", {
              peer: this.ccxtSubId,
              symbol,
              reason,
            });
            ctrl.abort();
            this.subscriptions.delete(key);
            break;
          }
          logger.debug("CCXT watchOrderBook error — looping", {
            peer: this.ccxtSubId,
            symbol,
            err: reason,
          });
          await new Promise((r) => setTimeout(r, backoffMs));
          backoffMs = Math.min(backoffMs * 2, 30000);
        }
      }
    })();
  }

  unsubscribe(symbol: string): void {
    for (const key of ["ticker", "orderbook"]) {
      const ctrl = this.subscriptions.get(`${key}:${symbol}`);
      if (ctrl) {
        ctrl.abort();
        this.subscriptions.delete(`${key}:${symbol}`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Normalizers
// ---------------------------------------------------------------------------

function normalizeTicker(t: unknown): Ticker24hr {
  const tk = t as Record<string, unknown>;
  return {
    symbol: String(tk.symbol ?? ""),
    priceChange: Number(tk.change ?? 0),
    priceChangePercent: Number(tk.percentage ?? 0),
    lastPrice: Number(tk.last ?? tk.close ?? 0),
    highPrice: Number(tk.high ?? 0),
    lowPrice: Number(tk.low ?? 0),
    volume: Number(tk.baseVolume ?? 0),
    quoteVolume: Number(tk.quoteVolume ?? 0),
    openTime: Number(tk.timestamp ?? Date.now()) - 24 * 60 * 60 * 1000,
    closeTime: Number(tk.timestamp ?? Date.now()),
  };
}

function normalizeOrderBook(ob: unknown): OrderBook {
  const obj = ob as Record<string, unknown>;
  const bids = (obj.bids ?? []) as [number, number][];
  const asks = (obj.asks ?? []) as [number, number][];
  return {
    lastUpdateId: Number(obj.timestamp ?? Date.now()),
    bids: bids.map(([price, quantity]) => ({ price, quantity })),
    asks: asks.map(([price, quantity]) => ({ price, quantity })),
  };
}
