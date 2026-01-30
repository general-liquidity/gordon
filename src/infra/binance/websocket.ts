/**
 * Binance WebSocket Client
 *
 * Real-time market data streaming via WebSocket with:
 * - Automatic reconnection
 * - Multiple stream subscriptions
 * - Event-based updates
 */

import { EventEmitter } from "events";

export interface WSConfig {
  baseUrl: string;
  reconnectDelayMs: number;
  maxReconnectAttempts: number;
  pingIntervalMs: number;
  pongTimeoutMs: number;
}

export const DEFAULT_WS_CONFIG: WSConfig = {
  baseUrl: "wss://stream.binance.com:9443/ws",
  reconnectDelayMs: 1000,
  maxReconnectAttempts: 10,
  pingIntervalMs: 30000,
  pongTimeoutMs: 10000,
};

export interface TickerUpdate {
  symbol: string;
  price: number;
  priceChange: number;
  priceChangePercent: number;
  volume: number;
  quoteVolume: number;
  timestamp: number;
}

export interface TradeUpdate {
  symbol: string;
  price: number;
  quantity: number;
  isBuyerMaker: boolean;
  timestamp: number;
  tradeId: number;
}

export interface KlineUpdate {
  symbol: string;
  interval: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
  isClosed: boolean;
}

export interface DepthUpdate {
  symbol: string;
  bids: Array<[string, string]>;
  asks: Array<[string, string]>;
  lastUpdateId: number;
}

type StreamType = "ticker" | "trade" | "kline" | "depth";

interface StreamSubscription {
  type: StreamType;
  symbol: string;
  interval?: string;
}

export type WSEventMap = {
  connected: [];
  disconnected: [reason: string];
  reconnecting: [attempt: number];
  error: [error: Error];
  ticker: [update: TickerUpdate];
  trade: [update: TradeUpdate];
  kline: [update: KlineUpdate];
  depth: [update: DepthUpdate];
};

export class BinanceWebSocket extends EventEmitter {
  private ws: WebSocket | null = null;
  private config: WSConfig;
  private subscriptions: Map<string, StreamSubscription> = new Map();
  private reconnectAttempts = 0;
  private isConnecting = false;
  private isClosing = false;
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private pongTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(config: Partial<WSConfig> = {}) {
    super();
    this.config = { ...DEFAULT_WS_CONFIG, ...config };
  }

  async connect(): Promise<void> {
    if (this.ws || this.isConnecting) {
      return;
    }

    this.isConnecting = true;
    this.isClosing = false;

    try {
      await this.createConnection();
      this.reconnectAttempts = 0;
      this.emit("connected");
      this.startPingInterval();
    } catch (error) {
      this.isConnecting = false;
      throw error;
    }
  }

  private createConnection(): Promise<void> {
    return new Promise((resolve, reject) => {
      const streams = this.buildStreamPath();
      const url = streams ? `${this.config.baseUrl}/${streams}` : this.config.baseUrl;

      this.ws = new WebSocket(url);

      const onOpen = () => {
        this.ws?.removeEventListener("error", onError);
        this.isConnecting = false;
        resolve();
      };

      const onError = (event: Event) => {
        this.ws?.removeEventListener("open", onOpen);
        this.isConnecting = false;
        reject(new Error(`WebSocket connection failed: ${event.type}`));
      };

      this.ws.addEventListener("open", onOpen, { once: true });
      this.ws.addEventListener("error", onError, { once: true });

      this.ws.addEventListener("message", this.handleMessage.bind(this));
      this.ws.addEventListener("close", this.handleClose.bind(this));
      this.ws.addEventListener("error", this.handleError.bind(this));
    });
  }

  private buildStreamPath(): string {
    const streams: string[] = [];

    for (const sub of this.subscriptions.values()) {
      const symbol = sub.symbol.toLowerCase();
      switch (sub.type) {
        case "ticker":
          streams.push(`${symbol}@miniTicker`);
          break;
        case "trade":
          streams.push(`${symbol}@aggTrade`);
          break;
        case "kline":
          streams.push(`${symbol}@kline_${sub.interval || "1m"}`);
          break;
        case "depth":
          streams.push(`${symbol}@depth@100ms`);
          break;
      }
    }

    return streams.join("/");
  }

  private handleMessage(event: MessageEvent): void {
    try {
      const data = JSON.parse(event.data as string);

      // Handle pong
      if (data.pong) {
        this.clearPongTimeout();
        return;
      }

      // Handle stream data
      if (data.e) {
        this.parseAndEmit(data);
      } else if (data.stream && data.data) {
        this.parseAndEmit(data.data);
      }
    } catch (error) {
      this.emit("error", error instanceof Error ? error : new Error(String(error)));
    }
  }

  private parseAndEmit(data: Record<string, unknown>): void {
    const eventType = data.e as string;

    switch (eventType) {
      case "24hrMiniTicker":
        this.emit("ticker", this.parseTicker(data));
        break;
      case "aggTrade":
        this.emit("trade", this.parseTrade(data));
        break;
      case "kline":
        this.emit("kline", this.parseKline(data));
        break;
      case "depthUpdate":
        this.emit("depth", this.parseDepth(data));
        break;
    }
  }

