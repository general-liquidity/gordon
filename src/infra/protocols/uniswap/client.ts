/**
 * Uniswap Trading API Client
 * Handles API requests to the Uniswap Trading API
 *
 * Implements the full swap flow per the integration guide:
 *   1. /quote — get routing + price
 *   2. /check_approval — verify ERC-20 allowance
 *   3. /swap — build unsigned transaction (with optional Permit2)
 *
 * Requires:
 * - API key from developers.uniswap.org
 * - Wallet address for quoting/swapping
 */

import type {
  UniswapQuoteRequest,
  UniswapQuoteResponse,
  UniswapQuoteOptions,
  UniswapSwapResponse,
  UniswapApprovalResponse,
} from "./types.ts";
import { WRAPPED_NATIVE, USDC_ADDRESSES, NATIVE_TOKEN, GAS_BUFFER_PERCENT } from "./types.ts";
import { UniswapTokenList } from "./token-list.ts";

// API base URL
const BASE_URL = "https://trade-api.gateway.uniswap.org/v1";

// Retry configuration per integration guide (exponential backoff, max 3 attempts)
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 500;

/** Quote staleness threshold — refresh if older than 30s per docs */
const QUOTE_MAX_AGE_MS = 30_000;

// Rate limit tracking
interface RateLimitState {
  requestCount: number;
  lastReset: number;
  throttledCount: number;
}

const RATE_LIMIT_CONFIG = {
  maxRequestsPerMinute: 60,
  throttleThreshold: 50,
};

/**
 * Uniswap Trading API Client
 */
export class UniswapClient {
  private apiKey: string;
  private walletAddress: string;
  private chainId: number;

  private rateLimitState: RateLimitState;
  private circuitState: "closed" | "open" | "half-open" = "closed";
  private consecutiveFailures = 0;
  private tokenList = new UniswapTokenList();

  constructor(apiKey: string, walletAddress: string, chainId = 1) {
    this.apiKey = apiKey;
    this.walletAddress = walletAddress;
    this.chainId = chainId;
    this.rateLimitState = {
      requestCount: 0,
      lastReset: Date.now(),
      throttledCount: 0,
    };
  }

  /**
   * Get the wallet address
   */
  get address(): string {
    return this.walletAddress;
  }

  /**
   * Get the current chain ID
   */
  get chain(): number {
    return this.chainId;
  }

  // -------------------------------------------------------------------------
  // Rate Limiting
  // -------------------------------------------------------------------------

  private checkRateLimit(): void {
    const now = Date.now();
    if (now - this.rateLimitState.lastReset > 60_000) {
      this.rateLimitState.requestCount = 0;
      this.rateLimitState.lastReset = now;
      this.rateLimitState.throttledCount = 0;
    }
  }

  shouldThrottle(): boolean {
    this.checkRateLimit();
    return (
      this.circuitState === "open" ||
      this.rateLimitState.requestCount > RATE_LIMIT_CONFIG.throttleThreshold
    );
  }

  getRateLimitStatus(): {
    currentRequests: number;
    maxRequests: number;
    usagePercent: number;
    isThrottling: boolean;
    throttledCount: number;
    timeUntilReset: number;
  } {
    this.checkRateLimit();
    const usagePercent =
      (this.rateLimitState.requestCount / RATE_LIMIT_CONFIG.maxRequestsPerMinute) * 100;
    return {
      currentRequests: this.rateLimitState.requestCount,
      maxRequests: RATE_LIMIT_CONFIG.maxRequestsPerMinute,
      usagePercent: Math.round(usagePercent),
      isThrottling: this.shouldThrottle(),
      throttledCount: this.rateLimitState.throttledCount,
      timeUntilReset: Math.max(0, 60_000 - (Date.now() - this.rateLimitState.lastReset)),
    };
  }

  getCircuitBreakerState(): string {
    return this.circuitState;
  }

  resetCircuitBreaker(): void {
    this.circuitState = "closed";
    this.consecutiveFailures = 0;
  }

  // -------------------------------------------------------------------------
  // Token Address Helpers
  // -------------------------------------------------------------------------

  getUsdcAddress(): string {
    return USDC_ADDRESSES[this.chainId] || USDC_ADDRESSES[1]!;
  }

  getWrappedNative(): string {
    return WRAPPED_NATIVE[this.chainId] || WRAPPED_NATIVE[1]!;
  }

  /**
   * Check if a token address is the native token (ETH/MATIC/etc.)
   */
  isNativeToken(token: string): boolean {
    return token.toLowerCase() === NATIVE_TOKEN.toLowerCase();
  }

