/**
 * Uniswap V3 Subgraph Client
 * Queries The Graph's decentralized gateway for Uniswap V3 market data.
 *
 * Provides the data layer that the Trading API doesn't offer:
 *   - Historical candles (pool OHLC from poolDayData / poolHourData)
 *   - 24hr tickers (token volume, price change)
 *   - Swap history (on-chain trade records)
 *   - Pool analytics (TVL, liquidity, fee tier)
 *   - Top tokens by volume
 *
 * Requires:
 * - THEGRAPH_API_KEY: Free tier at https://thegraph.com/studio/
 * - UniswapClient instance for symbol → token address resolution
 */

import { Cache } from "../cache/cache.ts";
import { UniswapClient } from "./client.ts";
import {
  V3_SUBGRAPH_IDS,
  type SubgraphResponse,
  type SubgraphPool,
  type SubgraphPoolDayData,
  type SubgraphPoolHourData,
  type SubgraphSwap,
  type SubgraphTokenWithDayData,
  type SubgraphTick,
  type SubgraphTokenHourData,
  type SubgraphMint,
  type SubgraphBurn,
  type SubgraphCollect,
  type SubgraphFlash,
  type SubgraphPosition,
  type SubgraphPositionSnapshot,
  type SubgraphUniswapDayData,
  type SubgraphFactory,
  type ResolvedPool,
  type PoolsQueryResult,
  type PoolQueryResult,
  type PoolDayDatasResult,
  type PoolHourDatasResult,
  type SwapsResult,
  type TokensResult,
  type BundleResult,
  type FactoryResult,
  type TicksResult,
  type TokenHourDatasResult,
  type MintsResult,
  type BurnsResult,
  type CollectsResult,
  type FlashesResult,
  type PositionsResult,
  type PositionSnapshotsResult,
  type UniswapDayDatasResult,
} from "./subgraph-types.ts";
import type { Candle } from "../../types/index.ts";
import type {
  Ticker24hr,
  Trade,
  OrderBook,
  OrderBookEntry,
  BookTicker,
  SpreadInfo,
  AvgPrice,
} from "../exchange/types.ts";

// Gateway URL
const GRAPH_GATEWAY = "https://gateway.thegraph.com/api";

// Retry (matches UniswapClient pattern)
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 500;

// Rate limiting — conservative for free tier (~1000 queries/day)
const RATE_LIMIT = { maxPerMinute: 30, throttleAt: 25 };

// Circuit breaker
const CIRCUIT_FAILURE_THRESHOLD = 5;
const CIRCUIT_RESET_MS = 60_000;

// Cache TTLs
const CACHE_TTL = {
  pool: 30 * 60_000,   // 30 min — pool addresses don't change
  candles: 5 * 60_000, // 5 min
  tickers: 2 * 60_000, // 2 min
  top: 5 * 60_000,     // 5 min
  trades: 60_000,       // 1 min
  poolData: 60_000,     // 1 min
  bundle: 60_000,       // 1 min — ETH price
  ticks: 60_000,        // 1 min — tick liquidity
  events: 60_000,       // 1 min — mints, burns, collects, flashes
  positions: 5 * 60_000, // 5 min — LP positions
  protocol: 5 * 60_000,  // 5 min — protocol-wide stats
};

// Stablecoins to filter from top-tokens results
const STABLECOIN_SYMBOLS = new Set(["USDC", "USDT", "DAI", "BUSD", "TUSD", "FRAX", "LUSD", "USDP", "GUSD", "PYUSD"]);

/**
 * Uniswap V3 Subgraph Client
 */
export class UniswapSubgraph {
  private apiKey: string;
  private chainId: number;
  private client: UniswapClient;
  private endpointUrl: string | null;

  // Caches
  private poolCache = new Cache<ResolvedPool>({ defaultTtl: CACHE_TTL.pool, maxEntries: 100 });
  private dataCache = new Cache<unknown>({ defaultTtl: CACHE_TTL.candles, maxEntries: 500 });

  // Rate limiting
  private requestCount = 0;
  private lastResetTime = Date.now();
  private throttledCount = 0;

  // Circuit breaker
  private circuitState: "closed" | "open" | "half-open" = "closed";
  private consecutiveFailures = 0;
  private circuitOpenedAt = 0;

  constructor(apiKey: string, chainId: number, client: UniswapClient) {
    this.apiKey = apiKey;
    this.chainId = chainId;
    this.client = client;

    const subgraphId = V3_SUBGRAPH_IDS[chainId];
    this.endpointUrl = subgraphId
      ? `${GRAPH_GATEWAY}/subgraphs/id/${subgraphId}`
      : null;
  }

  // -------------------------------------------------------------------------
  // Availability
  // -------------------------------------------------------------------------

