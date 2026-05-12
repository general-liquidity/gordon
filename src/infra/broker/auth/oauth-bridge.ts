/**
 * Bridge between the OAuth token store and BrokerCredentials.
 *
 * Given a broker id with an OAuth entry, returns BrokerCredentials populated
 * with a fresh bearer token + refresh token + token endpoint so the
 * RestBrokerAdapter's TokenManager can keep the session alive.
 */

import { ensureValidOAuthTokens } from "../../auth/oauth-connect.ts";
import { supportsOAuth, type OAuthVenueId } from "../../auth/oauth-registry.ts";
import type { BrokerCredentials, BrokerId } from "../types.ts";

/**
 * Map broker id → OAuth venue id. Only brokers that support OAuth 2.0
 * (verified against live docs as of April 2026).
 *
 * Excluded: etrade (OAuth 1.0a only), ibkr (OAuth 1.0a vendor-gated),
 * webull (partner-gated), trading212 (HTTP Basic only).
 */
const BROKER_TO_OAUTH: Partial<Record<BrokerId, OAuthVenueId>> = {
  schwab: "schwab",
  tradier: "tradier",
  alpaca: "alpaca",
  tradestation: "tradestation",
  tastytrade: "tastytrade",
};

export function brokerSupportsOAuth(brokerId: BrokerId): boolean {
  const venue = BROKER_TO_OAUTH[brokerId];
  return !!venue && supportsOAuth(venue);
}

/**
 * Build BrokerCredentials from a stored OAuth entry. Refreshes the token
 * if it is expired (or about to expire). Returns null if no OAuth entry exists.
 */
export async function loadOAuthBrokerCredentials(
  brokerId: BrokerId,
  options?: {
    clientId?: string;
    paper?: boolean;
    accountId?: string;
    baseUrl?: string;
  },
): Promise<BrokerCredentials | null> {
  const venue = BROKER_TO_OAUTH[brokerId];
  if (!venue) return null;

  const entry = await ensureValidOAuthTokens(venue, options?.clientId);
  if (!entry) return null;

  const lifetimeSec = Math.max(
    60,
    Math.floor((entry.expiresAt - Date.now()) / 1000),
  );

  return {
    apiKey: entry.accessToken,
    apiSecret: entry.clientSecret ?? "",
    accountId: options?.accountId,
    paper: options?.paper,
    baseUrl: options?.baseUrl,
    refreshToken: entry.refreshToken,
    tokenEndpoint: entry.tokenUrl,
    oauthClientId: entry.clientId,
    oauthClientSecret: entry.clientSecret,
    tokenExpiresIn: lifetimeSec,
    isOAuth: true,
  };
}
