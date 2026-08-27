/**
 * OAuth Token Store — persists OAuth tokens in ~/.gordon/oauth-tokens.json
 * and optionally in the OS keyring for the sensitive values.
 *
 * Entries are keyed by (venue, clientId) so users can have multiple accounts
 * per venue (e.g. paper + live, or separate household accounts).
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { GORDON_DIR } from "../storage/paths.ts";
import { createKeyringProvider } from "../storage/keyring.ts";
import type { OAuthTokens } from "./oauth-flow.ts";
import type { OAuthVenueId } from "./oauth-registry.ts";

const TOKENS_PATH = join(GORDON_DIR, "oauth-tokens.json");

export interface StoredOAuthEntry {
  venue: OAuthVenueId;
  clientId: string;
  /** Optional user-chosen label, e.g. "schwab-live" */
  label?: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  tokenType: string;
  scope?: string;
  obtainedAt: number;
  /** Token endpoint URL, needed for refresh. */
  tokenUrl: string;
  /** Client secret for refresh (if applicable). */
  clientSecret?: string;
  /** How client auth is sent to token endpoint. */
  clientAuthMethod?: "body" | "basic";
}

interface TokenStoreFile {
  version: 1;
  entries: StoredOAuthEntry[];
}

function keyFor(venue: OAuthVenueId, clientId: string): string {
  return `${venue}:${clientId}`;
}

function keyringTokenKey(venue: OAuthVenueId, clientId: string): string {
  return `GORDON_OAUTH_${venue.toUpperCase()}_${clientId.slice(0, 12).toUpperCase()}`;
}

async function ensureDir(): Promise<void> {
  if (!existsSync(GORDON_DIR)) {
    await mkdir(GORDON_DIR, { recursive: true });
  }
}

async function readStore(): Promise<TokenStoreFile> {
  if (!existsSync(TOKENS_PATH)) {
    return { version: 1, entries: [] };
  }
  try {
    const text = await readFile(TOKENS_PATH, "utf-8");
    const parsed = JSON.parse(text) as TokenStoreFile;
    if (parsed.version !== 1 || !Array.isArray(parsed.entries)) {
      return { version: 1, entries: [] };
    }
    return parsed;
  } catch {
    return { version: 1, entries: [] };
  }
}

async function writeStore(store: TokenStoreFile): Promise<void> {
  await ensureDir();
  await writeFile(TOKENS_PATH, JSON.stringify(store, null, 2), { mode: 0o600 });
}

/** Save a newly-obtained OAuth entry. Replaces existing entry for same (venue, clientId). */
export async function saveOAuthEntry(
  entry: Omit<StoredOAuthEntry, "accessToken" | "refreshToken"> & OAuthTokens,
  options?: { useKeyring?: boolean },
): Promise<void> {
  const store = await readStore();
  const key = keyFor(entry.venue, entry.clientId);
  const filtered = store.entries.filter((e) => keyFor(e.venue, e.clientId) !== key);

  const useKeyring = options?.useKeyring ?? false;
  let storedAccess = entry.accessToken;
  let storedRefresh = entry.refreshToken;

  if (useKeyring) {
    try {
      const keyring = createKeyringProvider();
      if (await keyring.isAvailable()) {
        const kKey = keyringTokenKey(entry.venue, entry.clientId);
        const bundle = JSON.stringify({
          access: entry.accessToken,
          refresh: entry.refreshToken,
        });
        await keyring.set(kKey, bundle);
        storedAccess = "__keyring__";
        storedRefresh = entry.refreshToken ? "__keyring__" : undefined;
      }
    } catch {
      // Fall back to file storage.
    }
  }

  const stored: StoredOAuthEntry = {
    venue: entry.venue,
    clientId: entry.clientId,
    label: entry.label,
    accessToken: storedAccess,
    refreshToken: storedRefresh,
    expiresAt: entry.expiresAt,
    tokenType: entry.tokenType,
    scope: entry.scope,
    obtainedAt: entry.obtainedAt,
    tokenUrl: entry.tokenUrl,
    clientSecret: entry.clientSecret,
    clientAuthMethod: entry.clientAuthMethod,
  };

  filtered.push(stored);
  await writeStore({ version: 1, entries: filtered });
}

