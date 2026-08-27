/**
 * Exchange-agnostic real-time market stream facade.
 *
 * Binance uses the native websocket client (lowest latency). All other
 * venues fall back to polling a public CCXT adapter so monitor + market
 * emitter work on any connected exchange, not just Binance.
 */

import { EventEmitter } from "node:events";
import {
  BinanceWebSocket,
  type KlineUpdate,
  type TickerUpdate,
} from "../venues/exchange/clients/binance/websocket.ts";
import { createModuleLogger } from "../logger/index.ts";
import type { Exchange } from "./types.ts";
import { ccxtIdToNativeVenue, normalizeExchangeId } from "./types.ts";
import { createPublicExchange, PublicExchangeNotSupportedError } from "./publicFactory.ts";

const logger = createModuleLogger("market-stream");

export type MarketStreamTickerUpdate = TickerUpdate;
export type MarketStreamKlineUpdate = KlineUpdate;

type StreamType = "ticker" | "kline";

export interface MarketStream {
  on(event: "ticker", listener: (update: TickerUpdate) => void): this;
  on(event: "kline", listener: (update: KlineUpdate) => void): this;
  on(event: "connected", listener: () => void): this;
  on(event: "disconnected", listener: (reason: string) => void): this;
  on(event: "error", listener: (error: Error) => void): this;
  isConnected(): boolean;
  connect(): Promise<void>;
  disconnect(): void;
  subscribeTicker(symbol: string): void;
  subscribeKline(symbol: string, interval: string): void;
  unsubscribe(type: StreamType, symbol: string, interval?: string): void;
}

const POLL_INTERVAL_MS = 2_000;

class PollingMarketStream extends EventEmitter implements MarketStream {
  private readonly exchange: Exchange;
  private readonly venue: string;
  private tickerSymbols = new Set<string>();
  private klineSubs = new Map<string, string>();
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private connected = false;
  private polling = false;

  constructor(exchangeId: string) {
    super();
    const canonical = normalizeExchangeId(exchangeId);
    const native = ccxtIdToNativeVenue(canonical);
    if (!native) {
      throw new Error(`No public market stream support for exchange "${exchangeId}"`);
    }
    this.venue = native;
    this.exchange = createPublicExchange(native);
  }

  isConnected(): boolean {
    return this.connected;
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    this.connected = true;
    this.emit("connected");
    this.intervalId = setInterval(() => {
      void this.poll();
    }, POLL_INTERVAL_MS);
    await this.poll();
    logger.info("Polling market stream started", { venue: this.venue });
  }

  disconnect(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if (this.connected) {
      this.connected = false;
      this.emit("disconnected", "shutdown");
    }
    this.tickerSymbols.clear();
    this.klineSubs.clear();
  }

  subscribeTicker(symbol: string): void {
    this.tickerSymbols.add(symbol.toUpperCase());
  }

  subscribeKline(symbol: string, interval: string): void {
    this.klineSubs.set(symbol.toUpperCase(), interval);
  }

  unsubscribe(type: StreamType, symbol: string, interval?: string): void {
    const normalized = symbol.toUpperCase();
    if (type === "ticker") {
      this.tickerSymbols.delete(normalized);
      return;
    }
    if (interval && this.klineSubs.get(normalized) === interval) {
      this.klineSubs.delete(normalized);
      return;
    }
    this.klineSubs.delete(normalized);
  }

  private async poll(): Promise<void> {
    if (!this.connected || this.polling) return;
    this.polling = true;
    try {
      for (const symbol of this.tickerSymbols) {
        try {
          const price = await this.exchange.getPrice(symbol);
          this.emit("ticker", {
            symbol,
            price,
            priceChange: 0,
            priceChangePercent: 0,
            volume: 0,
            quoteVolume: 0,
            timestamp: Date.now(),
          } satisfies TickerUpdate);
        } catch (error) {
          logger.debug("Ticker poll failed", {
            venue: this.venue,
            symbol,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      for (const [symbol, interval] of this.klineSubs) {
        try {
          const candles = await this.exchange.getCandles(symbol, interval, 2);
          const latest = candles[candles.length - 1];
          if (!latest) continue;
          this.emit("kline", {
            symbol,
            interval,
            open: latest.open,
            high: latest.high,
            low: latest.low,
            close: latest.close,
            volume: latest.volume,
            closeTime: latest.closeTime,
            isClosed: true,
          } satisfies KlineUpdate);
        } catch (error) {
          logger.debug("Kline poll failed", {
            venue: this.venue,
            symbol,
            interval,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    } finally {
      this.polling = false;
    }
  }
}

export function supportsNativeMarketStream(exchangeId: string): boolean {
  return ccxtIdToNativeVenue(normalizeExchangeId(exchangeId)) === "binance";
}

export function createMarketStream(exchangeId: string): MarketStream {
  const native = ccxtIdToNativeVenue(normalizeExchangeId(exchangeId));
  if (native === "binance") {
    return new BinanceWebSocket();
  }
  try {
    return new PollingMarketStream(exchangeId);
  } catch (error) {
    if (error instanceof PublicExchangeNotSupportedError) {
      throw error;
    }
    throw error;
  }
}
