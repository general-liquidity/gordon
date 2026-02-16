/**
 * Market Data Event Emitter
 * Connects to market data sources (WebSocket, polling) and emits typed events
 * onto the EventBus for agent subscriptions to consume.
 *
 * Responsibilities:
 * - Watch candle closes for specific symbols/timeframes
 * - Emit price ticks for symbols with open positions
 * - Detect volume anomalies and emit volume spike events
 * - Manage watched symbol lifecycle (add/remove)
 */

import { createModuleLogger } from "../infra/logger/index.ts";
import { EventBus, getEventBus } from "./bus.ts";
import type { EventType } from "./types.ts";
import type {
  CandleCloseEvent,
  PriceTickEvent,
  VolumeSpikeEvent,
  MarketEventType,
} from "./market-events.ts";
import type {
  BinanceWebSocket,
  KlineUpdate,
  TickerUpdate,
} from "../infra/binance/websocket.ts";

const logger = createModuleLogger("market-emitter");

// ============================================================================
// Types
// ============================================================================

/**
 * A symbol being watched with its configuration
 */
export interface WatchedSymbol {
  symbol: string;
  /** What types of events are being watched */
  watchTypes: Set<"candles" | "price" | "volume">;
  /** Timeframes being watched for candle closes */
  timeframes: Set<string>;
  /** Volume spike threshold (multiple of average) */
  volumeThreshold: number;
  /** Rolling volume data for spike detection */
  volumeHistory: number[];
  /** Maximum volume history entries to keep */
  maxVolumeHistory: number;
  /** Last known price for change tracking */
  lastPrice: number | null;
  /** Timestamp of the last event emitted */
  lastEventTime: number;
}

/**
 * Configuration for the MarketEventEmitter
 */
export interface MarketEmitterConfig {
  /** Default volume spike threshold (multiple of average volume) */
  defaultVolumeThreshold: number;
  /** Number of volume readings to keep for average calculation */
  volumeHistoryLength: number;
  /** Minimum interval between price tick emissions (ms) to avoid flooding */
  priceTickThrottleMs: number;
  /** Source label for emitted events */
  source: string;
}

const DEFAULT_CONFIG: MarketEmitterConfig = {
  defaultVolumeThreshold: 3.0,
  volumeHistoryLength: 20,
  priceTickThrottleMs: 1000,
  source: "market-emitter",
};

// ============================================================================
// MarketEventEmitter Class
// ============================================================================

/**
 * Connects to market data sources and emits typed events on the EventBus.
 *
 * Usage:
 * ```ts
 * const emitter = new MarketEventEmitter(getEventBus());
 * emitter.attachWebSocket(binanceWs);
 * emitter.watchCandles("BTCUSDT", "1h");
 * emitter.watchPrice("ETHUSDT");
 * emitter.watchVolume("SOLUSDT", 4.0);
 * ```
 */
export class MarketEventEmitter {
  private bus: EventBus;
  private config: MarketEmitterConfig;
  private watched: Map<string, WatchedSymbol> = new Map();
  private ws: BinanceWebSocket | null = null;
  private pollingIntervals: Map<string, ReturnType<typeof setInterval>> = new Map();
  private running: boolean = false;

