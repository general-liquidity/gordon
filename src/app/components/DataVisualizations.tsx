/**
 * DataVisualizations — thin wrapper components that map tool output data
 * to the visual effect components in ./effects/.
 *
 * Each wrapper handles the data transformation so consumers can pass raw
 * tool output without worrying about prop shapes.
 *
 * Exports:
 *   - PortfolioChart:           portfolio tool output -> PortfolioBarChart
 *   - MarketHeatmap:            scan results          -> HeatmapGrid
 *   - TradeWaterfallCard:       trade result           -> TradeWaterfall
 *   - PriceAlert:               price change data      -> GainAnimation
 */

import React from "react";
import {
  PortfolioBarChart,
  type Holding,
  HeatmapGrid,
  type HeatmapItem,
  TradeWaterfall,
  GainAnimation,
} from "./effects/index.ts";

// ---------------------------------------------------------------------------
// PortfolioChart
// ---------------------------------------------------------------------------

/** Shape of a single balance entry as returned by the get_portfolio tool */
export interface PortfolioToolEntry {
  asset: string;
  free: number | string;
  locked: number | string;
  /** USD value — may be pre-computed by the tool */
  usdValue?: number;
  /** Current price per unit in USD */
  price?: number;
}

export interface PortfolioChartProps {
  /** Raw balance entries from get_portfolio tool */
  balances: PortfolioToolEntry[];
  /** Optional title (default: "Portfolio Allocation") */
  title?: string;
  /** Max rows to show (default: 10) */
  maxItems?: number;
}

/**
 * Map raw portfolio tool output into PortfolioBarChart holdings.
 * Computes USD value from (free + locked) * price when usdValue is absent.
 */
function toHoldings(balances: PortfolioToolEntry[]): Holding[] {
  return balances
    .map((b) => {
      const qty = Number(b.free) + Number(b.locked);
      const value = b.usdValue ?? (b.price ? qty * b.price : 0);
      return { asset: b.asset, value };
    })
    .filter((h) => h.value > 0);
}

export const PortfolioChart: React.FC<PortfolioChartProps> = ({
  balances,
  title = "Portfolio Allocation",
  maxItems = 10,
}) => {
  const holdings = toHoldings(balances);
  if (holdings.length === 0) return null;
  return (
    <PortfolioBarChart holdings={holdings} title={title} maxItems={maxItems} />
  );
};

// ---------------------------------------------------------------------------
// MarketHeatmap
// ---------------------------------------------------------------------------

/** Shape of a single token entry from scan_market or trending tools */
export interface MarketScanEntry {
  symbol: string;
  /** Price change percentage (24h or relevant period) */
  change?: number;
  priceChangePercent?: number;
  price?: number;
  volume?: number;
}

export interface MarketHeatmapProps {
  /** Raw scan results */
  items: MarketScanEntry[];
  /** Optional title */
  title?: string;
  /** Grid columns (default: 4) */
  columns?: number;
  /** Max items (default: 20) */
  maxItems?: number;
}

function toHeatmapItems(entries: MarketScanEntry[]): HeatmapItem[] {
  return entries.map((e) => ({
    symbol: e.symbol,
    change: e.change ?? e.priceChangePercent ?? 0,
    price: e.price,
    volume: e.volume,
  }));
}

export const MarketHeatmap: React.FC<MarketHeatmapProps> = ({
  items,
  title = "Market Movers",
  columns = 4,
  maxItems = 20,
}) => {
  const heatmapItems = toHeatmapItems(items);
  if (heatmapItems.length === 0) return null;
  return (
    <HeatmapGrid
      items={heatmapItems}
      title={title}
      columns={columns}
      maxItems={maxItems}
    />
  );
};

// ---------------------------------------------------------------------------
// TradeWaterfallCard
// ---------------------------------------------------------------------------

/** Shape of a trade result as returned by order execution tools */
export interface TradeResultEntry {
  symbol: string;
  side: "BUY" | "SELL" | string;
  price: number | string;
  quantity: number | string;
  /** Total value — auto-computed if absent */
  total?: number | string;
  fee?: number | string;
  orderId?: string;
  time?: string;
}

export interface TradeWaterfallCardProps {
  /** Raw trade result from order tool */
  trade: TradeResultEntry;
  /** Show compact layout (default: false) */
  compact?: boolean;
  /** Called when the reveal animation finishes */
  onComplete?: () => void;
}

export const TradeWaterfallCard: React.FC<TradeWaterfallCardProps> = ({
  trade,
  compact = false,
  onComplete,
}) => {
  const price = Number(trade.price);
  const quantity = Number(trade.quantity);
  const total = trade.total ? Number(trade.total) : price * quantity;
  const side = trade.side.toUpperCase() === "BUY" ? "BUY" as const : "SELL" as const;

  return (
    <TradeWaterfall
      symbol={trade.symbol}
      side={side}
      price={price}
      quantity={quantity}
      total={total}
      fee={trade.fee !== undefined ? Number(trade.fee) : undefined}
      orderId={trade.orderId}
      time={trade.time}
      compact={compact}
      onComplete={onComplete}
    />
  );
};

// ---------------------------------------------------------------------------
// PriceAlert
// ---------------------------------------------------------------------------

export interface PriceAlertProps {
  /** The percentage change (positive for gains, negative for losses) */
  changePercent: number;
  /** Threshold above which animation triggers (default: 5) */
  threshold?: number;
  /** Use emoji rendering (default: false) */
  useEmoji?: boolean;
  /** Called when animation finishes */
  onComplete?: () => void;
}

/**
 * Renders a GainAnimation when |changePercent| exceeds the threshold.
 * Returns null if the change is below the threshold.
 */
export const PriceAlert: React.FC<PriceAlertProps> = ({
  changePercent,
  threshold = 5,
  useEmoji = false,
  onComplete,
}) => {
  const magnitude = Math.abs(changePercent);
  if (magnitude < threshold) return null;

  return (
    <GainAnimation
      type={changePercent >= 0 ? "gain" : "loss"}
      magnitude={magnitude}
      percentage={changePercent}
      useEmoji={useEmoji}
      onComplete={onComplete}
    />
  );
};
