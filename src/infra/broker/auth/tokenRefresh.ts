/**
 * OAuth2 Token Refresh Manager for broker adapters.
 *
 * Tracks token expiry, automatically refreshes tokens before they expire,
 * and handles refresh failures with retries. Designed for long-running
 * trading sessions where Bearer tokens would otherwise silently expire.
 */

/** Configuration for the token manager. */
export interface TokenConfig {
  /** Current access token. */
  accessToken: string;
  /** OAuth2 refresh token (required for automatic refresh). */
  refreshToken?: string;
  /** Unix timestamp in milliseconds when the access token expires. */
  expiresAt?: number;
  /** OAuth2 token endpoint URL for the broker. */
  tokenEndpoint?: string;
  /** OAuth2 client ID. */
  clientId?: string;
  /** OAuth2 client secret. */
  clientSecret?: string;
}

/** Result from a token endpoint response. */
interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
}

/** Default token lifetime if not specified: 1 hour in milliseconds. */
const DEFAULT_LIFETIME_MS = 60 * 60 * 1000;

/** Refresh the token this many ms before actual expiry (5 minutes). */
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

/** Maximum number of retry attempts for a failed refresh. */
const MAX_REFRESH_RETRIES = 3;

/** Base delay between retries in ms (doubles each attempt). */
const RETRY_BASE_DELAY_MS = 1_000;

export type TokenRefreshListener = (event: {
  type: "refreshed" | "refresh_failed";
  message: string;
}) => void;

export class TokenManager {
  private accessToken: string;
  private refreshToken: string | undefined;
  private expiresAt: number;
  private readonly tokenEndpoint: string | undefined;
  private readonly clientId: string | undefined;
  private readonly clientSecret: string | undefined;

  /**
   * In-flight refresh promise. Prevents concurrent refresh requests
   * when multiple API calls race to refresh at the same time.
   */
  private refreshPromise: Promise<string> | null = null;

  /** Optional listener for refresh lifecycle events. */
  private listener: TokenRefreshListener | null = null;

  constructor(config: TokenConfig) {
    this.accessToken = config.accessToken;
    this.refreshToken = config.refreshToken;
    this.expiresAt = config.expiresAt ?? Date.now() + DEFAULT_LIFETIME_MS;
    this.tokenEndpoint = config.tokenEndpoint;
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Returns the current access token, refreshing it first if it is expired
   * or about to expire within the buffer window.
   *
   * Safe to call concurrently -- concurrent callers share the same in-flight
   * refresh request.
   */
  async ensureValidToken(): Promise<string> {
    if (!this.needsRefresh()) {
      return this.accessToken;
    }

    // If we cannot refresh (no refresh token or no endpoint), return what we have.
    if (!this.canRefresh()) {
      return this.accessToken;
    }

    // Coalesce concurrent callers onto one in-flight refresh.
    if (!this.refreshPromise) {
      this.refreshPromise = this.performRefresh().finally(() => {
        this.refreshPromise = null;
      });
    }

    return this.refreshPromise;
  }

  /** Returns true if the current token is past its expiry time. */
  isExpired(): boolean {
    return Date.now() >= this.expiresAt;
  }

  /** Returns the current access token without checking expiry. */
  getToken(): string {
    return this.accessToken;
  }

  /**
   * Manually set new tokens (e.g. after an initial OAuth2 code exchange).
   * @param access  New access token.
   * @param refresh Optional new refresh token.
   * @param expiresIn Token lifetime in seconds (default 3600).
   */
  setTokens(access: string, refresh?: string, expiresIn?: number): void {
    this.accessToken = access;
    if (refresh !== undefined) {
      this.refreshToken = refresh;
    }
    const lifetimeMs = (expiresIn ?? 3600) * 1000;
    this.expiresAt = Date.now() + lifetimeMs;
  }

  /** Register an optional listener for refresh events. */
  onRefreshEvent(listener: TokenRefreshListener): void {
    this.listener = listener;
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  /** True if the token will expire within the buffer window. */
  private needsRefresh(): boolean {
    return Date.now() >= this.expiresAt - REFRESH_BUFFER_MS;
  }

  /** True if we have what's needed to attempt a refresh. */
  private canRefresh(): boolean {
    return !!(this.refreshToken && this.tokenEndpoint);
  }

  /**
   * Execute the OAuth2 refresh_token grant with retry logic.
   * Retries up to MAX_REFRESH_RETRIES times with exponential backoff.
   */
  private async performRefresh(): Promise<string> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < MAX_REFRESH_RETRIES; attempt++) {
      try {
        const tokenData = await this.requestNewToken();
        this.accessToken = tokenData.access_token;
        if (tokenData.refresh_token) {
          this.refreshToken = tokenData.refresh_token;
        }
        const lifetimeMs = (tokenData.expires_in ?? 3600) * 1000;
        this.expiresAt = Date.now() + lifetimeMs;

        this.emit({
          type: "refreshed",
          message: `Token refreshed successfully (expires in ${tokenData.expires_in ?? 3600}s)`,
        });

        return this.accessToken;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        // Wait with exponential backoff before retrying.
        if (attempt < MAX_REFRESH_RETRIES - 1) {
          const delay = RETRY_BASE_DELAY_MS * 2 ** attempt;
          await this.sleep(delay);
        }
      }
    }

    const message = `Token refresh failed after ${MAX_REFRESH_RETRIES} attempts: ${lastError?.message ?? "unknown error"}`;
    this.emit({ type: "refresh_failed", message });

    // Return the (possibly expired) token so the caller can still attempt
    // the API call -- the broker will return a 401 which surfaces clearly.
    return this.accessToken;
  }

  /** Send the actual HTTP request to the token endpoint. */
  private async requestNewToken(): Promise<TokenResponse> {
    const endpoint = this.tokenEndpoint!;
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: this.refreshToken!,
    });

    if (this.clientId) {
      body.set("client_id", this.clientId);
    }
    if (this.clientSecret) {
      body.set("client_secret", this.clientSecret);
    }

    const headers: Record<string, string> = {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    };

    // Some brokers expect client credentials via Basic auth header.
    if (this.clientId && this.clientSecret) {
      const encoded = btoa(`${this.clientId}:${this.clientSecret}`);
      headers.authorization = `Basic ${encoded}`;
    }

    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: body.toString(),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Token endpoint returned ${response.status}: ${text.slice(0, 200)}`);
    }

    const json = (await response.json()) as Record<string, unknown>;

    if (typeof json.access_token !== "string" || !json.access_token) {
      throw new Error("Token endpoint response missing access_token");
    }

    return {
      access_token: json.access_token as string,
      refresh_token: (json.refresh_token as string) ?? undefined,
      expires_in: typeof json.expires_in === "number" ? json.expires_in : undefined,
      token_type: (json.token_type as string) ?? undefined,
    };
  }

  private emit(event: { type: "refreshed" | "refresh_failed"; message: string }): void {
    if (this.listener) {
      try {
        this.listener(event);
      } catch {
        // Listener errors must not break the refresh flow.
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