  constructor(bus?: EventBus, config?: Partial<MarketEmitterConfig>) {
    this.bus = bus ?? getEventBus();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Attach a BinanceWebSocket instance for real-time data.
   * The emitter will subscribe to kline and ticker streams as needed.
   */
  attachWebSocket(ws: BinanceWebSocket): void {
    this.ws = ws;

    // Listen for kline (candle) updates
    ws.on("kline", (update: KlineUpdate) => {
      this.handleKlineUpdate(update);
    });

    // Listen for ticker (price) updates
    ws.on("ticker", (update: TickerUpdate) => {
      this.handleTickerUpdate(update);
    });

    this.running = true;
    logger.info("WebSocket attached to MarketEventEmitter");
  }

  /**
   * Detach WebSocket and stop all watching
   */
  detachWebSocket(): void {
    if (this.ws) {
      // Unsubscribe all watched symbols from WebSocket
      const allWatched = Array.from(this.watched.values());
      for (const watched of allWatched) {
        this.unsubscribeFromWS(watched);
      }
      this.ws = null;
    }
    this.running = false;
    logger.info("WebSocket detached from MarketEventEmitter");
  }

  // ============================================================================
  // Watch Methods
  // ============================================================================

  /**
   * Start emitting candle close events for a symbol on a timeframe.
   *
   * When a candle closes (isClosed=true from Binance kline stream),
   * a market:candle_close event is emitted.
   */
  watchCandles(symbol: string, timeframe: string): void {
    const watched = this.getOrCreateWatched(symbol);
    watched.watchTypes.add("candles");
    watched.timeframes.add(timeframe);

    // Subscribe on WebSocket if available
    if (this.ws) {
      this.ws.subscribeKline(symbol, timeframe);
    }

    logger.info("Watching candles", { symbol, timeframe });
  }

  /**
   * Start emitting price ticks for a symbol.
   *
   * Price ticks are throttled to avoid flooding the event bus.
   * Use this for symbols with open positions.
   */
  watchPrice(symbol: string): void {
    const watched = this.getOrCreateWatched(symbol);
    watched.watchTypes.add("price");

    // Subscribe on WebSocket if available
    if (this.ws) {
      this.ws.subscribeTicker(symbol);
    }

    logger.info("Watching price", { symbol });
  }

  /**
   * Start monitoring volume for anomalies on a symbol.
   *
   * When volume exceeds the threshold multiple of the rolling average,
   * a market:volume_spike event is emitted.
   *
   * @param symbol - Trading pair symbol
   * @param threshold - Multiple of average volume to trigger spike (default from config)
   */
  watchVolume(symbol: string, threshold?: number): void {
    const watched = this.getOrCreateWatched(symbol);
    watched.watchTypes.add("volume");
    watched.volumeThreshold = threshold ?? this.config.defaultVolumeThreshold;

    // Subscribe on WebSocket for kline data (used for volume tracking)
    if (this.ws) {
      this.ws.subscribeKline(symbol, "5m");
    }

    logger.info("Watching volume", { symbol, threshold: watched.volumeThreshold });
  }

  /**
   * Stop watching a symbol entirely.
   * Removes all subscriptions (candles, price, volume) for the symbol.
   */
  unwatch(symbol: string): void {
    const watched = this.watched.get(symbol);
    if (!watched) return;

    // Unsubscribe from WebSocket
    this.unsubscribeFromWS(watched);

    // Stop any polling intervals
    const intervalKey = `poll:${symbol}`;
    if (this.pollingIntervals.has(intervalKey)) {
      clearInterval(this.pollingIntervals.get(intervalKey)!);
      this.pollingIntervals.delete(intervalKey);
    }

    this.watched.delete(symbol);
    logger.info("Stopped watching symbol", { symbol });
  }

  /**
   * Stop watching a specific type for a symbol.
   */
  unwatchType(symbol: string, type: "candles" | "price" | "volume"): void {
    const watched = this.watched.get(symbol);
    if (!watched) return;

    watched.watchTypes.delete(type);

    // If no watch types left, fully unwatch
    if (watched.watchTypes.size === 0) {
      this.unwatch(symbol);
      return;
    }

    logger.debug("Stopped watching type for symbol", { symbol, type });
  }

  /**
   * Get all watched symbols with their configurations
   */
  getWatched(): WatchedSymbol[] {
    return Array.from(this.watched.values());
  }

  /**
   * Get a specific watched symbol
   */
  getWatchedSymbol(symbol: string): WatchedSymbol | undefined {
    return this.watched.get(symbol);
  }

  /**
   * Check if a symbol is being watched
   */
  isWatching(symbol: string): boolean {
    return this.watched.has(symbol);
  }

  /**
   * Check if the emitter is running (WebSocket attached and active)
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Stop all watching and clean up
   */
  stopAll(): void {
    // Unwatch all symbols
    for (const symbol of Array.from(this.watched.keys())) {
      this.unwatch(symbol);
    }

    // Clear all polling intervals
    const intervalEntries = Array.from(this.pollingIntervals.entries());
    for (const [key, interval] of intervalEntries) {
      clearInterval(interval);
      this.pollingIntervals.delete(key);
    }

    this.running = false;
    logger.info("MarketEventEmitter stopped");
  }

  /**
   * Get emitter status summary
   */
  getStatus(): {
    running: boolean;
    wsConnected: boolean;
    watchedCount: number;
    symbols: Array<{
      symbol: string;
      watchTypes: string[];
      timeframes: string[];
    }>;
  } {
    return {
      running: this.running,
      wsConnected: this.ws?.isConnected() ?? false,
      watchedCount: this.watched.size,
      symbols: Array.from(this.watched.values()).map((w) => ({
        symbol: w.symbol,
        watchTypes: Array.from(w.watchTypes),
        timeframes: Array.from(w.timeframes),
      })),
    };
  }

  // ============================================================================
  // Event Emission (Public API for programmatic event injection)
  // ============================================================================

  /**
   * Manually emit a candle close event.
   * Useful for testing or when receiving candle data from non-WebSocket sources.
   */
  async emitCandleClose(data: Omit<CandleCloseEvent, "type" | "timestamp">): Promise<void> {
    const event: CandleCloseEvent = {
      type: "market:candle_close",
      timestamp: new Date().toISOString(),
      source: this.config.source,
      ...data,
    };
    await this.bus.emit(event as unknown as import("./types.ts").EventData<EventType>);
    logger.debug("Candle close event emitted", { symbol: data.symbol, timeframe: data.timeframe });
  }

  /**
   * Manually emit a price tick event.
   */
  async emitPriceTick(data: Omit<PriceTickEvent, "type" | "timestamp">): Promise<void> {
    const event: PriceTickEvent = {
      type: "market:price_tick",
      timestamp: new Date().toISOString(),
      source: this.config.source,
      ...data,
    };
    await this.bus.emit(event as unknown as import("./types.ts").EventData<EventType>);
  }

  /**
   * Manually emit a volume spike event.
   */
  async emitVolumeSpike(data: Omit<VolumeSpikeEvent, "type" | "timestamp">): Promise<void> {
    const event: VolumeSpikeEvent = {
      type: "market:volume_spike",
      timestamp: new Date().toISOString(),
      source: this.config.source,
      ...data,
    };
    await this.bus.emit(event as unknown as import("./types.ts").EventData<EventType>);
    logger.info("Volume spike event emitted", {
      symbol: data.symbol,
      spikeMultiple: data.spikeMultiple,
    });
  }

  /**
   * Emit any MarketEvent onto the bus.
   * Generic method for emitting custom market events.
   */
  async emitMarketEvent(event: {
    type: MarketEventType;
    timestamp?: string;
    [key: string]: unknown;
  }): Promise<void> {
    const fullEvent = {
      ...event,
      timestamp: event.timestamp ?? new Date().toISOString(),
      source: event.source ?? this.config.source,
    };
    await this.bus.emit(fullEvent as unknown as import("./types.ts").EventData<EventType>);
    logger.debug("Market event emitted", { type: event.type });
  }

  // ============================================================================
  // Internal Handlers
  // ============================================================================

  /**
   * Handle kline (candle) updates from WebSocket
   */
  private handleKlineUpdate(update: KlineUpdate): void {
    const watched = this.watched.get(update.symbol);
    if (!watched) return;

    // Check for candle close
    if (update.isClosed && watched.watchTypes.has("candles") && watched.timeframes.has(update.interval)) {
      this.emitCandleClose({
        symbol: update.symbol,
        timeframe: update.interval,
        open: update.open,
        high: update.high,
        low: update.low,
        close: update.close,
        volume: update.volume,
        quoteVolume: 0, // Not available in kline update
      }).catch((err) => {
        logger.error("Failed to emit candle close event", err instanceof Error ? err : new Error(String(err)));
      });
    }

    // Track volume for spike detection
    if (watched.watchTypes.has("volume") && update.isClosed) {
      this.checkVolumeSpike(watched, update);
    }
  }

  /**
   * Handle ticker updates from WebSocket
   */
  private handleTickerUpdate(update: TickerUpdate): void {
    const watched = this.watched.get(update.symbol);
    if (!watched || !watched.watchTypes.has("price")) return;

    // Throttle price tick emissions
    const now = Date.now();
    if (now - watched.lastEventTime < this.config.priceTickThrottleMs) {
      return;
    }
    watched.lastEventTime = now;
    watched.lastPrice = update.price;

    this.emitPriceTick({
      symbol: update.symbol,
      price: update.price,
      bid: update.price, // Ticker update doesn't separate bid/ask
      ask: update.price,
      volume24h: update.volume,
      priceChange24h: update.priceChange,
      priceChangePercent24h: update.priceChangePercent,
    }).catch((err) => {
      logger.error("Failed to emit price tick event", err instanceof Error ? err : new Error(String(err)));
    });
  }

  /**
   * Check if a closed candle's volume constitutes a spike
   */
  private checkVolumeSpike(watched: WatchedSymbol, kline: KlineUpdate): void {
    // Add volume to history
    watched.volumeHistory.push(kline.volume);
    if (watched.volumeHistory.length > watched.maxVolumeHistory) {
      watched.volumeHistory.shift();
    }

    // Need at least 5 readings to compute meaningful average
    if (watched.volumeHistory.length < 5) return;

    // Calculate average volume (excluding the latest reading)
    const history = watched.volumeHistory.slice(0, -1);
    const avgVolume = history.reduce((sum, v) => sum + v, 0) / history.length;

    if (avgVolume <= 0) return;

    const spikeMultiple = kline.volume / avgVolume;

    if (spikeMultiple >= watched.volumeThreshold) {
      this.emitVolumeSpike({
        symbol: watched.symbol,
        currentVolume: kline.volume,
        averageVolume: avgVolume,
        spikeMultiple,
        timeframe: kline.interval,
        price: kline.close,
      }).catch((err) => {
        logger.error("Failed to emit volume spike event", err instanceof Error ? err : new Error(String(err)));
      });
    }
  }

  // ============================================================================
  // Internal Helpers
  // ============================================================================

  /**
   * Get or create a WatchedSymbol entry
   */
  private getOrCreateWatched(symbol: string): WatchedSymbol {
    let watched = this.watched.get(symbol);
    if (!watched) {
      watched = {
        symbol,
        watchTypes: new Set(),
        timeframes: new Set(),
        volumeThreshold: this.config.defaultVolumeThreshold,
        volumeHistory: [],
        maxVolumeHistory: this.config.volumeHistoryLength,
        lastPrice: null,
        lastEventTime: 0,
      };
      this.watched.set(symbol, watched);
    }
    return watched;
  }

  /**
   * Unsubscribe a watched symbol from WebSocket streams
   */
  private unsubscribeFromWS(watched: WatchedSymbol): void {
    if (!this.ws) return;

    if (watched.watchTypes.has("price")) {
      this.ws.unsubscribe("ticker", watched.symbol);
    }

    if (watched.watchTypes.has("candles")) {
      const timeframes = Array.from(watched.timeframes);
      for (const tf of timeframes) {
        this.ws.unsubscribe("kline", watched.symbol, tf);
      }
    }

    if (watched.watchTypes.has("volume")) {
      this.ws.unsubscribe("kline", watched.symbol, "5m");
    }
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let _emitter: MarketEventEmitter | null = null;

/**
 * Get or create the singleton MarketEventEmitter
 */
export function getMarketEmitter(): MarketEventEmitter {
  if (!_emitter) {
    _emitter = new MarketEventEmitter();
  }
  return _emitter;
}

/**
 * Reset the singleton MarketEventEmitter (for testing)
 */
export function resetMarketEmitter(): void {
  if (_emitter) {
    _emitter.stopAll();
    _emitter = null;
  }
}
