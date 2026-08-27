/**
 * CCXT exchange catalog + capability layer.
 *
 * CCXT ships ~111 exchanges via `ccxt.exchanges`. Gordon's factory routes any
 * `ccxt:<id>` through CcxtAdapter (it does not gate on the curated set —
 * long-tail venues defer to CCXT's own detection), so the backend already
 * supports the full list. Only the picker UI and credential env-map are
 * curated.
 *
 * This module reads venue metadata straight off CCXT instances. Instantiating
 * an exchange WITHOUT credentials is safe and free — it only populates static
 * metadata (name, requiredCredentials, has-map); no network, no auth. We
 * memoize because constructing all ~111 once is cheap but pointless to repeat.
 */

import ccxt from "ccxt";

/**
 * The curated, Gordon-tested venues. These map 1:1 to the first-class
 * NativeExchangeId set (their `ccxt:<subId>` sub-ids), have curated env-var
 * names in EXCHANGE_ENV_MAP, and sandbox-support metadata. Everything else is
 * "community": routable, but untested against Gordon's order/risk/WS path.
 */
export const VERIFIED_EXCHANGE_IDS: string[] = [
  "binance",
  "binanceus",
  "coinbase",
  "kraken",
  "bitfinex",
  "hyperliquid",
  "robinhood",
  "okx",
  "gemini",
];

const VERIFIED_SET = new Set(VERIFIED_EXCHANGE_IDS);

export interface CcxtExchangeListEntry {
  id: string;
  name: string;
  verified: boolean;
}

export interface ExchangeCapabilities {
  /** CCXT credential fields the venue requires (apiKey, secret, password, uid, privateKey, walletAddress). */
  requiredCredentials: string[];
  hasWebsocket: boolean;
  hasOHLCV: boolean;
  /** Wallet-based venue (DEX-style): requires a private key / wallet address rather than API key + secret. */
  isDex: boolean;
  displayName: string;
}

/** Static metadata read off a CCXT instance — no network, no auth. */
interface CcxtMeta {
  name?: string;
  requiredCredentials?: Record<string, boolean>;
  has?: Record<string, unknown>;
}

/** Safe metadata-only instantiation — never throws on a known ccxt id, never hits the network. */
function instantiate(id: string): CcxtMeta | undefined {
  const ctor = (ccxt as unknown as Record<string, new () => unknown>)[id];
  if (typeof ctor !== "function") return undefined;
  return new ctor() as CcxtMeta;
}

let catalogMemo: CcxtExchangeListEntry[] | undefined;

/**
 * The full CCXT catalog, verified-first then alphabetical within each tier.
 * Names come from each venue's static `.name` metadata.
 */
export function listCcxtExchanges(): CcxtExchangeListEntry[] {
  if (catalogMemo) return catalogMemo;

  const entries: CcxtExchangeListEntry[] = [];
  for (const id of ccxt.exchanges) {
    const ex = instantiate(id);
    const name = ex?.name ?? id;
    entries.push({ id, name, verified: VERIFIED_SET.has(id) });
  }

  entries.sort((a, b) => {
    if (a.verified !== b.verified) return a.verified ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  catalogMemo = entries;
  return entries;
}

const capabilitiesMemo = new Map<string, ExchangeCapabilities>();

/**
 * Read a venue's credential + feature capabilities off CCXT metadata. This
 * drives the credential prompt (which fields to ask) and the warnings
 * (no websocket / no OHLCV) — replacing the hardcoded NEEDS_PASSPHRASE /
 * WALLET_BASED sets in the picker.
 *
 * WS support is read off the `ccxt.pro` instance: base (REST) instances leave
 * the `watch*` has-flags undefined, while `ccxt.pro.<id>` populates them.
 */
export function getExchangeCapabilities(id: string): ExchangeCapabilities {
  const cached = capabilitiesMemo.get(id);
  if (cached) return cached;

  const ex = instantiate(id);

  const reqMap = ex?.requiredCredentials ?? {};
  const requiredCredentials = Object.entries(reqMap)
    .filter(([, required]) => required === true)
    .map(([field]) => field);

  const proExchanges = (ccxt as unknown as { pro?: Record<string, new () => unknown> }).pro;
  let hasWebsocket = false;
  if (proExchanges && typeof proExchanges[id] === "function") {
    const proHas = (new proExchanges[id]() as { has?: Record<string, unknown> }).has ?? {};
    hasWebsocket =
      proHas.watchTicker === true || proHas.watchOHLCV === true || proHas.watchOrderBook === true;
  }

  const has = ex?.has ?? {};
  const hasOHLCV = has.fetchOHLCV === true;
  const isDex =
    requiredCredentials.includes("privateKey") || requiredCredentials.includes("walletAddress");

  const caps: ExchangeCapabilities = {
    requiredCredentials,
    hasWebsocket,
    hasOHLCV,
    isDex,
    displayName: ex?.name ?? id,
  };
  capabilitiesMemo.set(id, caps);
  return caps;
}
