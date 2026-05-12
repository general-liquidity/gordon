/**
 * Market Context Protocol — Trading Equivalent of LSP
 *
 * Like LSP provides "hover → type info" and "go-to-definition" for code,
 * this module provides "hover → live quote + position + P&L" and
 * "trace order → fills → P&L chain" for trading symbols.
 *
 * Used by the TUI to show contextual information when the user or agent
 * references a symbol, order ID, or position.
 */

// ============================================================================
// Types
// ============================================================================

export interface SymbolContext {
  symbol: string;
  /** Last known price. */
  price?: number;
  /** 24h change percentage. */
  change24hPct?: number;
  /** Current bid/ask spread. */
  spread?: { bid: number; ask: number };
  /** User's open position on this symbol (if any). */
  position?: {
    side: "long" | "short";
    quantity: number;
    entryPrice: number;
    unrealizedPnl: number;
    unrealizedPnlPct: number;
  };
  /** Open orders on this symbol. */
  openOrders?: Array<{
    orderId: string;
    side: "BUY" | "SELL";
    type: string;
    quantity: number;
    price?: number;
    status: string;
  }>;
  /** Recent fills. */
  recentFills?: Array<{
    orderId: string;
    side: "BUY" | "SELL";
    quantity: number;
    price: number;
    timestamp: string;
    feesUsd: number;
  }>;
  /** Venue this symbol is traded on. */
  venue?: string;
  /** Asset type. */
  assetType?: "crypto" | "stock" | "option" | "future";
  /** When this context was fetched. */
  fetchedAt: string;
}

export interface OrderContext {
  orderId: string;
  symbol: string;
  side: "BUY" | "SELL";
  type: string;
  status: string;
  quantity: number;
  filledQuantity: number;
  price?: number;
  avgFillPrice?: number;
  createdAt: string;
  updatedAt?: string;
  /** Chain: order → fills → resulting position → P&L. */
  chain: {
    fills: Array<{
      fillId: string;
      quantity: number;
      price: number;
      timestamp: string;
      feesUsd: number;
    }>;
    resultingPosition?: {
      side: "long" | "short";
      quantity: number;
      avgPrice: number;
    };
    realizedPnl?: number;
  };
  venue: string;
}

// ============================================================================
// Context Providers (interfaces for adapters to implement)
// ============================================================================

export interface MarketContextProvider {
  /** Get context for a symbol (hover info). */
  getSymbolContext(symbol: string): Promise<SymbolContext | null>;
  /** Get context for an order (trace chain). */
  getOrderContext(orderId: string): Promise<OrderContext | null>;
  /** List all symbols the user has positions in. */
  getActiveSymbols(): Promise<string[]>;
}

// ============================================================================
// Context Cache
// ============================================================================

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

export class MarketContextCache {
  private symbolCache = new Map<string, CacheEntry<SymbolContext>>();
  private orderCache = new Map<string, CacheEntry<OrderContext>>();
  private provider: MarketContextProvider | null = null;
  private cacheTtlMs: number;

  constructor(cacheTtlMs: number = 5_000) {
    this.cacheTtlMs = cacheTtlMs;
  }

  setProvider(provider: MarketContextProvider): void {
    this.provider = provider;
  }

  async getSymbolContext(symbol: string): Promise<SymbolContext | null> {
    const normalized = symbol.toUpperCase();

    // Check cache
    const cached = this.symbolCache.get(normalized);
    if (cached && cached.expiresAt > Date.now()) return cached.data;

    // Fetch from provider
    if (!this.provider) return null;
    const ctx = await this.provider.getSymbolContext(normalized);
    if (ctx) {
      this.symbolCache.set(normalized, { data: ctx, expiresAt: Date.now() + this.cacheTtlMs });
    }
    return ctx;
  }

  async getOrderContext(orderId: string): Promise<OrderContext | null> {
    const cached = this.orderCache.get(orderId);
    if (cached && cached.expiresAt > Date.now()) return cached.data;

    if (!this.provider) return null;
    const ctx = await this.provider.getOrderContext(orderId);
    if (ctx) {
      this.orderCache.set(orderId, { data: ctx, expiresAt: Date.now() + this.cacheTtlMs });
    }
    return ctx;
  }

  /** Invalidate all cache entries for a symbol (e.g., after a trade). */
  invalidateSymbol(symbol: string): void {
    this.symbolCache.delete(symbol.toUpperCase());
  }

  /** Invalidate all caches. */
  invalidateAll(): void {
    this.symbolCache.clear();
    this.orderCache.clear();
  }
}

// ── Singleton ──

let instance: MarketContextCache | null = null;

export function getMarketContext(): MarketContextCache {
  if (!instance) instance = new MarketContextCache();
  return instance;
}

/**
 * Format a symbol context as a compact hover tooltip string.
 */
export function formatSymbolHover(ctx: SymbolContext): string {
  const lines: string[] = [];
  lines.push(`${ctx.symbol} ${ctx.venue ? `(${ctx.venue})` : ""}`);

  if (ctx.price !== undefined) {
    const changeStr = ctx.change24hPct !== undefined
      ? ` (${ctx.change24hPct >= 0 ? "+" : ""}${ctx.change24hPct.toFixed(2)}%)`
      : "";
    lines.push(`  Price: $${ctx.price.toLocaleString()}${changeStr}`);
  }

  if (ctx.spread) {
    const spreadBps = ((ctx.spread.ask - ctx.spread.bid) / ctx.spread.bid * 10000).toFixed(1);
    lines.push(`  Spread: $${ctx.spread.bid} / $${ctx.spread.ask} (${spreadBps}bps)`);
  }

  if (ctx.position) {
    const { side, quantity, entryPrice, unrealizedPnl, unrealizedPnlPct } = ctx.position;
    const pnlSign = unrealizedPnl >= 0 ? "+" : "";
    lines.push(`  Position: ${side} ${quantity} @ $${entryPrice.toFixed(2)} | P&L: ${pnlSign}$${unrealizedPnl.toFixed(2)} (${pnlSign}${unrealizedPnlPct.toFixed(1)}%)`);
  }

  if (ctx.openOrders?.length) {
    lines.push(`  Open orders: ${ctx.openOrders.length}`);
    for (const o of ctx.openOrders.slice(0, 3)) {
      lines.push(`    ${o.side} ${o.quantity} ${o.type}${o.price ? ` @ $${o.price}` : ""}`);
    }
  }

  return lines.join("\n");
}
