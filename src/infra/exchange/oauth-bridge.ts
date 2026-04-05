/**
 * Exchange-side OAuth Bridge
 *
 * Resolves OAuth access tokens from the oauth-store into ExchangeCredentials
 * for exchanges that support OAuth 2.0 bearer auth (currently: Gemini).
 */

import { ensureValidOAuthTokens } from "../auth/oauth-connect.ts";
import { supportsOAuth, type OAuthVenueId } from "../auth/oauth-registry.ts";
import type { ExchangeCredentials, ExchangeId } from "./types.ts";

const EXCHANGE_TO_OAUTH: Partial<Record<ExchangeId, OAuthVenueId>> = {
  gemini: "gemini",
};

export function exchangeSupportsOAuth(exchangeId: ExchangeId): boolean {
  const venue = EXCHANGE_TO_OAUTH[exchangeId];
  return !!venue && supportsOAuth(venue);
}

/**
 * Load ExchangeCredentials from a stored OAuth entry. Refreshes the token
 * if expired. Returns null if no OAuth entry exists for the exchange.
 *
 * OAuth access token is placed in `apiKey` field with an `__oauth__` prefix
 * marker so the exchange adapter can detect bearer mode. Cleaner alternative
 * would be a dedicated accessToken field on ExchangeCredentials — added here
 * as an extension via type intersection for now.
 */
export async function loadOAuthExchangeCredentials(
  exchangeId: ExchangeId,
  options?: { clientId?: string; sandbox?: boolean },
): Promise<(ExchangeCredentials & { accessToken?: string }) | null> {
  const venue = EXCHANGE_TO_OAUTH[exchangeId];
  if (!venue) return null;

  const entry = await ensureValidOAuthTokens(venue, options?.clientId);
  if (!entry) return null;

  return {
    apiKey: "",
    apiSecret: "",
    accessToken: entry.accessToken,
    sandbox: options?.sandbox,
  };
}
