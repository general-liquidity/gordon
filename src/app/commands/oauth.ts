/**
 * OAuth Commands — interactive OAuth 2.0 flow for brokers & exchanges.
 *
 * Commands:
 *   /oauth list                          — show stored OAuth connections
 *   /oauth connect <venue> <clientId>    — start OAuth flow for a venue
 *   /oauth remove <venue> <clientId>     — remove stored OAuth connection
 *   /oauth venues                        — list venues that support OAuth
 */

import {
  connectOAuth,
  listOAuthEntries,
  removeOAuthEntry,
  listOAuthVenues,
  supportsOAuth,
  getOAuthVenueConfig,
  type OAuthVenueId,
} from "../../infra/auth/index.ts";

export interface OAuthCommandResult {
  success: boolean;
  message: string;
  data?: unknown;
}

export async function oauthList(): Promise<OAuthCommandResult> {
  const entries = await listOAuthEntries();
  if (entries.length === 0) {
    return {
      success: true,
      message: "No OAuth connections. Use /oauth connect <venue> <clientId> to add one.",
      data: { entries: [] },
    };
  }

  const now = Date.now();
  const decorated = entries.map((e) => ({
    venue: e.venue,
    clientId: e.clientId.slice(0, 12) + "…",
    label: e.label ?? "",
    scope: e.scope ?? "",
    expired: now >= e.expiresAt,
    expiresInMin: Math.max(0, Math.floor((e.expiresAt - now) / 60000)),
    obtainedAt: new Date(e.obtainedAt).toISOString(),
  }));

  return {
    success: true,
    message: `${entries.length} OAuth connection(s)`,
    data: { entries: decorated },
  };
}

export async function oauthVenues(): Promise<OAuthCommandResult> {
  const venues = listOAuthVenues();
  return {
    success: true,
    message: `${venues.length} venue(s) support OAuth 2.0`,
    data: {
      venues: venues.map((v) => ({
        id: v.venue,
        name: v.displayName,
        kind: v.kind,
        scopes: v.defaultScopes,
        pkce: v.usePKCE,
        docs: v.docsUrl,
        note: v.setupNote ?? "",
      })),
    },
  };
}

export interface OAuthConnectArgs {
  venue: string;
  clientId: string;
  clientSecret?: string;
  scopes?: string[];
  callbackPort?: number;
  label?: string;
  useKeyring?: boolean;
  onAuthUrl?: (url: string) => void;
}

