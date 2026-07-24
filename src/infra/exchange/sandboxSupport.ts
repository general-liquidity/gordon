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
 *                      can route to (Binance US, Kraken spot, Robinhood)
 */

import type { ExchangeId, NativeExchangeId } from "./types.ts";
import { ccxtIdToNativeVenue } from "./types.ts";
import { flagEnv } from "../config/flagResolver.ts";

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
 * Env flag that lets an operator opt into LIVE crypto trading on a venue
 * that has NO sandbox, without setting `sandbox: false` per-venue. Accepts
 * "1" or "true".
 */
export const ALLOW_LIVE_ENV = "GORDON_ALLOW_LIVE";

function isLiveAllowedByEnv(env: NodeJS.ProcessEnv): boolean {
  const raw = env[ALLOW_LIVE_ENV];
  return raw === "1" || raw === "true";
}

/**
 * Thrown when a no-sandbox venue is left un-chosen (sandbox undefined) and
 * the operator has not opted into live. Refusing here closes the asymmetry
 * with brokers (which default `paper: true`): crypto must not silently
 * default to LIVE.
 */
export class LiveOptInRequiredError extends Error {
  readonly exchangeId: ExchangeId;

  constructor(exchangeId: ExchangeId) {
    super(
      `Refusing to trade LIVE on "${exchangeId}" by default. This venue has no ` +
        `sandbox/testnet, so Gordon cannot fall back to paper trading, and you ` +
        `have not chosen live. Live trading moves REAL money in your own venue ` +
        `account (see DISCLAIMER.md). To proceed deliberately, set "sandbox": false ` +
        `on this exchange, or "live": true, or export ${ALLOW_LIVE_ENV}=1.`,
    );
    this.name = "LiveOptInRequiredError";
    this.exchangeId = exchangeId;
  }
}

export interface SandboxResolutionInput {
  exchangeId: ExchangeId;
  /** The `sandbox` flag as configured: true/false explicit, undefined = unset. */
  requestedSandbox?: boolean;
  /** Explicit per-venue live opt-in (config `live: true`). */
  live?: boolean;
  env?: NodeJS.ProcessEnv;
}

/**
 * Resolve the effective sandbox flag, applying a SAFE-BY-DEFAULT policy that
 * mirrors the broker `paper: true` default:
 *
 *  - Explicit choice always wins: `sandbox: true` -> sandbox,
 *    `sandbox: false` -> live (a deliberate live choice, respected).
 *  - `sandbox` unset (undefined): default to sandbox for venues that support
 *    one. For venues with NO sandbox, require an explicit live opt-in
 *    (`live: true` or {@link ALLOW_LIVE_ENV}); otherwise throw
 *    {@link LiveOptInRequiredError} rather than silently routing to LIVE.
 */
export function resolveSandboxMode(input: SandboxResolutionInput): boolean {
  const { exchangeId, requestedSandbox, live, env = flagEnv() } = input;

  if (requestedSandbox === true) return true;
  if (requestedSandbox === false) return false;

  // requestedSandbox === undefined: apply the safe default.
  if (isSandboxSupported(exchangeId)) return true;

  if (live === true || isLiveAllowedByEnv(env)) return false;
  throw new LiveOptInRequiredError(exchangeId);
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
