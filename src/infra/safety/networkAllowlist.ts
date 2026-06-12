/**
 * Network Allowlist (GORDON_NETWORK_ALLOWLIST).
 *
 * Port of the outbound-allowlist pattern from Anthropic's "Claude Code
 * Sandboxing" article and OpenHands' "Mitigating Prompt Injection Attacks"
 * (both 2026). Closes the data-exfiltration attack surface: a tool whose
 * prompt or input was compromised could otherwise quietly call
 * `https://pastebin.com/raw/...` with the agent's API keys or position
 * data.
 *
 * The primitive is intentionally simple — host-string matching against
 * a configurable allowlist with two modes:
 *
 *   - "warn"  — log a warning when an outbound URL is not on the
 *               allowlist; let the call through.
 *   - "block" — refuse the call with a `BlockedOutboundError`.
 *
 * `GORDON_DEFAULT_ALLOWLIST` covers the canonical hosts Gordon
 * already talks to (exchange APIs, brokers, LLM providers, observability
 * backends). Callers extend per-tool via `addAllowedHost`.
 *
 * Boundary held: this is OUTBOUND check, not inbound. Gordon's existing
 * `injectionDefense.ts` handles untrusted input; this handles untrusted
 * destinations.
 */

export const NETWORK_ALLOWLIST_FLAG_ENV = "GORDON_NETWORK_ALLOWLIST";
export const NETWORK_ALLOWLIST_MODE_ENV = "GORDON_NETWORK_ALLOWLIST_MODE";

export type AllowlistMode = "warn" | "block";

export interface AllowlistRule {
  /** Host pattern. Supports exact match and `*.suffix.com` wildcard. */
  hostPattern: string;
  /** Optional reason — surfaced in payloads. */
  reason?: string;
}

export interface CheckOutboundInput {
  /** Full URL string the caller is about to fetch. */
  url: string;
  /** Tool / caller id for diagnostics. */
  caller?: string;
}

export interface CheckOutboundResult {
  allowed: boolean;
  /** Resolved hostname (lowercased, sans port). */
  host: string;
  /** The matching rule when allowed. */
  matchedRule?: AllowlistRule;
  /** Reason for block. */
  reason?: string;
  /** Mode at decision time. */
  mode: AllowlistMode;
}

export class BlockedOutboundError extends Error {
  constructor(public readonly result: CheckOutboundResult) {
    super(`Outbound URL blocked: ${result.host} (${result.reason ?? "not on allowlist"})`);
    this.name = "BlockedOutboundError";
  }
}

/**
 * Canonical hosts Gordon already talks to. Conservative — does NOT
 * include browser/news/web-scrape hosts because those are higher-risk.
 */
export const GORDON_DEFAULT_ALLOWLIST: readonly AllowlistRule[] = [
  // LLM providers
  { hostPattern: "api.anthropic.com", reason: "Anthropic LLM" },
  { hostPattern: "api.openai.com", reason: "OpenAI / Dedalus router" },
  { hostPattern: "api.dedalus.ai", reason: "Dedalus router" },
  // Crypto exchanges
  { hostPattern: "*.binance.com", reason: "Binance" },
  { hostPattern: "*.binance.us", reason: "Binance US" },
  { hostPattern: "*.coinbase.com", reason: "Coinbase" },
  { hostPattern: "*.kraken.com", reason: "Kraken" },
  { hostPattern: "*.okx.com", reason: "OKX" },
  { hostPattern: "*.hyperliquid.xyz", reason: "Hyperliquid" },
  { hostPattern: "*.gemini.com", reason: "Gemini" },
  { hostPattern: "*.bitfinex.com", reason: "Bitfinex" },
  // Stock / equity brokers
  { hostPattern: "*.alpaca.markets", reason: "Alpaca" },
  { hostPattern: "*.interactivebrokers.com", reason: "Interactive Brokers" },
  { hostPattern: "*.trading212.com", reason: "Trading 212" },
  { hostPattern: "*.tastytrade.com", reason: "Tastytrade" },
  { hostPattern: "*.robinhood.com", reason: "Robinhood" },
  // Data / news (passive read-only)
  { hostPattern: "finnhub.io", reason: "Finnhub" },
  { hostPattern: "*.finnhub.io", reason: "Finnhub" },
  { hostPattern: "finance.yahoo.com", reason: "Yahoo Finance headlines" },
  { hostPattern: "www.sec.gov", reason: "SEC EDGAR" },
  { hostPattern: "data.sec.gov", reason: "SEC EDGAR" },
  { hostPattern: "api.coingecko.com", reason: "CoinGecko" },
  { hostPattern: "api.dexscreener.com", reason: "DexScreener" },
  { hostPattern: "api.1inch.dev", reason: "1inch" },
  { hostPattern: "api.zerion.io", reason: "Zerion" },
  { hostPattern: "pro-openapi.debank.com", reason: "DeBank" },
  { hostPattern: "api.nansen.ai", reason: "Nansen" },
  { hostPattern: "api.arkm.com", reason: "Arkham" },
  { hostPattern: "api.covalenthq.com", reason: "Covalent" },
  { hostPattern: "api.santiment.net", reason: "Santiment" },
  { hostPattern: "api.glassnode.com", reason: "Glassnode" },
  { hostPattern: "api.cryptoquant.com", reason: "CryptoQuant" },
  { hostPattern: "api.intotheblock.com", reason: "IntoTheBlock" },
  { hostPattern: "api.messari.io", reason: "Messari" },
  // On-chain / EVM
  { hostPattern: "*.alchemy.com", reason: "Alchemy RPC" },
  { hostPattern: "*.helius.dev", reason: "Helius Solana" },
  // Observability
  { hostPattern: "*.axiom.co", reason: "Axiom telemetry" },
  // License / hosted services
  { hostPattern: "*.supabase.co", reason: "Gordon license service" },
  // Localhost (development)
  { hostPattern: "localhost", reason: "local dev" },
  { hostPattern: "127.0.0.1", reason: "local dev" },
];

