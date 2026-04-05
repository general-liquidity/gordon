/**
 * OAuth 2.0 Venue Registry
 *
 * Per-venue configuration for brokers and exchanges that support OAuth 2.0.
 * Users provide their own clientId/clientSecret obtained from the venue's
 * developer portal; Gordon handles the rest.
 *
 * All entries verified against live venue docs (April 2026).
 */

import type { OAuthFlowConfig } from "./oauth-flow.ts";

export type OAuthVenueId =
  | "schwab"
  | "tradier"
  | "alpaca"
  | "tradestation"
  | "tastytrade"
  | "gemini";

export interface OAuthVenueConfig {
  venue: OAuthVenueId;
  displayName: string;
  kind: "broker" | "exchange";
  authorizationUrl: string;
  tokenUrl: string;
  defaultScopes: string[];
  clientAuthMethod: "body" | "basic";
  usePKCE: boolean;
  extraAuthParams?: Record<string, string>;
  /** Documentation URL for obtaining OAuth credentials. */
  docsUrl: string;
  /** Human-readable note shown during setup. */
  setupNote?: string;
  /** Access token lifetime in seconds (from venue docs). */
  accessTokenLifetimeSec?: number;
  /** Refresh token lifetime notes (some venues cap at 7 days). */
  refreshTokenNote?: string;
}

export const OAUTH_VENUES: Record<OAuthVenueId, OAuthVenueConfig> = {
  // ─────────────────────────── Brokers (US) ───────────────────────────
  schwab: {
    venue: "schwab",
    displayName: "Charles Schwab",
    kind: "broker",
    authorizationUrl: "https://api.schwabapi.com/v1/oauth/authorize",
    tokenUrl: "https://api.schwabapi.com/v1/oauth/token",
    defaultScopes: [], // Schwab does not use configurable scopes
    clientAuthMethod: "basic",
    usePKCE: false,
    docsUrl: "https://developer.schwab.com/user-guides/get-started/authenticate-with-oauth",
    setupNote:
      "Access token: 30m. Refresh token: 7-day hard cap (must re-auth weekly). Register app at developer.schwab.com.",
    accessTokenLifetimeSec: 1800,
    refreshTokenNote: "7-day hard cap",
  },
  alpaca: {
    venue: "alpaca",
    displayName: "Alpaca",
    kind: "broker",
    authorizationUrl: "https://app.alpaca.markets/oauth/authorize",
    tokenUrl: "https://api.alpaca.markets/oauth/token",
    defaultScopes: ["account:write", "trading", "data"],
    clientAuthMethod: "body",
    usePKCE: false,
    docsUrl: "https://docs.alpaca.markets/docs/using-oauth2-and-trading-api",
    setupNote: "Redirect URIs must be pre-whitelisted on your OAuth app.",
  },
  tradier: {
    venue: "tradier",
    displayName: "Tradier",
    kind: "broker",
    authorizationUrl: "https://api.tradier.com/v1/oauth/authorize",
    tokenUrl: "https://api.tradier.com/v1/oauth/accesstoken",
    defaultScopes: ["read", "write", "market", "trade", "stream"],
    clientAuthMethod: "basic",
    usePKCE: false,
    docsUrl: "https://docs.tradier.com/docs/authentication",
    setupNote:
      "Auth codes expire in 10m; access tokens 24h. Refresh tokens are partner-only (non-expiring).",
    accessTokenLifetimeSec: 86400,
  },
  tradestation: {
    venue: "tradestation",
    displayName: "TradeStation",
    kind: "broker",
    authorizationUrl: "https://signin.tradestation.com/authorize",
    tokenUrl: "https://signin.tradestation.com/oauth/token",
    // openid + offline_access required for refresh tokens
    defaultScopes: [
      "openid",
      "offline_access",
      "profile",
      "MarketData",
      "ReadAccount",
      "Trade",
    ],
    clientAuthMethod: "body",
    usePKCE: false,
    // Auth0 requires audience param
    extraAuthParams: { audience: "https://api.tradestation.com" },
    docsUrl: "https://api.tradestation.com/docs/fundamentals/authentication/auth-code",
    setupNote:
      "Auth0-backed. Access token: 20m. Localhost redirect ports restricted to 80/3000/3001/8080/31022.",
    accessTokenLifetimeSec: 1200,
  },
  tastytrade: {
    venue: "tastytrade",
    displayName: "tastytrade",
    kind: "broker",
    authorizationUrl: "https://my.tastytrade.com/auth.html",
    tokenUrl: "https://api.tastytrade.com/oauth/token",
    defaultScopes: ["read", "trade", "openid"],
    clientAuthMethod: "body",
    usePKCE: true,
    docsUrl: "https://developer.tastytrade.com/oauth/",
    setupNote: "Replaces legacy session-token auth. Sandbox: api.cert.tastyworks.com.",
  },

  // ─────────────────────────── Exchanges (Crypto) ───────────────────────────
  gemini: {
    venue: "gemini",
    displayName: "Gemini",
    kind: "exchange",
    authorizationUrl: "https://exchange.gemini.com/auth",
    tokenUrl: "https://exchange.gemini.com/auth/token",
    defaultScopes: [
      "account:read",
      "balances:read",
      "orders:read",
      "orders:create",
      "history:read",
    ],
    clientAuthMethod: "body",
    usePKCE: false,
    docsUrl: "https://docs.gemini.com/authentication/oauth",
    setupNote:
      "Self-serve OAuth. Access token: 24h. Refresh tokens single-use but non-expiring. Sandbox: exchange.sandbox.gemini.com.",
    accessTokenLifetimeSec: 86400,
  },

};

