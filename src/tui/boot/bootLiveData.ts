import { exchangeStatus } from "../../app/commands/exchange.ts";
import { verifyStoredAuditChain } from "../../core/audit/store.ts";
import type { AuditChainVerification } from "../../core/audit/signing.ts";
import { BrokerFactory } from "../../infra/broker/factory.ts";
import {
  resolveBrokerCredentials,
  type BrokerAdapter,
  type BrokerQuote,
} from "../../infra/broker/types.ts";
import { getStockQuote } from "../../infra/data/providers/finnhub.ts";
import { MultiSourceQuoteService } from "../../infra/data/providers/multiSourceQuote.ts";
import { DataSourceManager, registerOnchainDataSources } from "../../infra/data/sources/index.ts";
import { ExchangeFactory } from "../../infra/exchange/factory.ts";
import { createAllPublicExchanges } from "../../infra/exchange/publicFactory.ts";
import { resolveExchangeCredentials, type Exchange } from "../../infra/exchange/types.ts";
import { loadConfig } from "../../infra/storage/config/config.ts";
import { fetchShadowMarketPrice } from "../../infra/trading/ops/shadowPriceFetcher.ts";
import type { GordonConfig, MultiBrokerConfig, MultiExchangeConfig } from "../../types/index.ts";

export type TickerKind = "crypto" | "equity";

export interface TickerSymbol {
  symbol: string;
  kind: TickerKind;
  /** Onchain DEX/data-source lookup, when configured as onchain:<chain>:<token>:<symbol>. */
  chain?: string;
  tokenAddress?: string;
  poolAddress?: string;
}

export interface TickerQuote {
  symbol: string;
  kind: TickerKind;
  /** null = no price available from any source (render "—", keep last good). */
  priceUsd: number | null;
  changePercent24h: number | null;
  /** Set when the symbol has no usable price source (e.g. equities without a key). */
  note?: string;
}

export interface TickerSymbolPlan {
  /** Every configured/derived symbol, classified. */
  symbols: TickerSymbol[];
  /** First MAX_TICKER_SYMBOLS — the only ones fetched and rendered. */
  display: TickerSymbol[];
  /** Count truncated off the display ("+n"). */
  extraCount: number;
  source: "config" | "default";
}

/** Width budget: the boot panel box is ~64 cols. */
export const MAX_TICKER_SYMBOLS = 4;

export interface BootLiveData {
  venue: {
    label: string | null;
    paper: boolean;
    connectivity: "connecting" | "connected" | "offline" | "none";
  };
  equityUsd: number | null;
  audit: { state: "checking" | "ok" | "broken" | "unavailable"; checked: number };
  ticker: TickerQuote[] | null;
  /** Displayed ticker symbols — the live-refresh poller re-fetches these. */
  tickerSymbols: TickerSymbol[];
  tickerExtra: number;
}