  isAvailable(): boolean {
    if (!this.endpointUrl) return false;
    if (this.circuitState === "open") {
      // Check if reset window has passed
      if (Date.now() - this.circuitOpenedAt > CIRCUIT_RESET_MS) {
        this.circuitState = "half-open";
        return true;
      }
      return false;
    }
    return true;
  }

  // -------------------------------------------------------------------------
  // Core Query Method
  // -------------------------------------------------------------------------

  private async checkRateLimit(): Promise<void> {
    const now = Date.now();
    if (now - this.lastResetTime > 60_000) {
      this.requestCount = 0;
      this.lastResetTime = now;
      this.throttledCount = 0;
    }

    if (this.requestCount >= RATE_LIMIT.maxPerMinute) {
      const waitMs = 60_000 - (now - this.lastResetTime);
      throw new Error(`Subgraph rate limit reached (${RATE_LIMIT.maxPerMinute}/min). Retry in ${Math.ceil(waitMs / 1000)}s.`);
    }

    if (this.requestCount >= RATE_LIMIT.throttleAt) {
      const delayMs = 500 * (this.requestCount - RATE_LIMIT.throttleAt + 1);
      await new Promise((r) => setTimeout(r, delayMs));
      this.throttledCount++;
    }
  }

  private async query<T>(graphql: string, variables: Record<string, unknown> = {}): Promise<T> {
    if (!this.endpointUrl) {
      throw new Error(`No V3 subgraph available for chain ${this.chainId}`);
    }

    if (this.circuitState === "open" && !this.isAvailable()) {
      throw new Error("Subgraph circuit breaker is open");
    }

    await this.checkRateLimit();
    this.requestCount++;

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        const delay = BASE_DELAY_MS * 2 ** (attempt - 1);
        await new Promise((r) => setTimeout(r, delay));
      }