export async function oauthConnect(args: OAuthConnectArgs): Promise<OAuthCommandResult> {
  if (!supportsOAuth(args.venue)) {
    const venues = listOAuthVenues()
      .map((v) => v.venue)
      .join(", ");
    return {
      success: false,
      message: `Venue "${args.venue}" does not support OAuth. Supported: ${venues}`,
    };
  }

  const venueId = args.venue as OAuthVenueId;
  const cfg = getOAuthVenueConfig(venueId);

  if (!args.clientId) {
    return {
      success: false,
      message: `clientId is required. See ${cfg.docsUrl} to register an OAuth app.`,
    };
  }

  try {
    const result = await connectOAuth({
      venue: venueId,
      clientId: args.clientId,
      clientSecret: args.clientSecret,
      scopes: args.scopes,
      callbackPort: args.callbackPort,
      label: args.label,
      useKeyring: args.useKeyring ?? true,
      onAuthUrl: args.onAuthUrl,
    });

    const expiresInMin = Math.floor((result.expiresAt - Date.now()) / 60000);
    return {
      success: true,
      message: `✓ Connected to ${cfg.displayName} (token expires in ${expiresInMin}m)`,
      data: {
        venue: result.venue,
        clientId: result.clientId,
        scope: result.scope,
        expiresAt: result.expiresAt,
      },
    };
  } catch (err) {
    return {
      success: false,
      message: `OAuth flow failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Paste a pre-obtained access token (skip browser flow). Useful for venues that
 * issue personal access tokens from their dashboard (Tradier, Gemini, tastytrade)
 * or for users who already ran the OAuth dance elsewhere.
 */
export async function oauthPasteToken(args: {
  venue: string;
  accessToken: string;
  refreshToken?: string;
  clientId?: string;
  clientSecret?: string;
  expiresInSec?: number;
  scope?: string;
  label?: string;
  useKeyring?: boolean;
}): Promise<OAuthCommandResult> {
  if (!supportsOAuth(args.venue)) {
    return { success: false, message: `Venue "${args.venue}" is not in the OAuth registry.` };
  }
  if (!args.accessToken) {
    return { success: false, message: "accessToken is required." };
  }

  const venueId = args.venue as OAuthVenueId;
  const cfg = getOAuthVenueConfig(venueId);
  const { saveOAuthEntry } = await import("../../infra/auth/oauth-store.ts");

  const now = Date.now();
  const expiresInSec = args.expiresInSec ?? cfg.accessTokenLifetimeSec ?? 3600;
  // Synthetic clientId for PAT-only entries so they can be referenced/removed.
  const clientId = args.clientId ?? `pat-${now.toString(36)}`;

  await saveOAuthEntry(
    {
      venue: venueId,
      clientId,
      label: args.label ?? "pasted-token",
      accessToken: args.accessToken,
      refreshToken: args.refreshToken,
      expiresIn: expiresInSec,
      expiresAt: now + expiresInSec * 1000,
      tokenType: "Bearer",
      scope: args.scope,
      obtainedAt: now,
      tokenUrl: cfg.tokenUrl,
      clientSecret: args.clientSecret,
      clientAuthMethod: cfg.clientAuthMethod,
    },
    { useKeyring: args.useKeyring ?? true },
  );

  const expiresInMin = Math.floor(expiresInSec / 60);
  const canRefresh = !!(args.refreshToken && (args.clientSecret || !cfg.clientAuthMethod));
  return {
    success: true,
    message: `✓ Stored ${cfg.displayName} access token (${expiresInMin}m lifetime${canRefresh ? ", auto-refresh enabled" : ", no refresh"})`,
    data: { venue: venueId, clientId, canRefresh },
  };
}

export async function oauthRemove(venue: string, clientId: string): Promise<OAuthCommandResult> {
  if (!supportsOAuth(venue)) {
    return { success: false, message: `Unknown OAuth venue: ${venue}` };
  }
  const removed = await removeOAuthEntry(venue as OAuthVenueId, clientId);
  return {
    success: removed,
    message: removed
      ? `Removed OAuth connection for ${venue}`
      : `No OAuth connection found for ${venue} with clientId ${clientId}`,
  };
}

export async function handleOAuthCommand(
  subcommand: string,
  args: string[],
  options?: { onAuthUrl?: (url: string) => void },
): Promise<OAuthCommandResult> {
  switch (subcommand) {
    case "list":
      return oauthList();
    case "venues":
      return oauthVenues();
    case "connect": {
      const [venue, clientId, clientSecret] = args;
      if (!venue || !clientId) {
        return {
          success: false,
          message: "Usage: /oauth connect <venue> <clientId> [clientSecret]",
        };
      }
      return oauthConnect({
        venue,
        clientId,
        clientSecret,
        onAuthUrl: options?.onAuthUrl,
      });
    }
    case "remove": {
      const [venue, clientId] = args;
      if (!venue || !clientId) {
        return { success: false, message: "Usage: /oauth remove <venue> <clientId>" };
      }
      return oauthRemove(venue, clientId);
    }
    case "paste":
    case "paste-token": {
      const [venue, accessToken, refreshToken] = args;
      if (!venue || !accessToken) {
        return {
          success: false,
          message: "Usage: /oauth paste-token <venue> <accessToken> [refreshToken]",
        };
      }
      return oauthPasteToken({ venue, accessToken, refreshToken });
    }
    default:
      return {
        success: false,
        message: `Unknown /oauth subcommand: ${subcommand}. Try: list, connect, paste-token, remove, venues`,
      };
  }
}