const _registry: AllowlistRule[] = [...GORDON_DEFAULT_ALLOWLIST];

export function isNetworkAllowlistEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env[NETWORK_ALLOWLIST_FLAG_ENV];
  return raw !== "0" && raw !== "false";
}

export function getAllowlistMode(env: NodeJS.ProcessEnv = process.env): AllowlistMode {
  const raw = env[NETWORK_ALLOWLIST_MODE_ENV];
  if (raw === "block") return "block";
  // Default is "warn" — log only, don't break tools.
  return "warn";
}

/** Add a host to the in-memory allowlist. */
export function addAllowedHost(rule: AllowlistRule): void {
  _registry.push(rule);
}

/** Read the current allowlist (mostly for diagnostics / tests). */
export function listAllowedHosts(): readonly AllowlistRule[] {
  return [..._registry];
}

/** Reset the registry to defaults — tests only. */
export function resetAllowlistForTesting(): void {
  _registry.length = 0;
  _registry.push(...GORDON_DEFAULT_ALLOWLIST);
}

function extractHost(rawUrl: string): string | null {
  try {
    const u = new URL(rawUrl);
    return u.hostname.toLowerCase();
  } catch {
    return null;
  }
}

function hostMatches(host: string, pattern: string): boolean {
  const p = pattern.toLowerCase();
  const h = host.toLowerCase();
  if (p === h) return true;
  if (p.startsWith("*.")) {
    const suffix = p.slice(1); // ".binance.com"
    return h.endsWith(suffix) && h !== suffix.slice(1);
  }
  return false;
}

/**
 * Check whether `url` is on the allowlist. Pure function — no side effects.
 * Mode is read at call time.
 */
export function checkOutbound(
  input: CheckOutboundInput,
  opts: { mode?: AllowlistMode; rules?: readonly AllowlistRule[] } = {},
): CheckOutboundResult {
  const mode = opts.mode ?? getAllowlistMode();
  const rules = opts.rules ?? _registry;
  const host = extractHost(input.url);
  if (!host) {
    return {
      allowed: false,
      host: input.url,
      reason: "malformed URL",
      mode,
    };
  }
  for (const rule of rules) {
    if (hostMatches(host, rule.hostPattern)) {
      return { allowed: true, host, matchedRule: rule, mode };
    }
  }
  return {
    allowed: false,
    host,
    reason: `host '${host}' not on allowlist`,
    mode,
  };
}

/**
 * Enforce the allowlist on an outbound URL. In "block" mode, throws
 * `BlockedOutboundError` on a miss. In "warn" mode, returns the result
 * and the caller decides what to do.
 */
export function enforceOutbound(
  input: CheckOutboundInput,
  opts: { mode?: AllowlistMode; rules?: readonly AllowlistRule[] } = {},
): CheckOutboundResult {
  const result = checkOutbound(input, opts);
  if (!result.allowed && result.mode === "block") {
    throw new BlockedOutboundError(result);
  }
  return result;
}

export function resultToPayload(result: CheckOutboundResult, caller?: string): Record<string, unknown> {
  return {
    kind: "network_allowlist.check_recorded",
    allowed: result.allowed,
    host: result.host,
    mode: result.mode,
    matchedRule: result.matchedRule?.hostPattern,
    reason: result.reason,
    caller,
  };
}