export interface BootLiveDeps {
  loadConfig: typeof loadConfig;
  testVenue: () => Promise<{ connected: boolean }>;
  fetchEquity: () => Promise<number>;
  verifyAudit: () => AuditChainVerification;
  fetchTicker: (
    symbols: TickerSymbol[],
    config?: GordonConfig | null,
  ) => Promise<TickerQuote[] | null>;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 5_000;
export const BOOT_TICKER_REFRESH_MS = 15_000;
const BOOT_TICKER_QUOTE_CACHE_TTL_MS = 10_000;
const BOOT_QUOTE_EXCHANGE_LIMIT = 2;
const HOUR_MS = 60 * 60_000;
const DAY_MS = 24 * HOUR_MS;
const CRYPTO_NO_SOURCE_NOTE =
  "crypto quotes unavailable from exchange, CoinGecko, DefiLlama, and DexScreener";
const EQUITY_NO_SOURCE_NOTE = "stock quotes need a connected broker or FINNHUB_API_KEY";

function activeExchange(config: GordonConfig): MultiExchangeConfig | null {
  const exchanges = config.exchanges ?? [];
  return (
    exchanges.find((exchange) => exchange.id === config.activeExchangeId) ??
    exchanges.find((exchange) => exchange.isDefault) ??
    exchanges[0] ??
    null
  );
}

function activeBroker(config: GordonConfig): MultiBrokerConfig | null {
  const brokers = config.brokers ?? [];
  return (
    brokers.find((broker) => broker.id === config.activeBrokerId) ??
    brokers.find((broker) => broker.isDefault) ??
    brokers[0] ??
    null
  );
}

function venueLabel(config: GordonConfig, active: MultiExchangeConfig | null): string | null {
  if (!active) return null;
  const suffixCount = Math.max(0, (config.exchanges ?? []).length - 1);
  const type = active.type.replace(/^ccxt:/, "");
  return suffixCount > 0 ? `${type} +${suffixCount}` : type;
}

const CRYPTO_SYMBOLS = new Set([
  "BTC",
  "ETH",
  "SOL",
  "BNB",
  "XRP",
  "ADA",
  "DOGE",
  "AVAX",
  "LINK",
  "DOT",
  "MATIC",
  "POL",
  "LTC",
  "UNI",
  "ATOM",
  "ARB",
  "OP",
  "PEPE",
  "WIF",
  "BONK",
  "USDT",
  "USDC",
]);
const CRYPTO_QUOTES = ["USDT", "USDC", "USD", "BUSD", "EUR", "GBP", "BTC", "ETH"];

function normalizeTickerSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

function inferTickerKind(symbol: string): TickerKind {
  const normalized = normalizeTickerSymbol(symbol);
  if (CRYPTO_SYMBOLS.has(normalized) || normalized.includes("/")) return "crypto";
  for (const quote of CRYPTO_QUOTES) {
    if (normalized.endsWith(quote) && normalized.length > quote.length) {
      const base = normalized.slice(0, -quote.length);
      if (CRYPTO_SYMBOLS.has(base)) return "crypto";
    }
  }
  return "equity";
}

function parseOnchainTickerSymbol(value: string): TickerSymbol | null {
  const parts = value
    .split(":")
    .map((part) => part.trim())
    .filter(Boolean);
  const chain = parts[0]?.toLowerCase();
  if (!chain) return null;

  if (parts[1]?.toLowerCase() === "pool") {
    const poolAddress = parts[2];
    if (!poolAddress) return null;
    return {
      symbol: normalizeTickerSymbol(parts[3] ?? poolAddress),
      kind: "crypto",
      chain,
      poolAddress,
    };
  }

  const tokenAddress = parts[1];
  if (!tokenAddress) return null;
  return {
    symbol: normalizeTickerSymbol(parts[2] ?? tokenAddress),
    kind: "crypto",
    chain,
    tokenAddress,
  };
}

export function parseTickerSymbol(symbol: string): TickerSymbol | null {
  const trimmed = symbol.trim();
  if (!trimmed) return null;
  const prefixed = /^([a-z]+):(.*)$/i.exec(trimmed);
  if (prefixed) {
    const prefix = prefixed[1]!.toLowerCase();
    const value = prefixed[2]!.trim();
    if (!value) return null;
    if (prefix === "crypto") return { symbol: normalizeTickerSymbol(value), kind: "crypto" };
    if (prefix === "equity" || prefix === "stock")
      return { symbol: normalizeTickerSymbol(value), kind: "equity" };
    if (prefix === "onchain") return parseOnchainTickerSymbol(value);
  }

  const normalized = symbol.trim().toUpperCase();
  return { symbol: normalized, kind: inferTickerKind(normalized) };
}

export function buildTickerSymbolPlan(config: GordonConfig | null): TickerSymbolPlan {
  const configured = config?.ui?.tickerSymbols
    ?.map(parseTickerSymbol)
    .filter((entry): entry is TickerSymbol => entry !== null && entry.symbol.length > 0);

  const active = config ? activeExchange(config) : null;
  const broker = config ? activeBroker(config) : null;
  const defaults =
    configured && configured.length > 0
      ? configured
      : active && broker
        ? ["BTC", "ETH", "SPY"].map((symbol) => parseTickerSymbol(symbol)!)
        : active
          ? ["BTC", "ETH"].map((symbol) => parseTickerSymbol(symbol)!)
          : broker
            ? ["SPY", "QQQ"].map((symbol) => parseTickerSymbol(symbol)!)
            : ["BTC", "ETH"].map((symbol) => parseTickerSymbol(symbol)!);

  const display = defaults.slice(0, MAX_TICKER_SYMBOLS);
  return {
    symbols: defaults,
    display,
    extraCount: Math.max(0, defaults.length - display.length),
    source: configured && configured.length > 0 ? "config" : "default",
  };
}

function withTimeout<T>(run: () => Promise<T> | T, fallback: T, timeoutMs: number): Promise<T> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish(fallback), timeoutMs);
    Promise.resolve()
      .then(run)
      .then(finish, () => finish(fallback));
  });
}

async function deferredAuditVerify(
  deps: BootLiveDeps,
  timeoutMs: number,
): Promise<BootLiveData["audit"]> {
  const verification = await withTimeout(
    async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      return deps.verifyAudit();
    },
    null,
    timeoutMs,
  );
  if (!verification) return { state: "unavailable", checked: 0 };
  if (verification.valid) return { state: "ok", checked: verification.checked };
  return { state: "broken", checked: verification.checked };
}

function isExchangeStatusPayload(value: unknown): value is {
  statuses: Array<{ isActive: boolean; connected: boolean }>;
} {
  if (typeof value !== "object" || value === null) return false;
  const statuses = (value as { statuses?: unknown }).statuses;
  return Array.isArray(statuses);
}

