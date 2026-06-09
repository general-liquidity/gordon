/**
 * Exchange Sandbox / Paper Trading Support Matrix
 *
 * Central declaration of which exchanges offer a sandbox/testnet/demo
 * environment Gordon can route to when `credentials.sandbox === true`.
 *
 * The factory consults this before constructing a sandbox adapter so that
 * requests for unsupported venues fail with a clear, actionable error
 * instead of silently routing to production.
 *
 * Kinds of sandbox support:
 *  - "testnet_url"   — separate base URL hosting fake-money infrastructure
 *                      (Binance, Hyperliquid, Coinbase, Gemini)
 *  - "demo_header"   — production URL + a "simulated-trading" header
 *                      (OKX)
 *  - "credential"    — production URL, paper trading gated by a separate
 *                      subaccount issued from the venue's UI; adapter
 *                      just surfaces the flag (Bitfinex)
 *  - "unsupported"   — venue doesn't offer any paper/sandbox path Gordon
 *                      can route to (Binance US, Kraken spot, Robinhood,
 *                      Uniswap — latter would need a separate Sepolia
 *                      integration that isn't a URL swap)
 */

import type { ExchangeId, NativeExchangeId } from "./types.ts";
import { ccxtIdToNativeVenue } from "./types.ts";

export type SandboxKind = "testnet_url" | "demo_header" | "credential" | "unsupported";

export interface SandboxSupportEntry {
  kind: SandboxKind;
  /** Human-readable hint shown when user requests sandbox on an unsupported venue. */
  notSupportedHint?: string;
  /** Docs pointer for setup (empty when not applicable). */
  docs?: string;
}

export const EXCHANGE_SANDBOX_SUPPORT: Record<NativeExchangeId, SandboxSupportEntry> = {
  binance: {
    kind: "testnet_url",
    docs: "https://testnet.binance.vision — separate API keys required",
  },
  binance_us: {
    kind: "unsupported",
    notSupportedHint: "Binance US does not offer a public testnet. Use live mode with small amounts or switch to Binance (com) testnet.",
  },
  coinbase: {
    kind: "unsupported",
    notSupportedHint: "CCXT's coinbase (Advanced Trade) has no sandbox — the old native api-sandbox.coinbase.com path is gone. Use binance or okx for sandbox/paper, or run live deliberately.",
  },
  kraken: {
    kind: "unsupported",
    notSupportedHint: "Kraken spot API does not offer a sandbox. Kraken Futures has a demo at demo-futures.kraken.com but requires a dedicated futures adapter.",
  },
  bitfinex: {
    kind: "credential",
    docs: "Bitfinex paper trading is credential-based — create a paper subaccount in the Bitfinex UI and use those keys. Same production API URL.",
  },
  hyperliquid: {
    kind: "testnet_url",
    docs: "https://api.hyperliquid-testnet.xyz — same wallet private key works, just a different chain state",
  },
  robinhood: {
    kind: "unsupported",
    notSupportedHint: "Robinhood does not expose a paper trading API to developers.",
  },
  okx: {
    kind: "demo_header",
    docs: "OKX demo mode: production URL + `x-simulated-trading: 1` header. Production API keys work.",
  },
  gemini: {
    kind: "testnet_url",
    docs: "https://api.sandbox.gemini.com — separate sandbox keys required",
  },
};

/**
 * Thrown by the factory when a user requests sandbox on an exchange that
 * doesn't support it.
 */
export class SandboxNotSupportedError extends Error {
  readonly exchangeId: ExchangeId;
  readonly hint?: string;

  constructor(exchangeId: ExchangeId, hint?: string) {
    const baseMsg = `Sandbox / paper trading is not available for "${exchangeId}".`;
    super(hint ? `${baseMsg} ${hint}` : baseMsg);
    this.name = "SandboxNotSupportedError";
    this.exchangeId = exchangeId;
    this.hint = hint;
  }
}

/**
 * Validate that the requested sandbox mode is supported for this exchange.
 * No-op when sandbox isn't requested. Call from the exchange factory
 * before constructing an adapter.
 */
export function assertSandboxSupported(exchangeId: ExchangeId, sandboxRequested: boolean): void {
  if (!sandboxRequested) return;
  // Resolve the first-class venue behind the id (covers both bare and the
  // canonical `ccxt:*` form). Long-tail CCXT venues (no first-class entry)
  // defer to CCXT's own per-exchange sandbox detection at construct time.
  // First-class venues with a KNOWN-unsupported sandbox are still hard-blocked
  // here — e.g. ccxt:coinbase must not silently route to live.
  const native = ccxtIdToNativeVenue(exchangeId);
  if (!native) return;
  const entry = EXCHANGE_SANDBOX_SUPPORT[native];
  if (entry.kind === "unsupported") {
    throw new SandboxNotSupportedError(exchangeId, entry.notSupportedHint);
  }
}

/**
 * Is this exchange able to run in sandbox mode?
 *
 * For native exchanges: consults the static support matrix.
 * For CCXT-routed exchanges: returns true optimistically — actual sandbox
 * availability is resolved by CCXT at adapter construct time. Some CCXT
 * exchanges silently no-op on `setSandboxMode(true)` rather than throwing.
 */
export function isSandboxSupported(exchangeId: ExchangeId): boolean {
  const native = ccxtIdToNativeVenue(exchangeId);
  if (!native) return true;
  return EXCHANGE_SANDBOX_SUPPORT[native].kind !== "unsupported";
}

/**
 * List of every NATIVE ExchangeId that supports some form of sandbox. CCXT
 * IDs are excluded because the set is unbounded — query CCXT directly for
 * per-exchange sandbox availability.
 */
export function listSandboxSupported(): NativeExchangeId[] {
  return (Object.keys(EXCHANGE_SANDBOX_SUPPORT) as NativeExchangeId[]).filter(
    (id) => EXCHANGE_SANDBOX_SUPPORT[id].kind !== "unsupported",
  );
}
