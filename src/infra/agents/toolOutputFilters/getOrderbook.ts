/**
 * get_orderbook output filter — keep top N levels verbatim + aggregate
 * liquidity beyond.
 *
 * Raw: full order book with 20-50 levels per side. The model decides
 * on the top of book (best bid/ask + immediate liquidity); the deep
 * book only matters as an aggregate ("there's $X of liquidity within
 * 1% of mid").
 *
 * Filter strategy:
 *   - Top N levels per side verbatim (default 5)
 *   - Aggregate liquidity in 0.1%, 0.5%, 1%, 2% bands from mid
 *   - Best-bid / best-ask / spread / mid in the summary
 *
 * Bypass when:
 *   - Shape doesn't match expected book structure
 *   - Already small (<= keepLevels per side)
 *   - Error envelope
 */

import {
  passthrough,
  safeStringifyLength,
  looksLikeError,
  type FilterResult,
} from "./types.ts";

interface OrderbookLevel {
  price: number;
  quantity: number;
}

interface OrderbookShape {
  bids?: unknown;
  asks?: unknown;
  symbol?: string;
  lastUpdateId?: number;
  timestamp?: number | string;
  [k: string]: unknown;
}

const KEEP_LEVELS = 5;
const MIN_FOR_COMPRESSION = KEEP_LEVELS + 3; // 8 per side
const BANDS_PCT: ReadonlyArray<number> = [0.1, 0.5, 1.0, 2.0];

function isLevel(v: unknown): v is OrderbookLevel {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o.price === "number" && typeof o.quantity === "number";
}

function normalizeLevels(v: unknown): OrderbookLevel[] | null {
  if (!Array.isArray(v) || v.length === 0) return null;
  // Some venues return [[price, qty], ...] tuples
  if (Array.isArray(v[0])) {
    const out: OrderbookLevel[] = [];
    for (const row of v) {
      if (!Array.isArray(row) || row.length < 2) continue;
      const [p, q] = row;
      const price = typeof p === "number" ? p : Number(p);
      const quantity = typeof q === "number" ? q : Number(q);
      if (Number.isFinite(price) && Number.isFinite(quantity)) {
        out.push({ price, quantity });
      }
    }
    return out.length > 0 ? out : null;
  }
  if (isLevel(v[0])) return v.filter(isLevel);
  return null;
}

function aggregateBand(
  levels: OrderbookLevel[],
  refPrice: number,
  bandPct: number,
  side: "bid" | "ask",
): { quantity: number; notional: number } {
  const bandSpan = refPrice * (bandPct / 100);
  const low = side === "bid" ? refPrice - bandSpan : refPrice;
  const high = side === "bid" ? refPrice : refPrice + bandSpan;
  let quantity = 0;
  let notional = 0;
  for (const lvl of levels) {
    if (lvl.price >= low && lvl.price <= high) {
      quantity += lvl.quantity;
      notional += lvl.price * lvl.quantity;
    }
  }
  return { quantity, notional };
}

export function filterGetOrderbook(raw: unknown): FilterResult {
  if (looksLikeError(raw)) return passthrough(raw);
  if (typeof raw !== "object" || raw === null) return passthrough(raw);
  const ob = raw as OrderbookShape;

  const bids = normalizeLevels(ob.bids);
  const asks = normalizeLevels(ob.asks);
  if (!bids || !asks) return passthrough(raw);
  if (bids.length < MIN_FOR_COMPRESSION && asks.length < MIN_FOR_COMPRESSION) {
    return passthrough(raw);
  }

  // Sort bids descending, asks ascending — defensive in case venue returns mixed order.
  const bidsSorted = [...bids].sort((a, b) => b.price - a.price);
  const asksSorted = [...asks].sort((a, b) => a.price - b.price);

  const bestBid = bidsSorted[0];
  const bestAsk = asksSorted[0];
  if (!bestBid || !bestAsk) return passthrough(raw);

  const mid = (bestBid.price + bestAsk.price) / 2;
  const spreadAbs = bestAsk.price - bestBid.price;
  const spreadPct = (spreadAbs / mid) * 100;

  const filtered = {
    symbol: ob.symbol,
    lastUpdateId: ob.lastUpdateId,
    timestamp: ob.timestamp,
    summary: {
      bestBid: bestBid.price,
      bestAsk: bestAsk.price,
      mid: Number(mid.toFixed(8)),
      spreadAbs: Number(spreadAbs.toFixed(8)),
      spreadPct: Number(spreadPct.toFixed(4)),
      bidCount: bidsSorted.length,
      askCount: asksSorted.length,
    },
    topBids: bidsSorted.slice(0, KEEP_LEVELS),
    topAsks: asksSorted.slice(0, KEEP_LEVELS),
    liquidityBands: BANDS_PCT.map((pct) => ({
      bandPct: pct,
      bid: aggregateBand(bidsSorted, bestBid.price, pct, "bid"),
      ask: aggregateBand(asksSorted, bestAsk.price, pct, "ask"),
    })),
    _meta: {
      filter: "get_orderbook",
      droppedBids: Math.max(0, bidsSorted.length - KEEP_LEVELS),
      droppedAsks: Math.max(0, asksSorted.length - KEEP_LEVELS),
      note: "top-of-book verbatim + banded liquidity. Deep book aggregated.",
    },
  };

  const bytesBefore = safeStringifyLength(raw);
  const bytesAfter = safeStringifyLength(filtered);
  return {
    filtered,
    bytesBefore,
    bytesAfter,
    filterTag: `get_orderbook: ${bidsSorted.length + asksSorted.length}→${
      Math.min(bidsSorted.length, KEEP_LEVELS) + Math.min(asksSorted.length, KEEP_LEVELS)
    }+bands`,
  };
}