/** Load an OAuth entry, resolving keyring-backed tokens if present. */
export async function loadOAuthEntry(
  venue: OAuthVenueId,
  clientId?: string,
): Promise<StoredOAuthEntry | null> {
  const store = await readStore();
  const match = clientId
    ? store.entries.find((e) => e.venue === venue && e.clientId === clientId)
    : store.entries.find((e) => e.venue === venue);
  if (!match) return null;

  const resolved = { ...match };

  if (match.accessToken === "__keyring__" || match.refreshToken === "__keyring__") {
    try {
      const keyring = createKeyringProvider();
      if (await keyring.isAvailable()) {
        const raw = await keyring.get(keyringTokenKey(match.venue, match.clientId));
        if (raw) {
          const bundle = JSON.parse(raw) as { access?: string; refresh?: string };
          if (bundle.access) resolved.accessToken = bundle.access;
          if (bundle.refresh) resolved.refreshToken = bundle.refresh;
        }
      }
    } catch {
      // Keep placeholder — caller will see an invalid token and can re-auth.
    }
  }

  return resolved;
}

/** List all stored OAuth entries (tokens redacted). */
export async function listOAuthEntries(): Promise<
  Array<Omit<StoredOAuthEntry, "accessToken" | "refreshToken" | "clientSecret">>
> {
  const store = await readStore();
  return store.entries.map((e) => ({
    venue: e.venue,
    clientId: e.clientId,
    label: e.label,
    expiresAt: e.expiresAt,
    tokenType: e.tokenType,
    scope: e.scope,
    obtainedAt: e.obtainedAt,
    tokenUrl: e.tokenUrl,
    clientAuthMethod: e.clientAuthMethod,
  }));
}

/** Remove an OAuth entry (logout). */
export async function removeOAuthEntry(venue: OAuthVenueId, clientId: string): Promise<boolean> {
  const store = await readStore();
  const before = store.entries.length;
  const filtered = store.entries.filter((e) => !(e.venue === venue && e.clientId === clientId));
  if (filtered.length === before) return false;

  try {
    const keyring = createKeyringProvider();
    if (await keyring.isAvailable()) {
      await keyring.delete(keyringTokenKey(venue, clientId));
    }
  } catch {
    // Non-fatal.
  }

  await writeStore({ version: 1, entries: filtered });
  return true;
}

/** Update just the access/refresh tokens (after a refresh). */
export async function updateOAuthTokens(
  venue: OAuthVenueId,
  clientId: string,
  tokens: Pick<
    OAuthTokens,
    "accessToken" | "refreshToken" | "expiresAt" | "tokenType" | "scope" | "obtainedAt"
  >,
): Promise<void> {
  const store = await readStore();
  const entry = store.entries.find((e) => e.venue === venue && e.clientId === clientId);
  if (!entry) return;

  const wasKeyring = entry.accessToken === "__keyring__";
  if (wasKeyring) {
    try {
      const keyring = createKeyringProvider();
      if (await keyring.isAvailable()) {
        await keyring.set(
          keyringTokenKey(venue, clientId),
          JSON.stringify({ access: tokens.accessToken, refresh: tokens.refreshToken }),
        );
      }
    } catch {
      // Fall back to file.
    }
  } else {
    entry.accessToken = tokens.accessToken;
    entry.refreshToken = tokens.refreshToken;
  }

  entry.expiresAt = tokens.expiresAt;
  entry.tokenType = tokens.tokenType;
  entry.scope = tokens.scope;
  entry.obtainedAt = tokens.obtainedAt;

  await writeStore(store);
}

export function isEntryExpired(entry: StoredOAuthEntry, bufferMs: number = 5 * 60 * 1000): boolean {
  return Date.now() >= entry.expiresAt - bufferMs;
}
