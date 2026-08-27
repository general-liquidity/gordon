import type { GordonContext } from "../../agents/types.ts";
import type { BrokerAdapter } from "../../broker/types.ts";
import type { Exchange, SymbolInfo } from "../../exchange/types.ts";
import type { IntegrationMarketFamily } from "../integrations/taxonomy.ts";

const PREFERRED_CRYPTO_QUOTES = ["USDT", "USDC", "USD", "BTC", "ETH"];
const FALLBACK_CRYPTO_QUOTES = ["USDT", "USDC", "USD", "BTC", "ETH"];

interface ExchangeInstrumentCatalog {
  bySymbol: Map<string, SymbolInfo>;
  byBaseAsset: Map<string, SymbolInfo[]>;
}

const exchangeCatalogCache = new WeakMap<Exchange, Promise<ExchangeInstrumentCatalog>>();
const brokerProbeCache = new WeakMap<BrokerAdapter, Map<string, Promise<boolean>>>();

export interface RouteCapabilitySummary {
  supportsQuotes: boolean;
  supportsBidAsk: boolean;
  supportsOrderBook: boolean;
  supportsSessionCalendar: boolean;
  supportsExtendedHours: boolean;
  supportsHistoricalBars: boolean;
}

export interface ResolvedInstrument {
  rawSymbol: string;
  normalizedSymbol: string;
  marketFamily: IntegrationMarketFamily;
  route: "exchange" | "broker";
  resolutionSource: "exchange_catalog" | "broker_quote" | "heuristic";
  venueId?: string;
  baseAsset?: string;
  quoteAsset?: string;
  capabilities: RouteCapabilitySummary;
}

export interface ResolvedMarketVenue {
  marketFamily: IntegrationMarketFamily;
  route: "exchange" | "broker";
  exchange?: Exchange;
  broker?: BrokerAdapter;
}

function sanitizeStockSymbol(symbol: string): string {
  return symbol.trim().toUpperCase().replace(/\s+/g, "").replace(/\//g, "");
}

function sanitizeCryptoSymbol(symbol: string): string {
  return symbol
    .trim()
    .toUpperCase()
    .replace(/[\s/_-]+/g, "")
    .replace("PERPETUAL", "PERP");
}

function isExplicitCryptoSyntax(symbol: string): boolean {
  const upper = symbol.trim().toUpperCase();
  return (
    /[/:_-]/.test(upper) ||
    upper.endsWith("PERP") ||
    FALLBACK_CRYPTO_QUOTES.some(
      (quote) => upper.length > quote.length && sanitizeCryptoSymbol(upper).endsWith(quote),
    )
  );
}

function looksLikeStockSymbol(symbol: string): boolean {
  const normalized = sanitizeStockSymbol(symbol);
  return /^[A-Z][A-Z0-9.-]{0,9}$/.test(normalized);
}

function normalizeCryptoFallback(symbol: string): string {
  const normalized = sanitizeCryptoSymbol(symbol);
  if (
    FALLBACK_CRYPTO_QUOTES.some(
      (quote) => normalized.length > quote.length && normalized.endsWith(quote),
    )
  ) {
    return normalized;
  }
  return `${normalized}USDT`;
}

function getRouteCapabilities(
  ctx: Pick<GordonContext, "exchange" | "broker">,
  route: "exchange" | "broker",
): RouteCapabilitySummary {
  if (route === "broker") {
    return {
      supportsQuotes: Boolean(ctx.broker),
      supportsBidAsk: Boolean(ctx.broker),
      supportsOrderBook: false,
      supportsSessionCalendar: Boolean(ctx.broker),
      supportsExtendedHours: Boolean(ctx.broker?.capabilities?.supportsExtendedHours),
      supportsHistoricalBars: Boolean(ctx.broker?.capabilities?.supportsHistoricalBars),
    };
  }

  return {
    supportsQuotes: Boolean(ctx.exchange),
    supportsBidAsk: Boolean(ctx.exchange),
    supportsOrderBook: Boolean(ctx.exchange),
    supportsSessionCalendar: false,
    supportsExtendedHours: false,
    supportsHistoricalBars: Boolean(ctx.exchange),
  };
}

function choosePreferredExchangeSymbol(candidates: SymbolInfo[]): SymbolInfo | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0] ?? null;

  const scored = [...candidates].sort((left, right) => {
    const leftScore = PREFERRED_CRYPTO_QUOTES.indexOf(left.quoteAsset.toUpperCase());
    const rightScore = PREFERRED_CRYPTO_QUOTES.indexOf(right.quoteAsset.toUpperCase());
    const normalizedLeft = leftScore === -1 ? Number.MAX_SAFE_INTEGER : leftScore;
    const normalizedRight = rightScore === -1 ? Number.MAX_SAFE_INTEGER : rightScore;
    if (normalizedLeft !== normalizedRight) return normalizedLeft - normalizedRight;
    return left.symbol.localeCompare(right.symbol);
  });

  return scored[0] ?? null;
}

