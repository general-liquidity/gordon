import type { Exchange } from "../../infra/exchange/index.ts";
import { createModuleLogger } from "../../infra/logger/index.ts";
import { runMonitorCycle, type MonitorResult } from "../pipeline/monitor.ts";
import { scan, type ScanOptions } from "../pipeline/scanner.ts";
import type { ScanResult } from "../../types/index.ts";

const logger = createModuleLogger("market-data-coordinator");

const SHARED_SCAN_TTL_MS = 15_000;
const SHARED_MONITOR_TTL_MS = 30_000;

interface CacheEntry<T> {
  expiresAt: number;
  value: T;
}

interface PricePoller {
  intervalId: ReturnType<typeof setInterval> | null;
  listeners: Set<(price: number) => void>;
  latestPrice?: number;
  latestFetchedAt?: number;
  inFlight?: Promise<number>;
}

const sharedScanCache = new Map<string, CacheEntry<ScanResult>>();
const inFlightScans = new Map<string, Promise<ScanResult>>();
const sharedMonitorCache = new Map<string, CacheEntry<MonitorResult>>();
const inFlightMonitorCycles = new Map<string, Promise<MonitorResult>>();
const pricePollers = new Map<string, PricePoller>();

function getExchangeKey(exchange: Exchange): string {
  return exchange.exchangeId || exchange.constructor?.name || "exchange";
}

function getPrimaryTimeframe(timeframes?: string[]): string {
  return timeframes?.[0] ?? "1h";
}

function getCachedValue<T>(cache: Map<string, CacheEntry<T>>, key: string): T | null {
  const entry = cache.get(key);
  if (!entry) {
    return null;
  }

  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }

  return entry.value;
}

function setCachedValue<T>(
  cache: Map<string, CacheEntry<T>>,
  key: string,
  value: T,
  ttlMs: number
): void {
  cache.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
  });
}

function createScanKey(exchange: Exchange, options?: ScanOptions): string {
  const topN = options?.topN ?? 50;
  const timeframe = getPrimaryTimeframe(options?.timeframes);
  return `${getExchangeKey(exchange)}:scan:${topN}:${timeframe}`;
}

function createMonitorKey(exchange: Exchange): string {
  return `${getExchangeKey(exchange)}:monitor`;
}

function createPriceKey(exchange: Exchange, symbol: string, pollIntervalMs: number): string {
  return `${getExchangeKey(exchange)}:price:${symbol.toUpperCase()}:${pollIntervalMs}`;
}

export async function runSharedScan(
  exchange: Exchange,
  options?: ScanOptions
): Promise<ScanResult> {
  const key = createScanKey(exchange, options);
  const cached = getCachedValue(sharedScanCache, key);
  if (cached) {
    logger.debug("Returning shared cached scan", { key });
    return cached;
  }

  const inFlight = inFlightScans.get(key);
  if (inFlight) {
    logger.debug("Joining in-flight shared scan", { key });
    return inFlight;
  }

  const promise = scan(exchange, options)
    .then((result) => {
      setCachedValue(sharedScanCache, key, result, SHARED_SCAN_TTL_MS);
      return result;
    })
    .finally(() => {
      inFlightScans.delete(key);
    });

  inFlightScans.set(key, promise);
  return promise;
}

export async function runSharedMonitorCycle(exchange: Exchange): Promise<MonitorResult> {
  const key = createMonitorKey(exchange);
  const cached = getCachedValue(sharedMonitorCache, key);
  if (cached) {
    logger.debug("Returning shared cached monitor result", { key });
    return cached;
  }

  const inFlight = inFlightMonitorCycles.get(key);
  if (inFlight) {
    logger.debug("Joining in-flight monitor cycle", { key });
    return inFlight;
  }

  const promise = runMonitorCycle(exchange)
    .then((result) => {
      setCachedValue(sharedMonitorCache, key, result, SHARED_MONITOR_TTL_MS);
      return result;
    })
    .finally(() => {
      inFlightMonitorCycles.delete(key);
    });

  inFlightMonitorCycles.set(key, promise);
  return promise;
}

async function fetchAndBroadcastPrice(
  exchange: Exchange,
  symbol: string,
  pollerKey: string
): Promise<number> {
  const poller = pricePollers.get(pollerKey);
  if (!poller) {
    throw new Error(`No price poller registered for ${pollerKey}`);
  }

  if (poller.inFlight) {
    return poller.inFlight;
  }

  const promise = exchange
    .getPrice(symbol)
    .then((price) => {
      const activePoller = pricePollers.get(pollerKey);
      if (!activePoller) {
        return price;
      }

      activePoller.latestPrice = price;
      activePoller.latestFetchedAt = Date.now();
      for (const listener of activePoller.listeners) {
        listener(price);
      }
      return price;
    })
    .finally(() => {
      const activePoller = pricePollers.get(pollerKey);
      if (activePoller) {
        activePoller.inFlight = undefined;
      }
    });

  poller.inFlight = promise;
  return promise;
}

export function subscribeToMarketPrice(
  exchange: Exchange,
  symbol: string,
  listener: (price: number) => void,
  options: { pollIntervalMs?: number; emitCachedImmediately?: boolean } = {}
): () => void {
  const pollIntervalMs = options.pollIntervalMs ?? 30_000;
  const pollerKey = createPriceKey(exchange, symbol, pollIntervalMs);
  let poller = pricePollers.get(pollerKey);

  if (!poller) {
    poller = {
      intervalId: null,
      listeners: new Set(),
    };

    const tick = () => {
      fetchAndBroadcastPrice(exchange, symbol, pollerKey).catch((error) => {
        logger.warn("Failed shared market price fetch", {
          symbol,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    };

    poller.intervalId = setInterval(tick, pollIntervalMs);
    pricePollers.set(pollerKey, poller);
    void tick();
  } else if (options.emitCachedImmediately !== false && poller.latestPrice !== undefined) {
    listener(poller.latestPrice);
  }

  poller.listeners.add(listener);

  return () => {
    const activePoller = pricePollers.get(pollerKey);
    if (!activePoller) {
      return;
    }

    activePoller.listeners.delete(listener);
    if (activePoller.listeners.size === 0) {
      if (activePoller.intervalId) {
        clearInterval(activePoller.intervalId);
      }
      pricePollers.delete(pollerKey);
    }
  };
}