let bootPublicExchanges: Exchange[] | null = null;
let bootOnchainDataSourceManager: DataSourceManager | null = null;

function createActiveExchangeAdapter(config: GordonConfig | null): Exchange | null {
  const active = config ? activeExchange(config) : null;
  if (!active) return null;
  try {
    return ExchangeFactory.create(active.type, resolveExchangeCredentials(active));
  } catch {
    return null;
  }
}

function getBootPublicExchanges(): Exchange[] {
  if (!bootPublicExchanges) {
    bootPublicExchanges = createAllPublicExchanges();
  }
  return bootPublicExchanges;
}

function createBootQuoteService(config: GordonConfig | null): MultiSourceQuoteService {
  const exchanges: Exchange[] = [];
  const seen = new Set<string>();
  const addExchange = (exchange: Exchange | null) => {
    if (!exchange || seen.has(exchange.exchangeId)) return;
    if (exchanges.length >= BOOT_QUOTE_EXCHANGE_LIMIT) return;
    exchanges.push(exchange);
    seen.add(exchange.exchangeId);
  };

  addExchange(createActiveExchangeAdapter(config));
  for (const exchange of getBootPublicExchanges()) {
    addExchange(exchange);
    if (exchanges.length >= BOOT_QUOTE_EXCHANGE_LIMIT) break;
  }

  return new MultiSourceQuoteService(exchanges, null, {
    enableLLMEnrichment: false,
    quoteCacheTtlMs: BOOT_TICKER_QUOTE_CACHE_TTL_MS,
  });
}

function createActiveBrokerAdapter(config: GordonConfig | null): BrokerAdapter | null {
  const brokerConfig = config ? activeBroker(config) : null;
  if (!brokerConfig) return null;
  try {
    return BrokerFactory.create(brokerConfig.type, resolveBrokerCredentials(brokerConfig));
  } catch {
    return null;
  }
}

function getBootOnchainDataSourceManager(): DataSourceManager {
  if (!bootOnchainDataSourceManager) {
    bootOnchainDataSourceManager = new DataSourceManager();
    registerOnchainDataSources(bootOnchainDataSourceManager);
  }
  return bootOnchainDataSourceManager;
}

function finitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function brokerQuotePrice(quote: BrokerQuote): number | null {
  const bid = finitePositive(quote.bidPrice) ? quote.bidPrice : null;
  const ask = finitePositive(quote.askPrice) ? quote.askPrice : null;
  if (bid !== null && ask !== null) return (bid + ask) / 2;
  return ask ?? bid;
}

async function fetchOnchainTickerQuote(entry: TickerSymbol): Promise<TickerQuote | null> {
  if (!entry.chain || (!entry.tokenAddress && !entry.poolAddress)) return null;

  const manager = getBootOnchainDataSourceManager();
  const now = Date.now();
  const windows = [
    { timeframe: "1d", startTime: now - 2 * DAY_MS },
    { timeframe: "1h", startTime: now - 2 * HOUR_MS },
  ];

  for (const window of windows) {
    try {
      const result = await manager.fetchOHLCWithMetadata({
        symbol: entry.symbol,
        timeframe: window.timeframe,
        startTime: window.startTime,
        endTime: now,
        chain: entry.chain,
        tokenAddress: entry.tokenAddress,
        poolAddress: entry.poolAddress,
      });
      const latest = result.candles[result.candles.length - 1];
      if (!latest || !finitePositive(latest.close)) continue;
      const changePercent24h =
        window.timeframe === "1d" && finitePositive(latest.open)
          ? ((latest.close - latest.open) / latest.open) * 100
          : null;
      return {
        symbol: entry.symbol,
        kind: entry.kind,
        priceUsd: latest.close,
        changePercent24h,
        note: `source: ${result.sourceId}`,
      };
    } catch {
      // Try the next onchain source/timeframe route.
    }
  }

  return null;
}

async function fetchCryptoTickerQuote(
  entry: TickerSymbol,
  quoteService: MultiSourceQuoteService,
): Promise<TickerQuote> {
  const onchainQuote = await fetchOnchainTickerQuote(entry);
  if (onchainQuote && onchainQuote.priceUsd !== null) return onchainQuote;

  try {
    const quote = await quoteService.getQuote(entry.symbol);
    return {
      symbol: entry.symbol,
      kind: entry.kind,
      priceUsd: quote.price,
      changePercent24h: quote.changePercent24h,
      note: quote.degraded ? quote.degradedReasons.join("; ") : undefined,
    };
  } catch {
    // Fall through to shadow market-data sources.
  }

  let shadowPrice: number | null = null;
  try {
    shadowPrice = await fetchShadowMarketPrice(entry.symbol);
  } catch {
    shadowPrice = null;
  }
  return {
    symbol: entry.symbol,
    kind: entry.kind,
    priceUsd: shadowPrice,
    changePercent24h: null,
    note:
      shadowPrice === null ? CRYPTO_NO_SOURCE_NOTE : "source: ccxt/defillama/dexscreener fallback",
  };
}

