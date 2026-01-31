/**
 * Binance WebSocket Client
 *
 * Real-time market data streaming via WebSocket with:
 * - Automatic reconnection with exponential backoff
 * - Heartbeat mechanism (ping every 30s)
 * - Connection state tracking and events
 * - Multiple stream subscriptions
 * - Event-based updates
 */

import { EventEmitter } from "events";
import { createModuleLogger } from "../logger/index.ts";

const logger = createModuleLogger("binance-ws");

export interface WSConfig {
  baseUrl: string;
  reconnectDelayMs: number;
  maxReconnectDelayMs: number;
  maxReconnectAttempts: number;
  pingIntervalMs: number;
  pongTimeoutMs: number;
  /** Jitter percentage for reconnect delay (0-1) */
  reconnectJitter: number;
}

export const DEFAULT_WS_CONFIG: WSConfig = {
  baseUrl: "wss://stream.binance.com:9443/ws",
  reconnectDelayMs: 1000,
  maxReconnectDelayMs: 60000,
  maxReconnectAttempts: 10,
  pingIntervalMs: 30000,
  pongTimeoutMs: 10000,
  reconnectJitter: 0.3,
};

/**
 * Connection state enumeration
 */
export type ConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "failed";

/**
 * Connection state details
 */
export interface ConnectionStatus {
  state: ConnectionState;
  connectedAt: Date | null;
  disconnectedAt: Date | null;
  reconnectAttempts: number;
  lastPingAt: Date | null;
  lastPongAt: Date | null;
  latencyMs: number | null;
  consecutiveFailures: number;
}

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
  reconnected: [];
  error: [error: Error];
  ticker: [update: TickerUpdate];
  trade: [update: TradeUpdate];
  kline: [update: KlineUpdate];
  depth: [update: DepthUpdate];
  /** Emitted when connection state changes */
  stateChange: [state: ConnectionState, previousState: ConnectionState];
  /** Emitted on successful ping/pong */
  heartbeat: [latencyMs: number];
  /** Emitted when connection is considered unhealthy */
  unhealthy: [reason: string];
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
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;

  // Connection state tracking
  private connectionState: ConnectionState = "disconnected";
  private connectedAt: Date | null = null;
  private disconnectedAt: Date | null = null;
  private lastPingAt: Date | null = null;
  private lastPongAt: Date | null = null;
  private latencyMs: number | null = null;
  private consecutiveFailures = 0;
  private lastPingTimestamp: number = 0;

  constructor(config: Partial<WSConfig> = {}) {
    super();
    this.config = { ...DEFAULT_WS_CONFIG, ...config };
  }

  /**
   * Update connection state and emit state change event
   */
  private setState(newState: ConnectionState): void {
    if (this.connectionState === newState) return;

    const previousState = this.connectionState;
    this.connectionState = newState;

    logger.debug("Connection state changed", {
      from: previousState,
      to: newState,
    });

    this.emit("stateChange", newState, previousState);
  }

  /**
   * Get current connection status
   */
  getConnectionStatus(): ConnectionStatus {
    return {
      state: this.connectionState,
      connectedAt: this.connectedAt,
      disconnectedAt: this.disconnectedAt,
      reconnectAttempts: this.reconnectAttempts,
      lastPingAt: this.lastPingAt,
      lastPongAt: this.lastPongAt,
      latencyMs: this.latencyMs,
      consecutiveFailures: this.consecutiveFailures,
    };
  }

  /**
   * Get current connection state
   */
  getState(): ConnectionState {
    return this.connectionState;
  }

  async connect(): Promise<void> {
    if (this.ws || this.isConnecting) {
      return;
    }

    this.isConnecting = true;
    this.isClosing = false;
    this.setState("connecting");

    try {
      await this.createConnection();
      this.reconnectAttempts = 0;
      this.consecutiveFailures = 0;
      this.connectedAt = new Date();
      this.disconnectedAt = null;
      this.setState("connected");
      this.emit("connected");
      this.startPingInterval();
      logger.info("WebSocket connected", {
        subscriptions: this.subscriptions.size,
      });
    } catch (error) {
      this.isConnecting = false;
      this.consecutiveFailures++;
      this.setState("failed");
      logger.error("WebSocket connection failed", error instanceof Error ? error : undefined);
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
        this.handlePong();
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
    this.disconnectedAt = new Date();

    const reason = `Code: ${event.code}, Reason: ${event.reason || "Unknown"}`;

    if (this.isClosing) {
      this.setState("disconnected");
      this.emit("disconnected", "Manual close");
      logger.info("WebSocket disconnected (manual)");
      return;
    }

    this.setState("reconnecting");
    this.emit("disconnected", reason);
    logger.warn("WebSocket disconnected", { code: event.code, reason: event.reason });
    this.attemptReconnect();
  }

  private handleError(event: Event): void {
    this.emit("error", new Error(`WebSocket error: ${event.type}`));
  }

  /**
   * Calculate reconnect delay with exponential backoff and jitter
   */
  private calculateReconnectDelay(): number {
    // Exponential backoff: baseDelay * 2^(attempt-1)
    const exponentialDelay = this.config.reconnectDelayMs * Math.pow(2, this.reconnectAttempts - 1);

    // Cap at max delay
    const cappedDelay = Math.min(exponentialDelay, this.config.maxReconnectDelayMs);

    // Add jitter to prevent thundering herd
    const jitter = cappedDelay * this.config.reconnectJitter * Math.random();

    return Math.floor(cappedDelay + jitter);
  }

  private async attemptReconnect(): Promise<void> {
    if (this.isClosing) {
      return;
    }

    if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      this.setState("failed");
      this.emit("unhealthy", `Max reconnect attempts (${this.config.maxReconnectAttempts}) reached`);
      logger.error("Max reconnect attempts reached", undefined, {
        attempts: this.reconnectAttempts,
      });
      return;
    }

    this.reconnectAttempts++;
    this.setState("reconnecting");
    this.emit("reconnecting", this.reconnectAttempts);

    const delay = this.calculateReconnectDelay();
    logger.info("Attempting reconnect", {
      attempt: this.reconnectAttempts,
      maxAttempts: this.config.maxReconnectAttempts,
      delayMs: delay,
    });

    // Clear any existing reconnect timeout
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }

    await new Promise<void>((resolve) => {
      this.reconnectTimeout = setTimeout(resolve, delay);
    });

    if (!this.isClosing) {
      try {
        await this.connect();
        this.emit("reconnected");
        logger.info("WebSocket reconnected", {
          attempts: this.reconnectAttempts,
        });
      } catch (error) {
        this.consecutiveFailures++;
        logger.warn("Reconnect attempt failed", {
          attempt: this.reconnectAttempts,
          error: error instanceof Error ? error.message : String(error),
        });
        // The handleClose will trigger another reconnect attempt
      }
    }
  }

  /**
   * Manually trigger a reconnection
   * Closes current connection (if any) and reconnects
   */
  async reconnect(): Promise<void> {
    logger.info("Manual reconnect requested");

    // Reset reconnect counter for manual reconnects
    this.reconnectAttempts = 0;
    this.consecutiveFailures = 0;

    // Close existing connection without triggering auto-reconnect
    if (this.ws) {
      this.isClosing = true;
      this.cleanup();
      this.ws.close(1000, "Manual reconnect");
      this.ws = null;
      this.isClosing = false;
    }

    // Clear any pending reconnect
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    // Connect with fresh state
    await this.connect();
  }

  private startPingInterval(): void {
    // Clear any existing interval
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
    }

    this.pingInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.sendPing();
      }
    }, this.config.pingIntervalMs);

    logger.debug("Heartbeat started", { intervalMs: this.config.pingIntervalMs });
  }

  /**
   * Send a ping and track timing
   */
  private sendPing(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    this.lastPingTimestamp = Date.now();
    this.lastPingAt = new Date();

    try {
      this.ws.send(JSON.stringify({ ping: this.lastPingTimestamp }));
      this.setPongTimeout();
      logger.debug("Ping sent");
    } catch (error) {
      logger.warn("Failed to send ping", {
        error: error instanceof Error ? error.message : String(error),
      });
      this.emit("unhealthy", "Failed to send ping");
    }
  }

  /**
   * Handle pong response
   */
  private handlePong(): void {
    this.clearPongTimeout();
    this.lastPongAt = new Date();

    // Calculate latency
    if (this.lastPingTimestamp > 0) {
      this.latencyMs = Date.now() - this.lastPingTimestamp;
      this.emit("heartbeat", this.latencyMs);

      // Warn if latency is high
      if (this.latencyMs > 5000) {
        logger.warn("High WebSocket latency detected", { latencyMs: this.latencyMs });
        this.emit("unhealthy", `High latency: ${this.latencyMs}ms`);
      } else {
        logger.debug("Pong received", { latencyMs: this.latencyMs });
      }
    }
  }

  private setPongTimeout(): void {
    this.clearPongTimeout();
    this.pongTimeout = setTimeout(() => {
      logger.warn("Pong timeout - closing connection");
      this.emit("unhealthy", "Pong timeout");
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
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    this.clearPongTimeout();
    this.ws = null;
    this.lastPingTimestamp = 0;
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
    logger.info("Disconnecting WebSocket");
    this.isClosing = true;
    this.cleanup();
    if (this.ws) {
      this.ws.close(1000, "Manual disconnect");
      this.ws = null;
    }
    this.setState("disconnected");
    this.disconnectedAt = new Date();
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  getSubscriptions(): StreamSubscription[] {
    return Array.from(this.subscriptions.values());
  }

  /**
   * Check if the connection is healthy
   * Returns false if disconnected, high latency, or missed pongs
   */
  isHealthy(): boolean {
    if (!this.isConnected()) {
      return false;
    }

    // Check if we've received a pong recently
    if (this.lastPongAt) {
      const timeSinceLastPong = Date.now() - this.lastPongAt.getTime();
      // If more than 2 ping intervals without pong, unhealthy
      if (timeSinceLastPong > this.config.pingIntervalMs * 2) {
        return false;
      }
    }

    // Check latency
    if (this.latencyMs && this.latencyMs > 10000) {
      return false;
    }

    return true;
  }

  /**
   * Get connection uptime in milliseconds
   */
  getUptime(): number | null {
    if (!this.connectedAt || this.connectionState !== "connected") {
      return null;
    }
    return Date.now() - this.connectedAt.getTime();
  }

  /**
   * Get current latency in milliseconds
   */
  getLatency(): number | null {
    return this.latencyMs;
  }

  /**
   * Reset reconnect attempts counter
   * Useful after successful operations
   */
  resetReconnectAttempts(): void {
    this.reconnectAttempts = 0;
    this.consecutiveFailures = 0;
  }
}

export function createBinanceWebSocket(config?: Partial<WSConfig>): BinanceWebSocket {
  return new BinanceWebSocket(config);
}