      try {
        // Construct authenticated URL ephemerally to avoid storing API key in a field
        const url = `${GRAPH_GATEWAY}/${this.apiKey}${this.endpointUrl}`;
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: graphql, variables }),
        });

        if (res.ok) {
          const json = (await res.json()) as SubgraphResponse<T>;
          if (json.errors?.length) {
            throw new Error(`Subgraph error: ${json.errors.map((e) => e.message).join("; ")}`);
          }
          this.consecutiveFailures = 0;
          if (this.circuitState === "half-open") this.circuitState = "closed";
          return json.data;
        }

        const errBody = await res.text().catch(() => "");

        if ([429, 500, 503].includes(res.status) && attempt < MAX_RETRIES) {
          if (res.status === 429) this.throttledCount++;
          lastError = new Error(`Subgraph HTTP ${res.status}: ${errBody}`);
          continue;
        }

        this.onFailure();
        throw new Error(`Subgraph HTTP ${res.status}: ${errBody}`);
      } catch (err) {
        if (err instanceof Error && err.message.startsWith("Subgraph")) throw err;
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt >= MAX_RETRIES) {
          this.onFailure();
          throw lastError;
        }
      }
    }

    throw lastError || new Error("Subgraph request failed");
  }

  private onFailure(): void {
    this.consecutiveFailures++;
    if (this.consecutiveFailures >= CIRCUIT_FAILURE_THRESHOLD) {
      this.circuitState = "open";
      this.circuitOpenedAt = Date.now();
    }
  }

  // -------------------------------------------------------------------------
  // Pool Resolution
  // -------------------------------------------------------------------------

  async resolvePool(symbol: string): Promise<ResolvedPool> {
    const cacheKey = `pool:${this.chainId}:${symbol}`;
    const cached = this.poolCache.get(cacheKey);
    if (cached) return cached;

    const { tokenIn, tokenOut } = await this.client.resolveSymbol(symbol);

    // Subgraph convention: token0 < token1 (sorted by lowercase address)
    const inLower = tokenIn.toLowerCase();
    const outLower = tokenOut.toLowerCase();
    const [t0, t1] = inLower < outLower ? [inLower, outLower] : [outLower, inLower];
    const isInverted = inLower !== t0; // tokenIn ended up as token1

    const data = await this.query<PoolsQueryResult>(
      `query($t0: String!, $t1: String!) {
        pools(
          first: 1
          where: { token0: $t0, token1: $t1 }
          orderBy: liquidity
          orderDirection: desc
        ) {
          id feeTier liquidity sqrtPrice tick
          token0Price token1Price
          totalValueLockedUSD volumeUSD
          token0 { id symbol name decimals }
          token1 { id symbol name decimals }
        }
      }`,
      { t0, t1 },
    );

    if (!data.pools.length) {
      throw new Error(`No Uniswap V3 pool found for ${symbol} on chain ${this.chainId}`);
    }

    const resolved: ResolvedPool = { pool: data.pools[0]!, isInverted };
    this.poolCache.set(cacheKey, resolved, CACHE_TTL.pool);
    return resolved;
  }

  /**
   * Get the current price from the pool's token0Price/token1Price.
   * Accounts for inversion.
   */
  private getPoolPrice(pool: SubgraphPool, isInverted: boolean): number {
    // token0Price = "how many token1 per 1 token0"
    // If tokenIn is token0: price = token0Price (how much tokenOut per tokenIn)
    // If tokenIn is token1 (inverted): price = token1Price
    return isInverted
      ? parseFloat(pool.token1Price)
      : parseFloat(pool.token0Price);
  }

  // -------------------------------------------------------------------------
  // Candles
  // -------------------------------------------------------------------------

  async getCandles(symbol: string, interval: string, limit: number): Promise<Candle[]> {
    const { pool, isInverted } = await this.resolvePool(symbol);
    const useHourly = ["1m", "5m", "15m", "30m", "1h", "4h"].includes(interval);
    const intervalSeconds = useHourly ? 3600 : 86400;
    const start = Math.floor(Date.now() / 1000) - limit * intervalSeconds;

    const cacheKey = `candle:${this.chainId}:${pool.id}:${interval}:${limit}`;
    const cached = this.dataCache.get(cacheKey) as Candle[] | undefined;
    if (cached) return cached;

    let candles: Candle[];

    if (useHourly) {
      const data = await this.query<PoolHourDatasResult>(
        `query($pool: String!, $start: Int!, $first: Int!) {
          poolHourDatas(
            first: $first
            where: { pool: $pool, periodStartUnix_gte: $start }
            orderBy: periodStartUnix
            orderDirection: asc
          ) {
            periodStartUnix open high low close
            volumeUSD volumeToken0 volumeToken1 tvlUSD
            token0Price token1Price
          }
        }`,
        { pool: pool.id, start, first: Math.min(limit, 1000) },
      );
      candles = data.poolHourDatas.map((d) => this.mapCandle(d.periodStartUnix, intervalSeconds, d, isInverted));
    } else {
      const data = await this.query<PoolDayDatasResult>(
        `query($pool: String!, $start: Int!, $first: Int!) {
          poolDayDatas(
            first: $first
            where: { pool: $pool, date_gte: $start }
            orderBy: date
            orderDirection: asc
          ) {
            date open high low close
            volumeUSD volumeToken0 volumeToken1 tvlUSD
            token0Price token1Price
          }
        }`,
        { pool: pool.id, start, first: Math.min(limit, 1000) },
      );
      candles = data.poolDayDatas.map((d) => this.mapCandle(d.date, intervalSeconds, d, isInverted));
    }

    this.dataCache.set(cacheKey, candles, CACHE_TTL.candles);
    return candles;
  }

  private mapCandle(
    timestamp: number,
    intervalSec: number,
    d: { open: string; high: string; low: string; close: string; volumeUSD: string; token0Price: string; token1Price: string },
    isInverted: boolean,
  ): Candle {
    let open = parseFloat(d.open);
    let high = parseFloat(d.high);
    let low = parseFloat(d.low);
    let close = parseFloat(d.close);

    // If OHLC fields are 0 (some subgraph deployments don't populate them),
    // fall back to token0Price/token1Price as a flat candle
    if (open === 0 && close === 0) {
      const price = isInverted ? parseFloat(d.token1Price) : parseFloat(d.token0Price);
      open = high = low = close = price;
    } else if (isInverted && open !== 0 && high !== 0 && low !== 0 && close !== 0) {
      // Invert OHLC: high becomes 1/low, low becomes 1/high
      const iOpen = 1 / open;
      const iHigh = 1 / low;   // original low → inverted high
      const iLow = 1 / high;   // original high → inverted low
      const iClose = 1 / close;
      open = iOpen;
      high = iHigh;
      low = iLow;
      close = iClose;
    } else if (isInverted) {
      // Some OHLC values are zero — fall back to token price as flat candle
      const price = parseFloat(d.token1Price);
      if (price !== 0) {
        open = high = low = close = price;
      }
    }

    return {
      openTime: timestamp * 1000,
      open,
      high,
      low,
      close,
      volume: parseFloat(d.volumeUSD),
      closeTime: (timestamp + intervalSec) * 1000 - 1,
    };
  }

  // -------------------------------------------------------------------------
  // 24hr Tickers
  // -------------------------------------------------------------------------

  async get24hrTickers(limit = 100): Promise<Ticker24hr[]> {
    const cacheKey = `tickers:${this.chainId}:${limit}`;
    const cached = this.dataCache.get(cacheKey) as Ticker24hr[] | undefined;
    if (cached) return cached;

    // Fetch extra to account for stablecoin filtering
    const fetchLimit = Math.min(limit + 15, 200);

    const data = await this.query<TokensResult>(
      `query($first: Int!) {
        tokens(
          first: $first
          orderBy: volumeUSD
          orderDirection: desc
          where: { volumeUSD_gt: "1000" }
        ) {
          id symbol name
          volumeUSD totalValueLockedUSD
          tokenDayDatas(first: 2, orderBy: date, orderDirection: desc) {
            date priceUSD volumeUSD
            open high low close
          }
        }
      }`,
      { first: fetchLimit },
    );

    const now = Date.now();
    const tickers: Ticker24hr[] = [];

    for (const token of data.tokens) {
      if (STABLECOIN_SYMBOLS.has(token.symbol.toUpperCase())) continue;
      if (token.tokenDayDatas.length === 0) continue;

      const today = token.tokenDayDatas[0]!;
      const yesterday = token.tokenDayDatas[1];
      const todayPrice = parseFloat(today.priceUSD);
      const yesterdayPrice = yesterday ? parseFloat(yesterday.priceUSD) : todayPrice;
      const priceChange = todayPrice - yesterdayPrice;
      const priceChangePercent = yesterdayPrice !== 0
        ? (priceChange / yesterdayPrice) * 100
        : 0;

      const highPrice = parseFloat(today.high) || todayPrice;
      const lowPrice = parseFloat(today.low) || todayPrice;

      tickers.push({
        symbol: `${token.symbol.toUpperCase()}USDC`,
        priceChange,
        priceChangePercent,
        lastPrice: todayPrice,
        highPrice,
        lowPrice,
        volume: parseFloat(today.volumeUSD),
        quoteVolume: parseFloat(today.volumeUSD),
        openTime: today.date * 1000,
        closeTime: now,
      });

      if (tickers.length >= limit) break;
    }

    this.dataCache.set(cacheKey, tickers, CACHE_TTL.tickers);
    return tickers;
  }

  // -------------------------------------------------------------------------
  // Top Symbols
  // -------------------------------------------------------------------------

  async getTopSymbols(n: number): Promise<string[]> {
    const cacheKey = `top:${this.chainId}:${n}`;
    const cached = this.dataCache.get(cacheKey) as string[] | undefined;
    if (cached) return cached;

    const fetchN = Math.min(n + 10, 100); // extra for stablecoin filtering

    const data = await this.query<TokensResult>(
      `query($first: Int!) {
        tokens(
          first: $first
          orderBy: volumeUSD
          orderDirection: desc
          where: { volumeUSD_gt: "1000" }
        ) {
          id symbol
        }
      }`,
      { first: fetchN },
    );

    const symbols: string[] = [];
    for (const token of data.tokens) {
      const sym = token.symbol.toUpperCase();
      if (STABLECOIN_SYMBOLS.has(sym)) continue;
      // Skip wrapped natives — they'd produce "WETHUSDC" which is redundant with "ETHUSDC"
      if (sym === "WETH" || sym === "WBTC") {
        symbols.push(`${sym.slice(1)}USDC`); // Remove "W" prefix
      } else {
        symbols.push(`${sym}USDC`);
      }
      if (symbols.length >= n) break;
    }

    this.dataCache.set(cacheKey, symbols, CACHE_TTL.top);
    return symbols;
  }

  // -------------------------------------------------------------------------
  // Trade History
  // -------------------------------------------------------------------------

  async getTradeHistory(symbol: string, limit: number): Promise<Trade[]> {
    const { pool, isInverted } = await this.resolvePool(symbol);
    const cacheKey = `trades:${this.chainId}:${pool.id}:${limit}`;
    const cached = this.dataCache.get(cacheKey) as Trade[] | undefined;
    if (cached) return cached;

    const data = await this.query<SwapsResult>(
      `query($pool: String!, $first: Int!) {
        swaps(
          first: $first
          where: { pool: $pool }
          orderBy: timestamp
          orderDirection: desc
        ) {
          id timestamp
          amount0 amount1 amountUSD
          sender recipient
          sqrtPriceX96 tick
        }
      }`,
      { pool: pool.id, first: Math.min(limit, 1000) },
    );

    const trades: Trade[] = data.swaps.map((swap) => {
      const amount0 = parseFloat(swap.amount0);
      const amount1 = parseFloat(swap.amount1);
      const amountUSD = parseFloat(swap.amountUSD);

      // Determine side relative to the base token (tokenIn)
      // In the subgraph, positive amount0 = token0 flowed into the pool (sold)
      // If not inverted: tokenIn = token0, so positive amount0 = SELL
      // If inverted: tokenIn = token1, so positive amount1 = SELL
      const baseAmount = isInverted ? amount1 : amount0;
      const side = baseAmount > 0 ? "SELL" : "BUY";
      const quantity = Math.abs(baseAmount);
      // Derive price from amountUSD; fall back to pool price if USD tracking unavailable
      const price = (amountUSD > 0 && quantity > 0)
        ? amountUSD / quantity
        : quantity > 0 ? this.getPoolPrice(pool, isInverted) : 0;

      return {
        id: swap.id,
        orderId: swap.id,
        symbol,
        side: side as "BUY" | "SELL",
        price,
        quantity,
        commission: 0, // fees built into swap
        commissionAsset: "USD",
        time: parseInt(swap.timestamp, 10) * 1000,
        isMaker: false, // AMM swaps are always taker
      };
    });

    this.dataCache.set(cacheKey, trades, CACHE_TTL.trades);
    return trades;
  }

  // -------------------------------------------------------------------------
  // Pool Data (for order book, spread, book ticker)
  // -------------------------------------------------------------------------

  async getPoolData(symbol: string): Promise<{
    price: number;
    feeTier: number;
    tvlUSD: number;
    liquidity: string;
  }> {
    const { pool, isInverted } = await this.resolvePool(symbol);
    const cacheKey = `poolData:${this.chainId}:${pool.id}`;
    const cached = this.dataCache.get(cacheKey) as { price: number; feeTier: number; tvlUSD: number; liquidity: string } | undefined;
    if (cached) return cached;

    // Fetch fresh pool data
    const data = await this.query<PoolQueryResult>(
      `query($id: ID!) {
        pool(id: $id) {
          id feeTier liquidity sqrtPrice tick
          token0Price token1Price
          totalValueLockedUSD volumeUSD
          token0 { id symbol name decimals }
          token1 { id symbol name decimals }
        }
      }`,
      { id: pool.id },
    );

    if (!data.pool) throw new Error(`Pool ${pool.id} not found`);

    const result = {
      price: this.getPoolPrice(data.pool, isInverted),
      feeTier: parseInt(data.pool.feeTier, 10),
      tvlUSD: parseFloat(data.pool.totalValueLockedUSD),
      liquidity: data.pool.liquidity,
    };

    this.dataCache.set(cacheKey, result, CACHE_TTL.poolData);
    return result;
  }

  async getOrderBook(symbol: string): Promise<OrderBook> {
    const { pool, isInverted } = await this.resolvePool(symbol);
    const { price, feeTier, tvlUSD } = await this.getPoolData(symbol);
    const spreadFraction = feeTier / 1_000_000;
    const halfSpread = price * spreadFraction / 2;

    // Try tick-based order book first for real liquidity depth
    try {
      const ticks = await this.getTickLiquidity(symbol, 10);
      if (ticks.length > 0) {
        const freshPool = await this.getPoolData(symbol);
        const bids: OrderBookEntry[] = [];
        const asks: OrderBookEntry[] = [];

        for (const tick of ticks) {
          const tickIdx = parseInt(tick.tickIdx, 10);
          const liqNet = parseFloat(tick.liquidityNet);
          if (liqNet === 0) continue;

          const tickPrice = isInverted ? parseFloat(tick.price1) : parseFloat(tick.price0);
          // liquidityNet is raw V3 L — use as relative depth score
          const liquidityScore = Math.abs(liqNet);

          if (tickPrice <= freshPool.price) {
            bids.push({ price: tickPrice, quantity: liquidityScore } as OrderBookEntry);
          } else {
            asks.push({ price: tickPrice, quantity: liquidityScore } as OrderBookEntry);
          }
        }

        if (bids.length > 0 || asks.length > 0) {
          bids.sort((a, b) => b.price - a.price);
          asks.sort((a, b) => a.price - b.price);
          return { lastUpdateId: Date.now(), bids, asks };
        }
      }
    } catch {
      // Fall through to TVL proxy
    }

    // Fallback: TVL-based proxy
    const depthProxy = tvlUSD / 2;
    return {
      lastUpdateId: Date.now(),
      bids: [{ price: price - halfSpread, quantity: depthProxy / price } as OrderBookEntry],
      asks: [{ price: price + halfSpread, quantity: depthProxy / price } as OrderBookEntry],
    };
  }

  async getBookTicker(symbol: string): Promise<BookTicker> {
    const { price, feeTier, tvlUSD } = await this.getPoolData(symbol);
    const spreadFraction = feeTier / 1_000_000;
    const halfSpread = price * spreadFraction / 2;
    const depthProxy = tvlUSD / 2;

    return {
      symbol,
      bidPrice: price - halfSpread,
      bidQty: depthProxy / price,
      askPrice: price + halfSpread,
      askQty: depthProxy / price,
    };
  }

  async getSpread(symbol: string): Promise<SpreadInfo> {
    const { price, feeTier } = await this.getPoolData(symbol);
    const spreadFraction = feeTier / 1_000_000;
    const spread = price * spreadFraction;

    return {
      spread,
      spreadPercent: spreadFraction * 100,
      bidPrice: price - spread / 2,
      askPrice: price + spread / 2,
    };
  }

  async getAvgPrice(symbol: string): Promise<AvgPrice> {
    const { price } = await this.getPoolData(symbol);
    return { mins: 5, price };
  }

  // -------------------------------------------------------------------------
  // ETH Price (Bundle)
  // -------------------------------------------------------------------------

  async getEthPrice(): Promise<number> {
    const cacheKey = `bundle:${this.chainId}`;
    const cached = this.dataCache.get(cacheKey) as number | undefined;
    if (cached !== undefined) return cached;

    const data = await this.query<BundleResult>(
      `{ bundle(id: "1") { id ethPriceUSD } }`,
    );

    const price = data.bundle ? parseFloat(data.bundle.ethPriceUSD) : NaN;
    if (isNaN(price) || price <= 0) {
      throw new Error(`Unable to fetch ETH price from bundle on chain ${this.chainId}`);
    }
    this.dataCache.set(cacheKey, price, CACHE_TTL.bundle);
    return price;
  }

  // -------------------------------------------------------------------------
  // Factory (protocol-wide stats)
  // -------------------------------------------------------------------------

  async getFactory(): Promise<SubgraphFactory | null> {
    const cacheKey = `factory:${this.chainId}`;
    const cached = this.dataCache.get(cacheKey) as SubgraphFactory | null | undefined;
    if (cached !== undefined) return cached;

    const data = await this.query<FactoryResult>(
      `{ factory(id: "1") {
        id poolCount txCount
        totalVolumeUSD totalVolumeETH
        totalFeesUSD totalFeesETH
        totalValueLockedUSD totalValueLockedETH
        owner
      } }`,
    );

    this.dataCache.set(cacheKey, data.factory, CACHE_TTL.protocol);
    return data.factory;
  }

  // -------------------------------------------------------------------------
  // Token Hour Candles
  // -------------------------------------------------------------------------

  async getTokenHourCandles(tokenAddress: string, limit = 168): Promise<Candle[]> {
    const addr = tokenAddress.toLowerCase();
    const cacheKey = `tokenHour:${this.chainId}:${addr}:${limit}`;
    const cached = this.dataCache.get(cacheKey) as Candle[] | undefined;
    if (cached) return cached;

    const start = Math.floor(Date.now() / 1000) - limit * 3600;

    const data = await this.query<TokenHourDatasResult>(
      `query($token: String!, $start: Int!, $first: Int!) {
        tokenHourDatas(
          first: $first
          where: { token: $token, periodStartUnix_gte: $start }
          orderBy: periodStartUnix
          orderDirection: asc
        ) {
          periodStartUnix
          open high low close
          priceUSD volumeUSD feesUSD
          totalValueLockedUSD
          token { id }
        }
      }`,
      { token: addr, start, first: Math.min(limit, 1000) },
    );

    const candles: Candle[] = data.tokenHourDatas.map((d) => {
      const fallback = parseFloat(d.priceUSD);
      const openVal = parseFloat(d.open);
      const highVal = parseFloat(d.high);
      const lowVal = parseFloat(d.low);
      const closeVal = parseFloat(d.close);
      return {
        openTime: d.periodStartUnix * 1000,
        open: openVal > 0 ? openVal : fallback,
        high: highVal > 0 ? highVal : fallback,
        low: lowVal > 0 ? lowVal : fallback,
        close: closeVal > 0 ? closeVal : fallback,
        volume: parseFloat(d.volumeUSD),
        closeTime: (d.periodStartUnix + 3600) * 1000 - 1,
      };
    });

    this.dataCache.set(cacheKey, candles, CACHE_TTL.candles);
    return candles;
  }

  // -------------------------------------------------------------------------
  // Tick Liquidity (real order book depth)
  // -------------------------------------------------------------------------

  async getTickLiquidity(symbol: string, ticksPerSide = 20): Promise<SubgraphTick[]> {
    const { pool } = await this.resolvePool(symbol);

    // Fetch fresh tick from pool data (1-min cache) instead of 30-min pool cache
    const freshData = await this.query<PoolQueryResult>(
      `query($id: ID!) { pool(id: $id) { tick feeTier } }`,
      { id: pool.id },
    );
    const currentTick = parseInt(freshData.pool?.tick ?? pool.tick, 10);
    const feeTier = parseInt(freshData.pool?.feeTier ?? pool.feeTier, 10);

    // Tick spacing depends on fee tier
    const tickSpacing = feeTier === 100 ? 1 : feeTier === 500 ? 10 : feeTier === 3000 ? 60 : feeTier === 10000 ? 200 : 60;
    const tickRange = ticksPerSide * tickSpacing;

    const cacheKey = `ticks:${this.chainId}:${pool.id}:${currentTick}:${ticksPerSide}`;
    const cached = this.dataCache.get(cacheKey) as SubgraphTick[] | undefined;
    if (cached) return cached;

    const minTick = currentTick - tickRange;
    const maxTick = currentTick + tickRange;

    const data = await this.query<TicksResult>(
      `query($pool: String!, $minTick: BigInt!, $maxTick: BigInt!) {
        ticks(
          first: 100
          where: { pool: $pool, tickIdx_gte: $minTick, tickIdx_lte: $maxTick }
          orderBy: tickIdx
          orderDirection: asc
        ) {
          id tickIdx poolAddress
          liquidityGross liquidityNet
          price0 price1
          volumeToken0 volumeToken1 volumeUSD
          feesUSD
        }
      }`,
      { pool: pool.id, minTick: minTick.toString(), maxTick: maxTick.toString() },
    );

    this.dataCache.set(cacheKey, data.ticks, CACHE_TTL.ticks);
    return data.ticks;
  }

  // -------------------------------------------------------------------------
  // Mints (liquidity additions)
  // -------------------------------------------------------------------------

  async getMints(symbol: string, limit = 50): Promise<SubgraphMint[]> {
    const { pool } = await this.resolvePool(symbol);
    const cacheKey = `mints:${this.chainId}:${pool.id}:${limit}`;
    const cached = this.dataCache.get(cacheKey) as SubgraphMint[] | undefined;
    if (cached) return cached;

    const data = await this.query<MintsResult>(
      `query($pool: String!, $first: Int!) {
        mints(
          first: $first
          where: { pool: $pool }
          orderBy: timestamp
          orderDirection: desc
        ) {
          id timestamp
          transaction { id timestamp }
          pool { id }
          token0 { id symbol name decimals }
          token1 { id symbol name decimals }
          owner sender origin
          amount amount0 amount1 amountUSD
          tickLower tickUpper logIndex
        }
      }`,
      { pool: pool.id, first: Math.min(limit, 1000) },
    );

    this.dataCache.set(cacheKey, data.mints, CACHE_TTL.events);
    return data.mints;
  }

  // -------------------------------------------------------------------------
  // Burns (liquidity removals)
  // -------------------------------------------------------------------------

  async getBurns(symbol: string, limit = 50): Promise<SubgraphBurn[]> {
    const { pool } = await this.resolvePool(symbol);
    const cacheKey = `burns:${this.chainId}:${pool.id}:${limit}`;
    const cached = this.dataCache.get(cacheKey) as SubgraphBurn[] | undefined;
    if (cached) return cached;

    const data = await this.query<BurnsResult>(
      `query($pool: String!, $first: Int!) {
        burns(
          first: $first
          where: { pool: $pool }
          orderBy: timestamp
          orderDirection: desc
        ) {
          id timestamp
          transaction { id timestamp }
          pool { id }
          token0 { id symbol name decimals }
          token1 { id symbol name decimals }
          owner origin
          amount amount0 amount1 amountUSD
          tickLower tickUpper logIndex
        }
      }`,
      { pool: pool.id, first: Math.min(limit, 1000) },
    );

    this.dataCache.set(cacheKey, data.burns, CACHE_TTL.events);
    return data.burns;
  }

  // -------------------------------------------------------------------------
  // Collects (fee collection events)
  // -------------------------------------------------------------------------

  async getCollects(symbol: string, limit = 50): Promise<SubgraphCollect[]> {
    const { pool } = await this.resolvePool(symbol);
    const cacheKey = `collects:${this.chainId}:${pool.id}:${limit}`;
    const cached = this.dataCache.get(cacheKey) as SubgraphCollect[] | undefined;
    if (cached) return cached;

    const data = await this.query<CollectsResult>(
      `query($pool: String!, $first: Int!) {
        collects(
          first: $first
          where: { pool: $pool }
          orderBy: timestamp
          orderDirection: desc
        ) {
          id timestamp
          transaction { id timestamp }
          pool { id }
          owner
          amount0 amount1 amountUSD
          tickLower tickUpper logIndex
        }
      }`,
      { pool: pool.id, first: Math.min(limit, 1000) },
    );

    this.dataCache.set(cacheKey, data.collects, CACHE_TTL.events);
    return data.collects;
  }

  // -------------------------------------------------------------------------
  // Flash Loans
  // -------------------------------------------------------------------------

  async getFlashLoans(symbol: string, limit = 50): Promise<SubgraphFlash[]> {
    const { pool } = await this.resolvePool(symbol);
    const cacheKey = `flashes:${this.chainId}:${pool.id}:${limit}`;
    const cached = this.dataCache.get(cacheKey) as SubgraphFlash[] | undefined;
    if (cached) return cached;

    const data = await this.query<FlashesResult>(
      `query($pool: String!, $first: Int!) {
        flashes(
          first: $first
          where: { pool: $pool }
          orderBy: timestamp
          orderDirection: desc
        ) {
          id timestamp
          transaction { id timestamp }
          pool { id }
          sender recipient
          amount0 amount1 amountUSD
          amount0Paid amount1Paid
          logIndex
        }
      }`,
      { pool: pool.id, first: Math.min(limit, 1000) },
    );

    this.dataCache.set(cacheKey, data.flashes, CACHE_TTL.events);
    return data.flashes;
  }

  // -------------------------------------------------------------------------
  // LP Positions (by owner address)
  // -------------------------------------------------------------------------

  async getPositions(owner: string, limit = 50): Promise<SubgraphPosition[]> {
    const addr = owner.toLowerCase();
    const cacheKey = `positions:${this.chainId}:${addr}:${limit}`;
    const cached = this.dataCache.get(cacheKey) as SubgraphPosition[] | undefined;
    if (cached) return cached;

    const data = await this.query<PositionsResult>(
      `query($owner: String!, $first: Int!) {
        positions(
          first: $first
          where: { owner: $owner, liquidity_gt: "0" }
          orderBy: liquidity
          orderDirection: desc
        ) {
          id owner
          pool { id token0 { id symbol name decimals } token1 { id symbol name decimals } }
          token0 { id symbol name decimals }
          token1 { id symbol name decimals }
          tickLower { tickIdx price0 price1 }
          tickUpper { tickIdx price0 price1 }
          liquidity
          depositedToken0 depositedToken1
          withdrawnToken0 withdrawnToken1
          collectedFeesToken0 collectedFeesToken1
          transaction { id timestamp }
        }
      }`,
      { owner: addr, first: Math.min(limit, 1000) },
    );

    this.dataCache.set(cacheKey, data.positions, CACHE_TTL.positions);
    return data.positions;
  }

  // -------------------------------------------------------------------------
  // Position Snapshots (historical state of a position)
  // -------------------------------------------------------------------------

  async getPositionSnapshots(positionId: string, limit = 50): Promise<SubgraphPositionSnapshot[]> {
    const cacheKey = `snapshots:${this.chainId}:${positionId}:${limit}`;
    const cached = this.dataCache.get(cacheKey) as SubgraphPositionSnapshot[] | undefined;
    if (cached) return cached;

    const data = await this.query<PositionSnapshotsResult>(
      `query($position: String!, $first: Int!) {
        positionSnapshots(
          first: $first
          where: { position: $position }
          orderBy: timestamp
          orderDirection: desc
        ) {
          id owner
          pool { id }
          position { id }
          blockNumber timestamp
          liquidity
          depositedToken0 depositedToken1
          withdrawnToken0 withdrawnToken1
          collectedFeesToken0 collectedFeesToken1
          transaction { id }
        }
      }`,
      { position: positionId, first: Math.min(limit, 1000) },
    );

    this.dataCache.set(cacheKey, data.positionSnapshots, CACHE_TTL.positions);
    return data.positionSnapshots;
  }

  // -------------------------------------------------------------------------
  // Protocol Day Data (Uniswap-wide daily metrics)
  // -------------------------------------------------------------------------

  async getProtocolDayData(days = 30): Promise<SubgraphUniswapDayData[]> {
    const cacheKey = `protocol:${this.chainId}:${days}`;
    const cached = this.dataCache.get(cacheKey) as SubgraphUniswapDayData[] | undefined;
    if (cached) return cached;

    const start = Math.floor(Date.now() / 1000) - days * 86400;

    const data = await this.query<UniswapDayDatasResult>(
      `query($start: Int!, $first: Int!) {
        uniswapDayDatas(
          first: $first
          where: { date_gte: $start }
          orderBy: date
          orderDirection: asc
        ) {
          id date
          volumeETH volumeUSD
          feesUSD txCount tvlUSD
        }
      }`,
      { start, first: Math.min(days, 1000) },
    );

    this.dataCache.set(cacheKey, data.uniswapDayDatas, CACHE_TTL.protocol);
    return data.uniswapDayDatas;
  }
}
