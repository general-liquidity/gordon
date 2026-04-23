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

import type { ExchangeId } from "./types.ts";

export type SandboxKind = "testnet_url" | "demo_header" | "credential" | "unsupported";

export interface SandboxSupportEntry {
  kind: SandboxKind;
  /** Human-readable hint shown when user requests sandbox on an unsupported venue. */
  notSupportedHint?: string;
  /** Docs pointer for setup (empty when not applicable). */
  docs?: string;
}

export const EXCHANGE_SANDBOX_SUPPORT: Record<ExchangeId, SandboxSupportEntry> = {
  binance: {
    kind: "testnet_url",
    docs: "https://testnet.binance.vision — separate API keys required",
  },
  binance_us: {
    kind: "unsupported",
    notSupportedHint: "Binance US does not offer a public testnet. Use live mode with small amounts or switch to Binance (com) testnet.",
  },
  coinbase: {
    kind: "testnet_url",
    docs: "https://api-sandbox.coinbase.com — separate CDP sandbox keys required",
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
  uniswap: {
    kind: "unsupported",
    notSupportedHint: "Uniswap is on-chain. 'Paper trading' would mean switching to a testnet chain (e.g. Sepolia) which requires a separate RPC + subgraph integration, not a URL override.",
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
  const entry = EXCHANGE_SANDBOX_SUPPORT[exchangeId];
  if (entry.kind === "unsupported") {
    throw new SandboxNotSupportedError(exchangeId, entry.notSupportedHint);
  }
}

/**
 * Is this exchange able to run in sandbox mode?
 */
export function isSandboxSupported(exchangeId: ExchangeId): boolean {
  return EXCHANGE_SANDBOX_SUPPORT[exchangeId].kind !== "unsupported";
}

/**
 * List of every ExchangeId that supports some form of sandbox. Useful for
 * diagnostic surfaces ("which venues can I paper-trade on?").
 */
export function listSandboxSupported(): ExchangeId[] {
  return (Object.keys(EXCHANGE_SANDBOX_SUPPORT) as ExchangeId[]).filter(isSandboxSupported);
}
