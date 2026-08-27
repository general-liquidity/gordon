/**
 * Strategy Sandbox — Isolated Parallel Strategy Variants
 *
 * Trading equivalent of git worktrees. Run multiple strategy variants
 * in paper mode simultaneously, compare results, promote winner to live.
 *
 * Each sandbox is an isolated execution environment with:
 *   - Its own virtual portfolio (starting capital, positions)
 *   - Its own strategy parameters
 *   - Its own P&L tracking
 *   - No effect on live positions
 *
 * Usage:
 *   const sandbox = createSandbox({ name: "aggressive-momentum", capital: 10000 });
 *   sandbox.simulateTrade({ symbol: "BTCUSDT", side: "BUY", qty: 0.1, price: 95000 });
 *   const results = sandbox.snapshot();
 *   // Compare multiple sandboxes, then promote winner
 *   promoteSandbox(sandbox.id);
 */

// ============================================================================
// Types
// ============================================================================

export interface SandboxConfig {
  name: string;
  /** Starting capital in USD. */
  capitalUsd: number;
  /** Strategy parameters (opaque — interpreted by the strategy). */
  strategyParams?: Record<string, unknown>;
  /** Optional description. */
  description?: string;
  /** If true, trades are logged but not tracked in P&L (dry run). */
  dryRun?: boolean;
}

export interface VirtualPosition {
  symbol: string;
  side: "long" | "short";
  entryPrice: number;
  quantity: number;
  currentPrice: number;
  unrealizedPnl: number;
  entryTime: string;
}

export interface VirtualTrade {
  id: string;
  symbol: string;
  side: "BUY" | "SELL";
  quantity: number;
  price: number;
  timestamp: string;
  /** Fees in USD. */
  feesUsd: number;
  /** Resulting P&L for closing trades. */
  realizedPnl?: number;
}

export interface SandboxSnapshot {
  id: string;
  name: string;
  createdAt: string;
  /** Current virtual capital. */
  capitalUsd: number;
  /** Starting capital. */
  initialCapitalUsd: number;
  /** Total realized P&L. */
  realizedPnl: number;
  /** Total unrealized P&L. */
  unrealizedPnl: number;
  /** Net P&L (realized + unrealized). */
  netPnl: number;
  /** Return percentage. */
  returnPct: number;
  /** Open positions. */
  positions: VirtualPosition[];
  /** Closed trades. */
  trades: VirtualTrade[];
  /** Number of trades. */
  tradeCount: number;
  /** Win rate. */
  winRate: number;
  /** Max drawdown percentage. */
  maxDrawdownPct: number;
  /** Strategy parameters. */
  strategyParams?: Record<string, unknown>;
  /** Status. */
  status: "active" | "completed" | "promoted";
}

// ============================================================================
// Sandbox Implementation
// ============================================================================

export class StrategySandbox {
  readonly id: string;
  readonly name: string;
  readonly createdAt: string;
  private initialCapital: number;
  private capital: number;
  private positions = new Map<string, VirtualPosition>();
  private trades: VirtualTrade[] = [];
  private realizedPnl = 0;
  private peakEquity: number;
  private maxDrawdown = 0;
  private strategyParams?: Record<string, unknown>;
  private status: "active" | "completed" | "promoted" = "active";
  private nextTradeId = 0;