/**
 * Partner-gated OAuth 2.0 venues — require approval/contract before use.
 * Listed here for reference; not bound to runtime flow. Users who have
 * partner approval can construct their own OAuthFlowConfig manually.
 */
export const PARTNER_GATED_VENUES: Array<{
  id: string;
  displayName: string;
  reason: string;
  docsUrl: string;
}> = [
  {
    id: "webull",
    displayName: "Webull",
    reason: "Requires partner approval via api@webull-us.com",
    docsUrl: "https://developer.webull.com/apis/docs/connect-api/authentication/",
  },
  {
    id: "kraken",
    displayName: "Kraken Connect",
    reason: "Partner application + approval required",
    docsUrl: "https://docs.kraken.com/api/docs/oauth/kraken-connect/",
  },
  {
    id: "binance",
    displayName: "Binance Login",
    reason: "Closed to ecosystem partners only",
    docsUrl: "https://developers.binance.com/docs/login/introduction",
  },
  {
    id: "kucoin",
    displayName: "KuCoin Fast API",
    reason: "Broker Programme approval required",
    docsUrl: "https://www.kucoin.com/announcement/kucoin-launches-fastapi-service",
  },
  {
    id: "okx",
    displayName: "OKX Fast API",
    reason: "Broker partner approval required",
    docsUrl: "https://app.okx.com/docs-v5/connect_en/",
  },
  {
    id: "cryptocom",
    displayName: "Crypto.com FastAPI",
    reason: "Broker Programme approval required",
    docsUrl: "https://crypto.com/en/product-news/fastapi-and-oauth-2",
  },
];

/**
 * Venues that do NOT support OAuth 2.0 — documented for UX clarity.
 * These require API keys (HMAC signing) or wallet-based auth.
 */
/**
 * Coinbase NOTE: Gordon's existing Coinbase client uses the Advanced Trade API
 * (HMAC-SHA256 with CB-ACCESS-KEY/SIGN/TIMESTAMP headers), which does NOT
 * support OAuth 2.0. The Coinbase App (retail) API does support OAuth 2.0 but
 * lacks pro-trading endpoints (limit orders, orderbook depth, etc.) needed
 * for a trading CLI. If retail wallet UX is added later, reintroduce Coinbase
 * with a separate retail adapter.
 */
export const NON_OAUTH_VENUES: Record<string, string> = {
  coinbase_advanced_trade: "HMAC-SHA256 or CDP JWT (OAuth only available on retail App API)",
  binance_retail: "HMAC-SHA256 API key+secret only",
  kraken_api: "HMAC-SHA512 API key+secret (Connect OAuth is partner-gated)",
  bitfinex: "HMAC-SHA384 API key+secret only",
  hyperliquid: "Wallet private key signing only",
  trading212: "HTTP Basic with API key",
  robinhood: "Ed25519 API-key signing (crypto only, no equities API)",
  ibkr: "OAuth 1.0a with RSA-SHA256 (vendor-approved only)",
  etrade: "OAuth 1.0a with HMAC-SHA1 (daily token expiry)",
};

export function getOAuthVenueConfig(venue: OAuthVenueId): OAuthVenueConfig {
  const config = OAUTH_VENUES[venue];
  if (!config) {
    throw new Error(`OAuth not supported for venue: ${venue}`);
  }
  return config;
}

export function supportsOAuth(venue: string): venue is OAuthVenueId {
  return venue in OAUTH_VENUES;
}

export function listOAuthVenues(kind?: "broker" | "exchange"): OAuthVenueConfig[] {
  const all = Object.values(OAUTH_VENUES);
  return kind ? all.filter((v) => v.kind === kind) : all;
}

/**
 * Build a runtime OAuthFlowConfig by merging venue defaults with user-provided credentials.
 */
export function buildOAuthFlowConfig(
  venue: OAuthVenueId,
  clientId: string,
  clientSecret: string | undefined,
  overrides?: { scopes?: string[]; callbackPort?: number },
): OAuthFlowConfig {
  const venueCfg = getOAuthVenueConfig(venue);

  // TradeStation restricts localhost ports to 80/3000/3001/8080/31022.
  const port = overrides?.callbackPort
    ?? (venue === "tradestation" ? 3000 : 8745);

  return {
    venue: venueCfg.venue,
    authorizationUrl: venueCfg.authorizationUrl,
    tokenUrl: venueCfg.tokenUrl,
    clientId,
    clientSecret,
    scopes: overrides?.scopes ?? venueCfg.defaultScopes,
    callbackPort: port,
    usePKCE: venueCfg.usePKCE,
    extraAuthParams: venueCfg.extraAuthParams,
    clientAuthMethod: venueCfg.clientAuthMethod,
  };
}
