import { exchangeStatus } from "../../app/commands/exchange.ts";
import { verifyStoredAuditChain } from "../../core/audit/store.ts";
import type { AuditChainVerification } from "../../core/audit/signing.ts";
import { getCoinGeckoClient } from "../../infra/data/providers/coingecko.ts";
import { ExchangeFactory } from "../../infra/exchange/factory.ts";
import { loadConfig } from "../../infra/storage/config/config.ts";
import type { GordonConfig, MultiBrokerConfig, MultiExchangeConfig } from "../../types/index.ts";

export type TickerKind = "crypto" | "equity";

export interface TickerSymbol {
  symbol: string;
  kind: TickerKind;
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
  fetchTicker: (symbols: TickerSymbol[]) => Promise<TickerQuote[] | null>;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 5_000;
const EQUITY_NO_SOURCE_NOTE = "stock quotes need FINNHUB_API_KEY or a connected broker";

function activeExchange(config: GordonConfig): MultiExchangeConfig | null {
  const exchanges = config.exchanges ?? [];
  return exchanges.find((exchange) => exchange.id === config.activeExchangeId)
    ?? exchanges.find((exchange) => exchange.isDefault)
    ?? exchanges[0]
    ?? null;
}

function activeBroker(config: GordonConfig): MultiBrokerConfig | null {
  const brokers = config.brokers ?? [];
  return brokers.find((broker) => broker.id === config.activeBrokerId)
    ?? brokers.find((broker) => broker.isDefault)
    ?? brokers[0]
    ?? null;
}

function venueLabel(config: GordonConfig, active: MultiExchangeConfig | null): string | null {
  if (!active) return null;
  const suffixCount = Math.max(0, (config.exchanges ?? []).length - 1);
  const type = active.type.replace(/^ccxt:/, "");
  return suffixCount > 0 ? `${type} +${suffixCount}` : type;
}

const CRYPTO_SYMBOLS = new Set(["BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "DOGE", "AVAX", "LINK", "DOT"]);

function classifyTickerSymbol(symbol: string): TickerSymbol {
  const normalized = symbol.trim().toUpperCase();
  return { symbol: normalized, kind: CRYPTO_SYMBOLS.has(normalized) ? "crypto" : "equity" };
}

export function buildTickerSymbolPlan(config: GordonConfig | null): TickerSymbolPlan {
  const configured = config?.ui?.tickerSymbols
    ?.map(classifyTickerSymbol)
    .filter((entry) => entry.symbol.length > 0);

  const active = config ? activeExchange(config) : null;
  const broker = config ? activeBroker(config) : null;
  const defaults = configured && configured.length > 0
    ? configured
    : active && broker
      ? ["BTC", "ETH", "SPY"].map(classifyTickerSymbol)
      : active
        ? ["BTC", "ETH"].map(classifyTickerSymbol)
        : broker
          ? ["SPY", "QQQ"].map(classifyTickerSymbol)
          : ["BTC", "ETH"].map(classifyTickerSymbol);

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

async function deferredAuditVerify(deps: BootLiveDeps, timeoutMs: number): Promise<BootLiveData["audit"]> {
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

export function defaultBootLiveDeps(): BootLiveDeps {
  return {
    loadConfig,
    testVenue: async () => {
      const result = await exchangeStatus();
      if (!result.success || !isExchangeStatusPayload(result.data)) return { connected: false };
      const active = result.data.statuses.find((status) => status.isActive) ?? result.data.statuses[0];
      return { connected: Boolean(active?.connected) };
    },
    fetchEquity: async () => {
      const config = await loadConfig();
      const active = activeExchange(config);
      if (!active) throw new Error("No active exchange configured");
      const exchange = ExchangeFactory.create(active.type, {
        apiKey: active.apiKey,
        apiSecret: active.apiSecret,
        passphrase: active.passphrase,
        walletPrivateKey: active.walletPrivateKey,
        sandbox: active.sandbox,
      });
      return (await exchange.getFullAccountDetails()).totalUsdtValue;
    },
    verifyAudit: verifyStoredAuditChain,
    fetchTicker: async (symbols) => {
      const cryptoSymbols = symbols.filter((entry) => entry.kind === "crypto").map((entry) => entry.symbol);
      const prices = cryptoSymbols.length > 0
        ? await getCoinGeckoClient().getPrices(cryptoSymbols)
        : new Map<string, { usd: number; usd_24h_change: number }>();
      const ticker: BootLiveData["ticker"] = [];
      for (const entry of symbols) {
        if (entry.kind === "equity") {
          ticker.push({
            symbol: entry.symbol,
            kind: entry.kind,
            priceUsd: null,
            changePercent24h: null,
            note: EQUITY_NO_SOURCE_NOTE,
          });
          continue;
        }

        const price = prices.get(entry.symbol);
        ticker.push({
          symbol: entry.symbol,
          kind: entry.kind,
          priceUsd: price?.usd ?? null,
          changePercent24h: price?.usd_24h_change ?? null,
        });
      }
      return ticker.length > 0 ? ticker : null;
    },
  };
}

/** Resolves every field independently; a failed/timed-out probe degrades that field only. Never rejects. */
export async function loadBootLiveData(deps: BootLiveDeps = defaultBootLiveDeps()): Promise<BootLiveData> {
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const config = await withTimeout<GordonConfig | null>(() => deps.loadConfig(), null, timeoutMs);
  const active = config ? activeExchange(config) : null;
  const paper = Boolean(active?.sandbox) || config?.permissionMode === "paper";
  const label = config ? venueLabel(config, active) : null;
  const tickerPlan = buildTickerSymbolPlan(config);

  const [connectivity, equityUsd, audit, ticker] = await Promise.all([
    active
      ? withTimeout(
          async () => (await deps.testVenue()).connected ? "connected" as const : "offline" as const,
          "offline" as const,
          timeoutMs,
        )
      : Promise.resolve("none" as const),
    active ? withTimeout<number | null>(() => deps.fetchEquity(), null, timeoutMs) : Promise.resolve(null),
    deferredAuditVerify(deps, timeoutMs),
    withTimeout<BootLiveData["ticker"]>(() => deps.fetchTicker(tickerPlan.display), null, timeoutMs),
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