  constructor(config: SandboxConfig) {
    this.id = `sandbox_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    this.name = config.name;
    this.createdAt = new Date().toISOString();
    this.initialCapital = config.capitalUsd;
    this.capital = config.capitalUsd;
    this.peakEquity = config.capitalUsd;
    this.strategyParams = config.strategyParams;
  }

  /**
   * Simulate a trade in this sandbox.
   */
  simulateTrade(params: {
    symbol: string;
    side: "BUY" | "SELL";
    quantity: number;
    price: number;
    feeRate?: number;
  }): VirtualTrade {
    const { symbol, side, quantity, price, feeRate = 0.001 } = params;
    const notional = quantity * price;
    const fees = notional * feeRate;

    const trade: VirtualTrade = {
      id: `t_${this.nextTradeId++}`,
      symbol,
      side,
      quantity,
      price,
      timestamp: new Date().toISOString(),
      feesUsd: fees,
    };

    const existing = this.positions.get(symbol);

    if (side === "BUY") {
      if (existing && existing.side === "short") {
        // Closing short
        const pnl = (existing.entryPrice - price) * Math.min(quantity, existing.quantity) - fees;
        trade.realizedPnl = pnl;
        this.realizedPnl += pnl;
        this.capital += pnl;

        if (quantity >= existing.quantity) {
          this.positions.delete(symbol);
        } else {
          existing.quantity -= quantity;
        }
      } else {
        // Opening or adding to long
        const newQty = (existing?.quantity ?? 0) + quantity;
        const avgPrice = existing
          ? (existing.entryPrice * existing.quantity + price * quantity) / newQty
          : price;
        this.positions.set(symbol, {
          symbol,
          side: "long",
          entryPrice: avgPrice,
          quantity: newQty,
          currentPrice: price,
          unrealizedPnl: 0,
          entryTime: existing?.entryTime ?? trade.timestamp,
        });
        this.capital -= notional + fees;
      }
    } else {
      // SELL
      if (existing && existing.side === "long") {
        // Closing long
        const pnl = (price - existing.entryPrice) * Math.min(quantity, existing.quantity) - fees;
        trade.realizedPnl = pnl;
        this.realizedPnl += pnl;
        this.capital += notional - fees;

        if (quantity >= existing.quantity) {
          this.positions.delete(symbol);
        } else {
          existing.quantity -= quantity;
          this.capital -= existing.quantity * existing.entryPrice; // Adjust
        }
      } else {
        // Opening or adding to short
        const newQty = (existing?.quantity ?? 0) + quantity;
        this.positions.set(symbol, {
          symbol,
          side: "short",
          entryPrice: price,
          quantity: newQty,
          currentPrice: price,
          unrealizedPnl: 0,
          entryTime: existing?.entryTime ?? trade.timestamp,
        });
        this.capital += notional - fees;
      }
    }

    this.trades.push(trade);
    this.updateDrawdown();
    return trade;
  }

  /**
   * Update prices for mark-to-market.
   */
  updatePrice(symbol: string, currentPrice: number): void {
    const pos = this.positions.get(symbol);
    if (!pos) return;
    pos.currentPrice = currentPrice;
    pos.unrealizedPnl =
      pos.side === "long"
        ? (currentPrice - pos.entryPrice) * pos.quantity
        : (pos.entryPrice - currentPrice) * pos.quantity;
    this.updateDrawdown();
  }

  /**
   * Get a full snapshot of this sandbox.
   */
  snapshot(): SandboxSnapshot {
    const positions = [...this.positions.values()];
    const unrealizedPnl = positions.reduce((sum, p) => sum + p.unrealizedPnl, 0);
    const netPnl = this.realizedPnl + unrealizedPnl;
    const winningTrades = this.trades.filter((t) => (t.realizedPnl ?? 0) > 0).length;
    const closingTrades = this.trades.filter((t) => t.realizedPnl !== undefined).length;

    return {
      id: this.id,
      name: this.name,
      createdAt: this.createdAt,
      capitalUsd: this.capital,
      initialCapitalUsd: this.initialCapital,
      realizedPnl: this.realizedPnl,
      unrealizedPnl,
      netPnl,
      returnPct: (netPnl / this.initialCapital) * 100,
      positions,
      trades: this.trades,
      tradeCount: this.trades.length,
      winRate: closingTrades > 0 ? winningTrades / closingTrades : 0,
      maxDrawdownPct: this.maxDrawdown,
      strategyParams: this.strategyParams,
      status: this.status,
    };
  }

  /** Mark as completed (no more trades). */
  complete(): void {
    this.status = "completed";
  }

  /** Mark as promoted (winner going live). */
  promote(): void {
    this.status = "promoted";
  }

  private updateDrawdown(): void {
    const equity =
      this.capital + [...this.positions.values()].reduce((s, p) => s + p.unrealizedPnl, 0);
    if (equity > this.peakEquity) this.peakEquity = equity;
    const dd = ((this.peakEquity - equity) / this.peakEquity) * 100;
    if (dd > this.maxDrawdown) this.maxDrawdown = dd;
  }
}

// ============================================================================
// Sandbox Manager
// ============================================================================

const activeSandboxes = new Map<string, StrategySandbox>();

export function createSandbox(config: SandboxConfig): StrategySandbox {
  const sb = new StrategySandbox(config);
  activeSandboxes.set(sb.id, sb);
  return sb;
}

export function getSandbox(id: string): StrategySandbox | undefined {
  return activeSandboxes.get(id);
}

export function listSandboxes(): SandboxSnapshot[] {
  return [...activeSandboxes.values()].map((sb) => sb.snapshot());
}

export function removeSandbox(id: string): boolean {
  return activeSandboxes.delete(id);
}

/**
 * Compare all active sandboxes side-by-side.
 */
export function compareSandboxes(): {
  sandboxes: SandboxSnapshot[];
  bestByReturn: string | null;
  bestByDrawdown: string | null;
  bestByWinRate: string | null;
} {
  const snapshots = listSandboxes();
  if (snapshots.length === 0)
    return { sandboxes: [], bestByReturn: null, bestByDrawdown: null, bestByWinRate: null };

  const bestByReturn = snapshots.reduce((a, b) => (a.returnPct > b.returnPct ? a : b)).id;
  const bestByDrawdown = snapshots.reduce((a, b) =>
    a.maxDrawdownPct < b.maxDrawdownPct ? a : b,
  ).id;
  const bestByWinRate = snapshots.reduce((a, b) => (a.winRate > b.winRate ? a : b)).id;

  return { sandboxes: snapshots, bestByReturn, bestByDrawdown, bestByWinRate };
}
