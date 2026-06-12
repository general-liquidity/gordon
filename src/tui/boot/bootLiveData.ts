import { exchangeStatus } from "../../app/commands/exchange.ts";
import { verifyStoredAuditChain } from "../../core/audit/store.ts";
import type { AuditChainVerification } from "../../core/audit/signing.ts";
import { getCoinGeckoClient } from "../../infra/data/providers/coingecko.ts";
import { ExchangeFactory } from "../../infra/exchange/factory.ts";
import { loadConfig } from "../../infra/storage/config/config.ts";
import type { GordonConfig, MultiExchangeConfig } from "../../types/index.ts";

export interface BootLiveData {
  venue: {
    label: string | null;
    paper: boolean;
    connectivity: "connecting" | "connected" | "offline" | "none";
  };
  equityUsd: number | null;
  audit: { state: "checking" | "ok" | "broken" | "unavailable"; checked: number };
  ticker: Array<{ symbol: string; priceUsd: number; changePercent24h: number }> | null;
}

export interface BootLiveDeps {
  loadConfig: typeof loadConfig;
  testVenue: () => Promise<{ connected: boolean }>;
  fetchEquity: () => Promise<number>;
  verifyAudit: () => AuditChainVerification;
  fetchTicker: () => Promise<BootLiveData["ticker"]>;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 5_000;

function activeExchange(config: GordonConfig): MultiExchangeConfig | null {
  const exchanges = config.exchanges ?? [];
  return exchanges.find((exchange) => exchange.id === config.activeExchangeId)
    ?? exchanges.find((exchange) => exchange.isDefault)
    ?? exchanges[0]
    ?? null;
}

function venueLabel(config: GordonConfig, active: MultiExchangeConfig | null): string | null {
  if (!active) return null;
  const suffixCount = Math.max(0, (config.exchanges ?? []).length - 1);
  const type = active.type.replace(/^ccxt:/, "");
  return suffixCount > 0 ? `${type} +${suffixCount}` : type;
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
    fetchTicker: async () => {
      const prices = await getCoinGeckoClient().getPrices(["BTC", "ETH"]);
      const ticker: BootLiveData["ticker"] = [];
      for (const symbol of ["BTC", "ETH"]) {
        const price = prices.get(symbol);
        if (!price) continue;
        ticker.push({
          symbol,
          priceUsd: price.usd,
          changePercent24h: price.usd_24h_change,
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
    withTimeout<BootLiveData["ticker"]>(() => deps.fetchTicker(), null, timeoutMs),
  ]);

  return {
    venue: { label, paper, connectivity },
    equityUsd,
    audit,
    ticker,
  };
}