async function getExchangeCatalog(exchange: Exchange): Promise<ExchangeInstrumentCatalog> {
  let cached = exchangeCatalogCache.get(exchange);
  if (!cached) {
    cached = (async () => {
      const info = await exchange.getExchangeInfo();
      const bySymbol = new Map<string, SymbolInfo>();
      const byBaseAsset = new Map<string, SymbolInfo[]>();

      for (const symbolInfo of info.symbols) {
        const symbol = sanitizeCryptoSymbol(symbolInfo.symbol);
        bySymbol.set(symbol, symbolInfo);

        const base = symbolInfo.baseAsset.toUpperCase();
        const existing = byBaseAsset.get(base) ?? [];
        existing.push(symbolInfo);
        byBaseAsset.set(base, existing);
      }

      return { bySymbol, byBaseAsset };
    })();
    exchangeCatalogCache.set(exchange, cached);
  }

  return await cached;
}

async function resolveExchangeInstrument(
  ctx: Pick<GordonContext, "exchange" | "broker">,
  exchange: Exchange,
  symbol: string,
): Promise<ResolvedInstrument | null> {
  try {
    const catalog = await getExchangeCatalog(exchange);
    const normalizedInput = sanitizeCryptoSymbol(symbol);
    const exact = catalog.bySymbol.get(normalizedInput);
    const matched =
      exact ??
      choosePreferredExchangeSymbol(catalog.byBaseAsset.get(sanitizeStockSymbol(symbol)) ?? []);

    if (!matched) return null;

    return {
      rawSymbol: symbol,
      normalizedSymbol: sanitizeCryptoSymbol(matched.symbol),
      marketFamily: "crypto",
      route: "exchange",
      resolutionSource: "exchange_catalog",
      venueId: exchange.exchangeId,
      baseAsset: matched.baseAsset.toUpperCase(),
      quoteAsset: matched.quoteAsset.toUpperCase(),
      capabilities: getRouteCapabilities(ctx, "exchange"),
    };
  } catch {
    return null;
  }
}

async function brokerSymbolExists(broker: BrokerAdapter, symbol: string): Promise<boolean> {
  const normalized = sanitizeStockSymbol(symbol);
  let cache = brokerProbeCache.get(broker);
  if (!cache) {
    cache = new Map<string, Promise<boolean>>();
    brokerProbeCache.set(broker, cache);
  }

  let probe = cache.get(normalized);
  if (!probe) {
    probe = broker
      .getLatestQuote(normalized)
      .then(() => true)
      .catch(() => false);
    cache.set(normalized, probe);
  }

  return await probe;
}

async function resolveBrokerInstrument(
  ctx: Pick<GordonContext, "exchange" | "broker">,
  broker: BrokerAdapter,
  symbol: string,
): Promise<ResolvedInstrument | null> {
  const normalizedSymbol = sanitizeStockSymbol(symbol);
  const exists = await brokerSymbolExists(broker, normalizedSymbol);
  if (!exists) return null;

  return {
    rawSymbol: symbol,
    normalizedSymbol,
    marketFamily: "stocks",
    route: "broker",
    resolutionSource: "broker_quote",
    venueId: broker.brokerId,
    baseAsset: normalizedSymbol,
    quoteAsset: "USD",
    capabilities: getRouteCapabilities(ctx, "broker"),
  };
}

