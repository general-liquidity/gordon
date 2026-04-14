/**
 * Generic OAuth 2.0 Authorization Code Flow for CLI apps.
 *
 * Runs a local loopback HTTP server to capture the authorization code,
 * opens the user's browser to the venue's consent page, then exchanges
 * the code for access+refresh tokens.
 *
 * Supports PKCE (RFC 7636) for public clients.
 */

import { createHash, randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

export interface OAuthFlowConfig {
  /** Venue identifier (e.g. "schwab", "coinbase") */
  venue: string;
  /** OAuth authorization endpoint (where user logs in) */
  authorizationUrl: string;
  /** OAuth token endpoint (where code is exchanged) */
  tokenUrl: string;
  /** OAuth client ID */
  clientId: string;
  /** OAuth client secret (omit for PKCE-only public clients) */
  clientSecret?: string;
  /** Space-separated list of scopes requested */
  scopes: string[];
  /** Port to listen on for loopback callback (default: 8745) */
  callbackPort?: number;
  /** Callback path (default: "/callback") */
  callbackPath?: string;
  /** Enable PKCE code challenge (default: true) */
  usePKCE?: boolean;
  /** Additional auth URL query params (e.g. for audience, access_type) */
  extraAuthParams?: Record<string, string>;
  /** How client credentials are sent at token endpoint: "body" | "basic" (default: "body") */
  clientAuthMethod?: "body" | "basic";
}

export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number; // seconds
  expiresAt: number; // unix ms
  tokenType: string;
  scope?: string;
  obtainedAt: number; // unix ms
}

export interface OAuthFlowResult extends OAuthTokens {
  venue: string;
  clientId: string;
  tokenUrl: string;
}

/**
 * Open a URL in the user's default browser. On Linux, falls through a
 * chain of common openers (xdg-open → gio → kde-open → wslview) before
 * giving up — minimal Linux distros and Wayland-only setups often lack
 * xdg-open so we can't assume it's present.
 */
async function openBrowser(url: string): Promise<void> {
  const { spawn } = await import("node:child_process");
  const platform = process.platform;

  // macOS — `open` is always present
  if (platform === "darwin") {
    try {
      spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
    } catch {
      // user opens manually
    }
    return;
  }

  // Windows — `cmd /c start` is always present
  if (platform === "win32") {
    try {
      spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
    } catch {
      // user opens manually
    }
    return;
  }

  // Linux / other Unix — try a chain of openers. spawn() doesn't throw
  // until exec, so we can't catch missing-binary errors synchronously.
  // Spawn the first candidate and rely on the user fallback in the caller.
  const candidates = ["xdg-open", "gio", "kde-open5", "kde-open", "wslview"];
  for (const opener of candidates) {
    try {
      const child = spawn(opener, opener === "gio" ? ["open", url] : [url], {
        detached: true,
        stdio: "ignore",
      });
      child.on("error", () => {
        // Binary not found — try the next candidate
      });
      child.unref();
      return;
    } catch {
      // spawn() rarely throws synchronously; loop to next opener
    }
  }
}

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function generatePKCE(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

function buildAuthUrl(
  config: OAuthFlowConfig,
  redirectUri: string,
  state: string,
  pkceChallenge: string | null,
): string {
  const url = new URL(config.authorizationUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  if (config.scopes.length > 0) {
    url.searchParams.set("scope", config.scopes.join(" "));
  }
  if (pkceChallenge) {
    url.searchParams.set("code_challenge", pkceChallenge);
    url.searchParams.set("code_challenge_method", "S256");
  }
  for (const [k, v] of Object.entries(config.extraAuthParams ?? {})) {
    url.searchParams.set(k, v);
  }
  return url.toString();
}

interface CallbackResult {
  code: string;
  state: string;
}

function waitForCallback(
  port: number,
  path: string,
  expectedState: string,
  timeoutMs: number,
): Promise<CallbackResult> {
  return new Promise((resolve, reject) => {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const reqUrl = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
      if (reqUrl.pathname !== path) {
        res.writeHead(404).end("Not found");
        return;
      }

      const code = reqUrl.searchParams.get("code");
      const state = reqUrl.searchParams.get("state");
      const error = reqUrl.searchParams.get("error");

      if (error) {
        res.writeHead(400, { "content-type": "text/html" }).end(
          `<html><body><h2>Authorization failed: ${error}</h2><p>You can close this window.</p></body></html>`,
        );
        server.close();
        reject(new Error(`OAuth authorization failed: ${error}`));
        return;
      }

      if (!code || !state) {
        res.writeHead(400, { "content-type": "text/html" }).end(
          "<html><body><h2>Missing code or state</h2></body></html>",
        );
        server.close();
        reject(new Error("OAuth callback missing code or state"));
        return;
      }

      if (state !== expectedState) {
        res.writeHead(400, { "content-type": "text/html" }).end(
          "<html><body><h2>State mismatch (possible CSRF)</h2></body></html>",
        );
        server.close();
        reject(new Error("OAuth state mismatch — possible CSRF attack"));
        return;
      }

      res.writeHead(200, { "content-type": "text/html" }).end(
        `<html><body style="font-family:system-ui;padding:2rem;text-align:center">
          <h2>✓ Authorization complete</h2>
          <p>You can close this window and return to Gordon CLI.</p>
        </body></html>`,
      );
      server.close();
      resolve({ code, state });
    });

    server.on("error", reject);
    server.listen(port, "127.0.0.1");

    setTimeout(() => {
      server.close();
      reject(new Error(`OAuth callback timeout after ${timeoutMs}ms`));
    }, timeoutMs);
  });
}