  private parseTicker(data: Record<string, unknown>): TickerUpdate {
    return {
      symbol: data.s as string,
      price: parseFloat(data.c as string),
      priceChange: parseFloat(data.p as string || "0"),
      priceChangePercent: parseFloat(data.P as string || "0"),
      volume: parseFloat(data.v as string),
      quoteVolume: parseFloat(data.q as string),
      timestamp: data.E as number,
    };
  }

  private parseTrade(data: Record<string, unknown>): TradeUpdate {
    return {
      symbol: data.s as string,
      price: parseFloat(data.p as string),
      quantity: parseFloat(data.q as string),
      isBuyerMaker: data.m as boolean,
      timestamp: data.T as number,
      tradeId: data.a as number,
    };
  }

  private parseKline(data: Record<string, unknown>): KlineUpdate {
    const k = data.k as Record<string, unknown>;
    return {
      symbol: data.s as string,
      interval: k.i as string,
      open: parseFloat(k.o as string),
      high: parseFloat(k.h as string),
      low: parseFloat(k.l as string),
      close: parseFloat(k.c as string),
      volume: parseFloat(k.v as string),
      closeTime: k.T as number,
      isClosed: k.x as boolean,
    };
  }

  private parseDepth(data: Record<string, unknown>): DepthUpdate {
    return {
      symbol: data.s as string,
      bids: data.b as Array<[string, string]>,
      asks: data.a as Array<[string, string]>,
      lastUpdateId: data.u as number,
    };
  }

  private handleClose(event: CloseEvent): void {
    this.cleanup();

    if (this.isClosing) {
      this.emit("disconnected", "Manual close");
      return;
    }

    this.emit("disconnected", `Code: ${event.code}, Reason: ${event.reason || "Unknown"}`);
    this.attemptReconnect();
  }

  private handleError(event: Event): void {
    this.emit("error", new Error(`WebSocket error: ${event.type}`));
  }

  private async attemptReconnect(): Promise<void> {
    if (this.isClosing || this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      return;
    }

    this.reconnectAttempts++;
    this.emit("reconnecting", this.reconnectAttempts);

    const delay = this.config.reconnectDelayMs * Math.pow(2, this.reconnectAttempts - 1);
    await new Promise((resolve) => setTimeout(resolve, delay));

    if (!this.isClosing) {
      try {
        await this.connect();
      } catch {
        // Will retry in handleClose if needed
      }
    }
  }

  private startPingInterval(): void {
    this.pingInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ ping: Date.now() }));
        this.setPongTimeout();
      }
    }, this.config.pingIntervalMs);
  }

  private setPongTimeout(): void {
    this.pongTimeout = setTimeout(() => {
      this.ws?.close(4000, "Pong timeout");
    }, this.config.pongTimeoutMs);
  }

  private clearPongTimeout(): void {
    if (this.pongTimeout) {
      clearTimeout(this.pongTimeout);
      this.pongTimeout = null;
    }
  }

  private cleanup(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    this.clearPongTimeout();
    this.ws = null;
  }

  subscribe(type: StreamType, symbol: string, interval?: string): void {
    const key = `${type}:${symbol}:${interval || ""}`;
    this.subscriptions.set(key, { type, symbol, interval });

    // If connected, send subscribe message
    if (this.ws?.readyState === WebSocket.OPEN) {
      const stream = this.getStreamName(type, symbol, interval);
      this.ws.send(JSON.stringify({
        method: "SUBSCRIBE",
        params: [stream],
        id: Date.now(),
      }));
    }
  }

  unsubscribe(type: StreamType, symbol: string, interval?: string): void {
    const key = `${type}:${symbol}:${interval || ""}`;
    this.subscriptions.delete(key);

    if (this.ws?.readyState === WebSocket.OPEN) {
      const stream = this.getStreamName(type, symbol, interval);
      this.ws.send(JSON.stringify({
        method: "UNSUBSCRIBE",
        params: [stream],
        id: Date.now(),
      }));
    }
  }

  private getStreamName(type: StreamType, symbol: string, interval?: string): string {
    const s = symbol.toLowerCase();
    switch (type) {
      case "ticker":
        return `${s}@miniTicker`;
      case "trade":
        return `${s}@aggTrade`;
      case "kline":
        return `${s}@kline_${interval || "1m"}`;
      case "depth":
        return `${s}@depth@100ms`;
    }
  }

  subscribeTicker(symbol: string): void {
    this.subscribe("ticker", symbol);
  }

  subscribeTrade(symbol: string): void {
    this.subscribe("trade", symbol);
  }

  subscribeKline(symbol: string, interval: string): void {
    this.subscribe("kline", symbol, interval);
  }

  subscribeDepth(symbol: string): void {
    this.subscribe("depth", symbol);
  }

  disconnect(): void {
    this.isClosing = true;
    this.cleanup();
    if (this.ws) {
      this.ws.close(1000, "Manual disconnect");
      this.ws = null;
    }
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  getSubscriptions(): StreamSubscription[] {
    return Array.from(this.subscriptions.values());
  }
}

export function createBinanceWebSocket(config?: Partial<WSConfig>): BinanceWebSocket {
  return new BinanceWebSocket(config);
}