  /**
   * Parse a Gordon symbol (e.g. "UNIUSDC", "LINKETH") into token addresses + decimals.
   *
   * Resolution flow:
   * 1. Parse quote asset (trailing USDC/USDT/ETH/WETH) — hardcoded, these never change
   * 2. Parse base asset — look up in Uniswap token list (fetched lazily, cached 24h)
   * 3. Falls back to hardcoded addresses if token list is unavailable
   * 4. Supports raw address pairs: "0xABC.../0xDEF..."
   */
  async resolveSymbol(symbol: string): Promise<{ tokenIn: string; tokenOut: string; tokenInDecimals: number; tokenOutDecimals: number }> {
    const s = symbol.toUpperCase().replace(/[_\-/]/g, "");

    // Raw address pair (e.g., "0xABC/0xDEF") — look up decimals from token list
    if (s.startsWith("0X") && s.includes("0X", 3)) {
      const parts = symbol.split(/[_\-/]/);
      if (parts.length === 2) {
        const inToken = await this.tokenList.getTokenByAddress(parts[0]!);
        const outToken = await this.tokenList.getTokenByAddress(parts[1]!);
        return {
          tokenIn: parts[0]!,
          tokenOut: parts[1]!,
          tokenInDecimals: inToken?.decimals ?? 18,
          tokenOutDecimals: outToken?.decimals ?? 18,
        };
      }
    }

    // Detect quote asset from trailing pattern
    // decimals: USDC/USDT = 6, ETH/WETH = 18
    const quotePatterns: [RegExp, string, () => string, number][] = [
      [/USDC$/, "USDC", () => this.getUsdcAddress(), 6],
      [/USDT$/, "USDT", () => this.getUsdcAddress(), 6], // map USDT → USDC for DEX
      [/ETH$/, "ETH", () => this.getWrappedNative(), 18],
      [/WETH$/, "WETH", () => this.getWrappedNative(), 18],
    ];

    for (const [pattern, _quoteName, getQuoteAddress, quoteDecimals] of quotePatterns) {
      if (pattern.test(s)) {
        const base = s.replace(pattern, "");
        if (!base) continue; // e.g., just "USDC" with no base

        // Well-known base assets (hardcoded, no lookup needed)
        if (base === "ETH" || base === "WETH") {
          return {
            tokenIn: this.getWrappedNative(),
            tokenOut: getQuoteAddress(),
            tokenInDecimals: 18,
            tokenOutDecimals: quoteDecimals,
          };
        }

        // Look up base asset in token list (gets address + decimals)
        const baseToken = await this.tokenList.getToken(base, this.chainId);
        if (baseToken) {
          return {
            tokenIn: baseToken.address,
            tokenOut: getQuoteAddress(),
            tokenInDecimals: baseToken.decimals,
            tokenOutDecimals: quoteDecimals,
          };
        }

        // Token list doesn't have it — throw descriptive error
        throw new Error(
          `Unknown token "${base}" — not found in Uniswap token list for chain ${this.chainId}. ` +
          `Use a token address directly (e.g., "0x1234.../0xABCD...").`
        );
      }
    }

    throw new Error(
      `Cannot resolve symbol "${symbol}" to token addresses. ` +
      `Use a supported pair like "UNIUSDC", "LINKETH", or raw addresses "0xABC.../0xDEF...".`
    );
  }

  // -------------------------------------------------------------------------
  // API Requests
  // -------------------------------------------------------------------------