export function normalizeStockSymbol(symbol: string): string {
  return sanitizeStockSymbol(symbol);
}

export function normalizeCryptoSymbol(symbol: string): string {
  return normalizeCryptoFallback(symbol);
}

export function inferMarketFamily(
  ctx: Pick<GordonContext, "exchange" | "broker">,
  symbol: string,
  preferredMarket?: IntegrationMarketFamily,
): IntegrationMarketFamily {
  if (preferredMarket) return preferredMarket;
  if (isExplicitCryptoSyntax(symbol)) return "crypto";
  if (ctx.exchange && !ctx.broker) return "crypto";
  if (ctx.broker && !ctx.exchange) return "stocks";
  if (looksLikeStockSymbol(symbol)) return "stocks";
  return ctx.exchange ? "crypto" : "stocks";
}

export async function resolveInstrument(
  ctx: Pick<GordonContext, "exchange" | "broker">,
  symbol: string,
  preferredMarket?: IntegrationMarketFamily,
): Promise<ResolvedInstrument> {
  const marketFamily = inferMarketFamily(ctx, symbol, preferredMarket);

  if (preferredMarket === "crypto" && ctx.exchange) {
    const resolved = await resolveExchangeInstrument(ctx, ctx.exchange, symbol);
    if (resolved) return resolved;
  }

  if (preferredMarket === "stocks" && ctx.broker) {
    const resolved = await resolveBrokerInstrument(ctx, ctx.broker, symbol);
    if (resolved) return resolved;
  }

  if (ctx.exchange && isExplicitCryptoSyntax(symbol)) {
    const resolved = await resolveExchangeInstrument(ctx, ctx.exchange, symbol);
    if (resolved) return resolved;
  }

  if (ctx.broker && looksLikeStockSymbol(symbol)) {
    const resolved = await resolveBrokerInstrument(ctx, ctx.broker, symbol);
    if (resolved) return resolved;
  }

  if (ctx.exchange) {
    const resolved = await resolveExchangeInstrument(ctx, ctx.exchange, symbol);
    if (resolved) return resolved;
  }

  if (ctx.broker) {
    const resolved = await resolveBrokerInstrument(ctx, ctx.broker, symbol);
    if (resolved) return resolved;
  }

  return {
    rawSymbol: symbol,
    normalizedSymbol:
      marketFamily === "crypto" ? normalizeCryptoFallback(symbol) : sanitizeStockSymbol(symbol),
    marketFamily,
    route: marketFamily === "crypto" ? "exchange" : "broker",
    resolutionSource: "heuristic",
    capabilities: getRouteCapabilities(ctx, marketFamily === "crypto" ? "exchange" : "broker"),
  };
}

export function resolveMarketVenue(
  ctx: Pick<GordonContext, "exchange" | "broker">,
  symbol?: string,
  preferredMarket?: IntegrationMarketFamily,
): ResolvedMarketVenue | null {
  const marketFamily =
    preferredMarket ??
    (symbol
      ? inferMarketFamily(ctx, symbol)
      : ctx.exchange
        ? "crypto"
        : ctx.broker
          ? "stocks"
          : undefined);

  if (!marketFamily) return null;
  if (marketFamily === "crypto" && ctx.exchange) {
    return { marketFamily, route: "exchange", exchange: ctx.exchange };
  }
  if (marketFamily === "stocks" && ctx.broker) {
    return { marketFamily, route: "broker", broker: ctx.broker };
  }
  if (ctx.exchange) {
    return { marketFamily: "crypto", route: "exchange", exchange: ctx.exchange };
  }
  if (ctx.broker) {
    return { marketFamily: "stocks", route: "broker", broker: ctx.broker };
  }
  return null;
}

export function isValidTradingSymbol(symbol: string): boolean {
  const trimmed = symbol.trim();
  if (!trimmed || trimmed !== trimmed.toUpperCase()) {
    return false;
  }

  const normalizedStock = sanitizeStockSymbol(symbol);
  const normalizedCrypto = sanitizeCryptoSymbol(symbol);
  return (
    /^[A-Z][A-Z0-9.-]{0,14}$/.test(normalizedStock) || /^[A-Z0-9]{3,24}$/.test(normalizedCrypto)
  );
}