/** Exchange an authorization code for access + refresh tokens. */
export async function exchangeCodeForToken(
  config: OAuthFlowConfig,
  code: string,
  redirectUri: string,
  pkceVerifier: string | null,
): Promise<OAuthTokens> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: config.clientId,
  });

  if (pkceVerifier) {
    body.set("code_verifier", pkceVerifier);
  }

  const headers: Record<string, string> = {
    "content-type": "application/x-www-form-urlencoded",
    accept: "application/json",
  };

  const authMethod = config.clientAuthMethod ?? "body";
  if (config.clientSecret) {
    if (authMethod === "basic") {
      const encoded = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");
      headers.authorization = `Basic ${encoded}`;
    } else {
      body.set("client_secret", config.clientSecret);
    }
  }

  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers,
    body: body.toString(),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `Token exchange failed (${response.status}): ${text.slice(0, 300)}`,
    );
  }

  const json = (await response.json()) as Record<string, unknown>;
  const accessToken = json.access_token;
  if (typeof accessToken !== "string" || !accessToken) {
    throw new Error("Token response missing access_token");
  }

  const expiresIn = typeof json.expires_in === "number" ? json.expires_in : 3600;
  const now = Date.now();

  return {
    accessToken,
    refreshToken: typeof json.refresh_token === "string" ? json.refresh_token : undefined,
    expiresIn,
    expiresAt: now + expiresIn * 1000,
    tokenType: typeof json.token_type === "string" ? json.token_type : "Bearer",
    scope: typeof json.scope === "string" ? json.scope : undefined,
    obtainedAt: now,
  };
}

/**
 * Run the full OAuth 2.0 authorization code flow:
 * 1. Start local loopback server
 * 2. Open browser to consent page
 * 3. Wait for callback with code
 * 4. Exchange code for tokens
 */
export async function startOAuthFlow(
  config: OAuthFlowConfig,
  options?: {
    timeoutMs?: number;
    onAuthUrl?: (url: string) => void;
  },
): Promise<OAuthFlowResult> {
  const port = config.callbackPort ?? 8745;
  const path = config.callbackPath ?? "/callback";
  const redirectUri = `http://127.0.0.1:${port}${path}`;
  const timeoutMs = options?.timeoutMs ?? 5 * 60 * 1000; // 5 min

  const state = base64url(randomBytes(24));
  const pkce = (config.usePKCE ?? true) ? generatePKCE() : null;

  const authUrl = buildAuthUrl(
    config,
    redirectUri,
    state,
    pkce?.challenge ?? null,
  );

  // Start server + open browser in parallel.
  const callbackPromise = waitForCallback(port, path, state, timeoutMs);
  options?.onAuthUrl?.(authUrl);
  await openBrowser(authUrl);

  const { code } = await callbackPromise;

  const tokens = await exchangeCodeForToken(
    config,
    code,
    redirectUri,
    pkce?.verifier ?? null,
  );

  return {
    ...tokens,
    venue: config.venue,
    clientId: config.clientId,
    tokenUrl: config.tokenUrl,
  };
}

/**
 * Refresh an access token using a refresh token.
 * Lightweight wrapper — for long-running lifecycle use TokenManager instead.
 */
export async function refreshAccessToken(
  config: Pick<OAuthFlowConfig, "tokenUrl" | "clientId" | "clientSecret" | "clientAuthMethod">,
  refreshToken: string,
): Promise<OAuthTokens> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: config.clientId,
  });

  const headers: Record<string, string> = {
    "content-type": "application/x-www-form-urlencoded",
    accept: "application/json",
  };

  const authMethod = config.clientAuthMethod ?? "body";
  if (config.clientSecret) {
    if (authMethod === "basic") {
      const encoded = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");
      headers.authorization = `Basic ${encoded}`;
    } else {
      body.set("client_secret", config.clientSecret);
    }
  }

  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers,
    body: body.toString(),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Refresh failed (${response.status}): ${text.slice(0, 300)}`);
  }

  const json = (await response.json()) as Record<string, unknown>;
  const accessToken = json.access_token;
  if (typeof accessToken !== "string" || !accessToken) {
    throw new Error("Refresh response missing access_token");
  }

  const expiresIn = typeof json.expires_in === "number" ? json.expires_in : 3600;
  const now = Date.now();

  return {
    accessToken,
    refreshToken: typeof json.refresh_token === "string" ? json.refresh_token : refreshToken,
    expiresIn,
    expiresAt: now + expiresIn * 1000,
    tokenType: typeof json.token_type === "string" ? json.token_type : "Bearer",
    scope: typeof json.scope === "string" ? json.scope : undefined,
    obtainedAt: now,
  };
}
