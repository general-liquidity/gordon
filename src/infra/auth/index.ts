/**
 * OAuth 2.0 Authentication Infrastructure
 *
 * Generic OAuth flow runner, per-venue registry, and persistent token store.
 * Used by brokers (Alpaca, tastytrade) and exchanges
 * (Coinbase) that support OAuth 2.0 authorization code flow.
 */

export {
  startOAuthFlow,
  exchangeCodeForToken,
  refreshAccessToken,
} from "./oauth-flow.ts";
export type {
  OAuthFlowConfig,
  OAuthTokens,
  OAuthFlowResult,
} from "./oauth-flow.ts";

export {
  OAUTH_VENUES,
  getOAuthVenueConfig,
  supportsOAuth,
  listOAuthVenues,
  buildOAuthFlowConfig,
} from "./oauth-registry.ts";
export type { OAuthVenueId, OAuthVenueConfig } from "./oauth-registry.ts";

export { connectOAuth, ensureValidOAuthTokens } from "./oauth-connect.ts";
export type { ConnectOAuthOptions, ConnectOAuthResult } from "./oauth-connect.ts";

export {
  saveOAuthEntry,
  loadOAuthEntry,
  listOAuthEntries,
  removeOAuthEntry,
  updateOAuthTokens,
  isEntryExpired,
} from "./oauth-store.ts";
export type { StoredOAuthEntry } from "./oauth-store.ts";