  /**
   * Make a POST request with retry + exponential backoff for 429/500/503
   */
  private async request<T>(
    path: string,
    body: unknown,
    extraHeaders?: Record<string, string>,
  ): Promise<T> {
    this.checkRateLimit();
    this.rateLimitState.requestCount++;

    const url = `${BASE_URL}${path}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "x-api-key": this.apiKey,
      "x-universal-router-version": "2.0",
      ...extraHeaders,
    };

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        const delay = BASE_DELAY_MS * 2 ** (attempt - 1);
        await new Promise((r) => setTimeout(r, delay));
      }

      try {
        const res = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        });

        if (res.ok) {
          this.consecutiveFailures = 0;
          if (this.circuitState === "half-open") this.circuitState = "closed";
          return res.json() as Promise<T>;
        }

        const errorBody = await res.text().catch(() => "");

        // Retry on 429 (rate limit), 500, 503
        if ([429, 500, 503].includes(res.status) && attempt < MAX_RETRIES) {
          if (res.status === 429) this.rateLimitState.throttledCount++;
          lastError = new Error(`Uniswap API error ${res.status}: ${errorBody}`);
          continue;
        }

        // Non-retryable error
        this.consecutiveFailures++;
        if (this.consecutiveFailures >= 5) this.circuitState = "open";
        throw new Error(`Uniswap API error ${res.status}: ${errorBody}`);
      } catch (err) {
        if (err instanceof Error && err.message.startsWith("Uniswap API error")) {
          throw err; // Already formatted, don't wrap
        }
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt >= MAX_RETRIES) {
          this.consecutiveFailures++;
          if (this.consecutiveFailures >= 5) this.circuitState = "open";
          throw lastError;
        }
      }
    }

    throw lastError || new Error("Uniswap request failed");
  }

  // -------------------------------------------------------------------------
  // Trading API Endpoints
  // -------------------------------------------------------------------------

  /**
   * Test connection by making a small quote request
   */
  async testConnection(): Promise<boolean> {
    try {
      const weth = this.getWrappedNative();
      const usdc = this.getUsdcAddress();
      await this.getQuote(weth, usdc, "1000000000000000"); // 0.001 ETH
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get a quote from the Uniswap Trading API
   *
   * @param tokenIn - Input token address
   * @param tokenOut - Output token address
   * @param amount - Amount in wei (smallest unit, NOT ether)
   * @param options - Optional quote configuration
   */
  async getQuote(
    tokenIn: string,
    tokenOut: string,
    amount: string,
    options: UniswapQuoteOptions = {},
  ): Promise<UniswapQuoteResponse> {
    const tokenOutChainId = options.tokenOutChainId ?? this.chainId;
    const isCrossChain = tokenOutChainId !== this.chainId;

    const body: UniswapQuoteRequest = {
      type: options.type ?? "EXACT_INPUT",
      amount,
      tokenInChainId: this.chainId,
      tokenOutChainId,
      tokenIn,
      tokenOut,
      swapper: this.walletAddress,
      routingPreference: options.routingPreference ?? "BEST_PRICE",
    };

    // Slippage: use caller's value, or 'DEFAULT' auto-slippage
    if (options.slippageTolerance) {
      body.slippageTolerance = options.slippageTolerance;
    } else {
      body.autoSlippage = "DEFAULT";
    }

    // Permit2 flow — request permit data with the quote
    if (options.permitAmount) {
      body.permitAmount = options.permitAmount;
    }

    // Cross-chain swaps require a special header
    const extraHeaders = isCrossChain
      ? { "x-chained-actions-enabled": "true" }
      : undefined;

    return this.request<UniswapQuoteResponse>("/quote", body, extraHeaders);
  }

  /**
   * Build an unsigned swap transaction from a quote.
   *
   * IMPORTANT (per docs): `signature` and `permitData` must either both be
   * present or both be omitted. Never send one without the other.
   *
   * @param quote - Quote response from getQuote
   * @param permit - Optional Permit2 signature + data (both required together)
   * @param deadline - Unix timestamp deadline (default: 30s from now)
   */
  async getSwapTransaction(
    quote: UniswapQuoteResponse,
    permit?: { signature: string; permitData: NonNullable<UniswapQuoteResponse["permitData"]> },
    deadline?: number,
  ): Promise<UniswapSwapResponse> {
    const body: Record<string, unknown> = {
      quote: quote.quote,
      refreshGasPrice: true,
      deadline: deadline ?? Math.floor(Date.now() / 1000) + 120, // 2 min default
    };

    // Both must be present or both omitted — never partial
    if (permit) {
      body.signature = permit.signature;
      body.permitData = permit.permitData;
    }

    const resp = await this.request<UniswapSwapResponse>("/swap", body);

    // Apply gas buffer (15%) per docs recommendation
    if (resp.swap.gasLimit) {
      const buffered = Math.ceil(Number(resp.swap.gasLimit) * (1 + GAS_BUFFER_PERCENT));
      resp.swap.gasLimit = buffered.toString();
    }

    return resp;
  }

  /**
   * Check if a token approval is needed before swapping.
   * Native tokens never need approval.
   *
   * @returns null if no approval needed, otherwise the approval transaction
   */
  async checkApproval(
    token: string,
    amount: string,
  ): Promise<UniswapApprovalResponse> {
    // Native tokens don't need approval
    if (this.isNativeToken(token)) {
      return { approval: null };
    }

    return this.request<UniswapApprovalResponse>("/check_approval", {
      walletAddress: this.walletAddress,
      token,
      amount,
      chainId: this.chainId,
      includeGasInfo: true,
    });
  }

  /**
   * Validate a swap transaction's data field before broadcasting.
   * Per docs: empty data causes on-chain reverts.
   */
  static validateSwapTransaction(data: string | undefined): boolean {
    if (!data || data === "" || data === "0x") return false;
    return /^0x[0-9a-fA-F]+$/.test(data);
  }

  /**
   * Check if a quote is still fresh (< 30s old).
   * Stale quotes should be refreshed before broadcasting.
   */
  static isQuoteFresh(quoteTimestamp: number): boolean {
    return Date.now() - quoteTimestamp < QUOTE_MAX_AGE_MS;
  }
}
