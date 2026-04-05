/**
 * High-level OAuth connect helper — the primary entry point used by commands.
 *
 * `connectOAuth()` runs the full interactive flow and persists tokens.
 * `ensureValidOAuthTokens()` returns a fresh access token, refreshing if needed.
 */

import { startOAuthFlow, refreshAccessToken } from "./oauth-flow.ts";
import {
  buildOAuthFlowConfig,
  getOAuthVenueConfig,
  type OAuthVenueId,
} from "./oauth-registry.ts";
import {
  saveOAuthEntry,
  loadOAuthEntry,
  updateOAuthTokens,
  isEntryExpired,
  type StoredOAuthEntry,
} from "./oauth-store.ts";

export interface ConnectOAuthOptions {
  venue: OAuthVenueId;
  clientId: string;
  clientSecret?: string;
  scopes?: string[];
  callbackPort?: number;
  label?: string;
  useKeyring?: boolean;
  onAuthUrl?: (url: string) => void;
}

export interface ConnectOAuthResult {
  venue: OAuthVenueId;
  clientId: string;
  accessToken: string;
  expiresAt: number;
  scope?: string;
}

/**
 * Launch the interactive OAuth flow and persist the resulting tokens.
 * Returns the access token + expiry for immediate use.
 */
export async function connectOAuth(opts: ConnectOAuthOptions): Promise<ConnectOAuthResult> {
  const venueCfg = getOAuthVenueConfig(opts.venue);
  const flowConfig = buildOAuthFlowConfig(opts.venue, opts.clientId, opts.clientSecret, {
    scopes: opts.scopes,
    callbackPort: opts.callbackPort,
  });

  const tokens = await startOAuthFlow(flowConfig, {
    onAuthUrl: opts.onAuthUrl,
  });

  await saveOAuthEntry(
    {
      ...tokens,
      venue: opts.venue,
      clientId: opts.clientId,
      label: opts.label,
      tokenUrl: venueCfg.tokenUrl,
      clientSecret: opts.clientSecret,
      clientAuthMethod: venueCfg.clientAuthMethod,
    },
    { useKeyring: opts.useKeyring ?? true },
  );

  return {
    venue: opts.venue,
    clientId: opts.clientId,
    accessToken: tokens.accessToken,
    expiresAt: tokens.expiresAt,
    scope: tokens.scope,
  };
}

/**
 * Load a stored entry and return a valid access token, refreshing it
 * automatically if expired. Returns null if no entry exists or refresh fails.
 */
export async function ensureValidOAuthTokens(
  venue: OAuthVenueId,
  clientId?: string,
): Promise<StoredOAuthEntry | null> {
  const entry = await loadOAuthEntry(venue, clientId);
  if (!entry) return null;

  if (!isEntryExpired(entry)) return entry;

  if (!entry.refreshToken) {
    // Expired and no refresh token — caller needs to re-auth.
    return entry;
  }

  try {
    const refreshed = await refreshAccessToken(
      {
        tokenUrl: entry.tokenUrl,
        clientId: entry.clientId,
        clientSecret: entry.clientSecret,
        clientAuthMethod: entry.clientAuthMethod,
      },
      entry.refreshToken,
    );

    await updateOAuthTokens(entry.venue, entry.clientId, refreshed);

    return {
      ...entry,
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken,
      expiresAt: refreshed.expiresAt,
      tokenType: refreshed.tokenType,
      scope: refreshed.scope,
      obtainedAt: refreshed.obtainedAt,
    };
  } catch {
    return entry;
  }
}
