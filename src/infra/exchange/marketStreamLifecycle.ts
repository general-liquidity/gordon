/**
 * Wires the shared market stream to the realtime monitor, market emitter,
 * and exchange:* bus events whenever credentials or active exchange change.
 */

import { loadConfig } from "../storage/config/config.ts";
import { ExchangeFactory } from "./factory.ts";
import { createMarketStream, type MarketStream } from "./marketStream.ts";
import { normalizeExchangeId, type ExchangeId } from "./types.ts";
import { createModuleLogger } from "../logger/index.ts";
import { getEventBus } from "../../events/bus.ts";
import { getMarketEmitter } from "../../events/market-emitter.ts";
import {
  setMonitorMarketStream,
  wireMonitorTickerHandlers,
  subscribeMonitorTradeSymbols,
  shutdownRealtimeMonitor,
} from "../../core/pipeline/monitor.ts";

const logger = createModuleLogger("market-stream-lifecycle");

let activeStream: MarketStream | null = null;
let activeExchangeId: string | null = null;
let rateLimitTimer: ReturnType<typeof setInterval> | null = null;
let busWired = false;

function timestamp(): string {
  return new Date().toISOString();
}

async function resolveActiveExchangeType(): Promise<ExchangeId | null> {
  const config = await loadConfig();
  if (config.exchanges.length === 0) return null;
  const activeId = config.activeExchangeId ?? config.exchanges.find((ex) => ex.isDefault)?.id;
  const active = config.exchanges.find((ex) => ex.id === activeId) ?? config.exchanges[0];
  return active?.type ?? null;
}

function wireBusEvents(stream: MarketStream, exchangeId: ExchangeId): void {
  if (busWired) return;
  busWired = true;
  const bus = getEventBus();
  const canonical = normalizeExchangeId(exchangeId);

  stream.on("connected", () => {
    void bus.emit({
      type: "exchange:connected",
      exchangeId: canonical,
      timestamp: timestamp(),
    });
  });

  stream.on("disconnected", (reason) => {
    void bus.emit({
      type: "exchange:disconnected",
      exchangeId: canonical,
      reason,
      timestamp: timestamp(),
    });
  });

  stream.on("error", (error) => {
    logger.debug("Market stream error", {
      exchangeId: canonical,
      error: error.message,
    });
  });
}

function stopRateLimitWatch(): void {
  if (rateLimitTimer) {
    clearInterval(rateLimitTimer);
    rateLimitTimer = null;
  }
}

async function startRateLimitWatch(exchangeId: ExchangeId): Promise<void> {
  stopRateLimitWatch();
  const config = await loadConfig();
  const activeId = config.activeExchangeId ?? config.exchanges.find((ex) => ex.isDefault)?.id;
  const active = config.exchanges.find((ex) => ex.id === activeId) ?? config.exchanges[0];
  if (!active?.apiKey || !active.apiSecret) return;

  let exchange: ReturnType<typeof ExchangeFactory.create>;
  try {
    exchange = ExchangeFactory.create(exchangeId, {
      apiKey: active.apiKey,
      apiSecret: active.apiSecret,
      passphrase: active.passphrase,
      sandbox: active.sandbox,
      walletPrivateKey: active.walletPrivateKey,
    });
  } catch (error) {
    logger.debug("Rate-limit watch skipped — exchange not constructible", {
      exchangeId,
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  const canonical = normalizeExchangeId(exchangeId);
  const bus = getEventBus();

  rateLimitTimer = setInterval(() => {
    void (async () => {
      try {
        const status = await exchange.getRateLimitStatus();
        if (!status.isThrottling && status.currentWeight / Math.max(status.maxWeight, 1) < 0.8) {
          return;
        }
        await bus.emit({
          type: "exchange:rate_limit",
          exchangeId: canonical,
          weight: status.currentWeight,
          limit: status.maxWeight,
          timestamp: timestamp(),
        });
      } catch {
        // Non-critical polling
      }
    })();
  }, 30_000);
}

export async function syncExchangeMarketFeeds(): Promise<void> {
  const exchangeType = await resolveActiveExchangeType();
  if (!exchangeType) {
    shutdownExchangeMarketFeeds();
    return;
  }

  if (activeExchangeId === exchangeType && activeStream?.isConnected()) {
    await subscribeMonitorTradeSymbols();
    return;
  }

  shutdownExchangeMarketFeeds();

  const stream = createMarketStream(exchangeType);
  activeStream = stream;
  activeExchangeId = exchangeType;

  wireBusEvents(stream, exchangeType);
  wireMonitorTickerHandlers(stream);
  setMonitorMarketStream(stream);
  getMarketEmitter().attachMarketStream(stream);

  await subscribeMonitorTradeSymbols();

  try {
    await stream.connect();
    logger.info("Exchange market feeds started", { exchangeId: exchangeType });
  } catch (error) {
    logger.warn("Failed to start market stream", {
      exchangeId: exchangeType,
      error: error instanceof Error ? error.message : String(error),
    });
    shutdownExchangeMarketFeeds();
    return;
  }

  await startRateLimitWatch(exchangeType);
}

export function shutdownExchangeMarketFeeds(): void {
  stopRateLimitWatch();
  getMarketEmitter().detachMarketStream();
  shutdownRealtimeMonitor();
  activeStream = null;
  activeExchangeId = null;
  busWired = false;
}