async function fetchEquityTickerQuote(
  entry: TickerSymbol,
  broker: BrokerAdapter | null,
): Promise<TickerQuote> {
  if (broker) {
    try {
      const quote = await broker.getLatestQuote(entry.symbol);
      const price = brokerQuotePrice(quote);
      if (price !== null) {
        return {
          symbol: entry.symbol,
          kind: entry.kind,
          priceUsd: price,
          changePercent24h: null,
          note: `source: ${broker.displayName}`,
        };
      }
    } catch {
      // Try configured market-data providers.
    }
  }

  try {
    const quote = await getStockQuote(entry.symbol);
    if (quote && finitePositive(quote.c)) {
      return {
        symbol: entry.symbol,
        kind: entry.kind,
        priceUsd: quote.c,
        changePercent24h: Number.isFinite(quote.dp) ? quote.dp : null,
        note: "source: Finnhub",
      };
    }
  } catch {
    // Render an unavailable row below.
  }

  return {
    symbol: entry.symbol,
    kind: entry.kind,
    priceUsd: null,
    changePercent24h: null,
    note: EQUITY_NO_SOURCE_NOTE,
  };
}

export async function fetchBootTickerQuotes(
  symbols: TickerSymbol[],
  config: GordonConfig | null,
): Promise<TickerQuote[] | null> {
  if (symbols.length === 0) return null;
  const quoteService = createBootQuoteService(config);
  const broker = createActiveBrokerAdapter(config);
  const ticker = await Promise.all(
    symbols.map((entry) =>
      entry.kind === "crypto"
        ? fetchCryptoTickerQuote(entry, quoteService)
        : fetchEquityTickerQuote(entry, broker),
    ),
  );
  return ticker.length > 0 ? ticker : null;
}

export function defaultBootLiveDeps(): BootLiveDeps {
  return {
    loadConfig,
    testVenue: async () => {
      const result = await exchangeStatus();
      if (!result.success || !isExchangeStatusPayload(result.data)) return { connected: false };
      const active =
        result.data.statuses.find((status) => status.isActive) ?? result.data.statuses[0];
      return { connected: Boolean(active?.connected) };
    },
    fetchEquity: async () => {
      const config = await loadConfig();
      const active = activeExchange(config);
      if (!active) throw new Error("No active exchange configured");
      const exchange = ExchangeFactory.create(active.type, resolveExchangeCredentials(active));
      return (await exchange.getFullAccountDetails()).totalUsdtValue;
    },
    verifyAudit: verifyStoredAuditChain,
    fetchTicker: async (symbols, config) =>
      fetchBootTickerQuotes(symbols, config ?? (await loadConfig())),
  };
}

/** Resolves every field independently; a failed/timed-out probe degrades that field only. Never rejects. */
export async function loadBootLiveData(
  deps: BootLiveDeps = defaultBootLiveDeps(),
): Promise<BootLiveData> {
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const config = await withTimeout<GordonConfig | null>(() => deps.loadConfig(), null, timeoutMs);
  const active = config ? activeExchange(config) : null;
  const paper = Boolean(active?.sandbox) || config?.permissionMode === "paper";
  const label = config ? venueLabel(config, active) : null;
  const tickerPlan = buildTickerSymbolPlan(config);

  const [connectivity, equityUsd, audit, ticker] = await Promise.all([
    active
      ? withTimeout(
          async () =>
            (await deps.testVenue()).connected ? ("connected" as const) : ("offline" as const),
          "offline" as const,
          timeoutMs,
        )
      : Promise.resolve("none" as const),
    active
      ? withTimeout<number | null>(() => deps.fetchEquity(), null, timeoutMs)
      : Promise.resolve(null),
    deferredAuditVerify(deps, timeoutMs),
    withTimeout<BootLiveData["ticker"]>(
      () => deps.fetchTicker(tickerPlan.display, config),
      null,
      timeoutMs,
    ),
  ]);

  return {
    venue: { label, paper, connectivity },
    equityUsd,
    audit,
    ticker,
    tickerSymbols: tickerPlan.display,
    tickerExtra: tickerPlan.extraCount,
  };
}

export async function refreshBootTicker(
  symbols: TickerSymbol[],
  deps: BootLiveDeps = defaultBootLiveDeps(),
): Promise<BootLiveData["ticker"]> {
  if (symbols.length === 0) return null;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return withTimeout<BootLiveData["ticker"]>(() => deps.fetchTicker(symbols), null, timeoutMs);
}
