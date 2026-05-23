/**
 * Internal Batch — cross offsetting orders before routing externally.
 *
 * Per Eric Budish's flow trading analysis: institutional desks doing
 * portfolio rebalances or multi-strategy rebalancing cross internally
 * before going to external venues to avoid paying the sniping tax
 * twice (once on the buy, once on the sell).
 *
 * Single-operator Gordon analog: when the operator submits a batch of
 * orders (autonomous loop, portfolio rebalance, manual basket), this
 * primitive identifies same-symbol opposite-side pairs and nets them
 * before generating the external order set. The crossed quantity
 * executes at an internal mid-price; the residual goes to the venue.
 *
 * Pure function over an input set of orders. The caller (executor)
 * decides whether to actually act on the suggested netting — Gordon's
 * safety stack remains the gatekeeper. Audit-trail entries can be
 * generated from the `internalCrossings` field of the result.
 *
 * What this primitive does NOT do:
 *   - Place orders. It's pure planning.
 *   - Choose between venues. Each leg keeps its venue id.
 *   - Settle internally — the netting is bookkeeping; in real
 *     execution the operator's positions still need to be reconciled.
 *     Operator decides whether internal netting matches their
 *     account/strategy bookkeeping.
 *
 * Single-operator caveat: most retail use cases don't have meaningful
 * offsetting orders within a batch (you don't usually want to both
 * buy and sell AAPL simultaneously). This primitive is more valuable
 * at Pro/institutional scale with multiple strategy buckets. For
 * single operator: the rebalance use case ("sell A to fund buy B")
 * doesn't cross (different symbols); the multi-strategy hedging
 * use case does cross.
 */

export type BatchOrderSide = "buy" | "sell";

export interface BatchOrderInput {
  /** Stable id for the order — operator/strategy tag. */
  orderId: string;
  /** Symbol/asset. */
  symbol: string;
  /** Order direction. */
  side: BatchOrderSide;
  /** Quantity in asset units (positive). */
  qty: number;
  /** Operator-supplied reference price (mid / last / model fair value). */
  referencePrice: number;
  /** Optional strategy/operator tag for audit-trail attribution. */
  strategyTag?: string;
}

export interface InternalCrossing {
  symbol: string;
  /** Quantity crossed internally. */
  qty: number;
  /** Internal clearing price — midpoint of the two orders' reference prices. */
  clearingPrice: number;
  /** The buy-side order that participated in the cross. */
  buyOrderId: string;
  /** The sell-side order that participated in the cross. */
  sellOrderId: string;
  /** Quantity each side originally requested (before netting). */
  buyOrderOriginalQty: number;
  sellOrderOriginalQty: number;
  buyOrderStrategy?: string;
  sellOrderStrategy?: string;
}

export interface BatchOrderResidual {
  orderId: string;
  symbol: string;
  side: BatchOrderSide;
  /** Original quantity. */
  originalQty: number;
  /** Quantity remaining after internal crossings. May be 0 (fully crossed). */
  residualQty: number;
  referencePrice: number;
  strategyTag?: string;
}

export interface InternalBatchResult {
  /** Crossings that should be booked internally. */
  internalCrossings: InternalCrossing[];
  /** Orders to send externally — residuals after netting. Zero-residual orders are still listed so callers can audit full ownership. */
  externalOrders: BatchOrderResidual[];
  /** Total quantity crossed internally across all symbols. */
  totalCrossedQty: number;
  /** Total quantity that still needs external execution. */
  totalExternalQty: number;
  /** Per-symbol pre-netting + post-netting summary. */
  symbolSummary: Array<{
    symbol: string;
    grossBuyQty: number;
    grossSellQty: number;
    crossedQty: number;
    netExternalQty: number;
    netExternalSide: BatchOrderSide | "balanced";
  }>;
  /** Human-readable summary. */
  summary: string;
}

export interface InternalBatchOptions {
  /**
   * Minimum quantity to attempt internal crossing. Cross-amounts
   * below this threshold are left as separate external orders
   * (avoid micro-bookkeeping overhead). Default 0 (always cross).
   */
  minCrossQty?: number;
  /**
   * When true, internal crossing only happens between orders with
   * DIFFERENT strategyTag values (operator wants their multi-
   * strategy hedging exposure crossed but doesn't want a single
   * strategy's buy + sell crossed). Default false.
   */
  requireDifferentStrategy?: boolean;
}

/**
 * FIFO-on-each-side netting: oldest buy meets oldest sell, cross the
 * smaller of their quantities, repeat until one side is empty. Within
 * a symbol, order arrival order in the input array is the FIFO order.
 *
 * The internal clearing price is the midpoint of the two reference
 * prices. Operators wanting a different rule (VWAP-weighted, more
 * sophisticated) can post-process the result.
 */
export function computeInternalBatch(
  orders: BatchOrderInput[],
  options: InternalBatchOptions = {},
): InternalBatchResult {
  const minCross = options.minCrossQty ?? 0;
  const requireDiffStrategy = options.requireDifferentStrategy ?? false;

  // Bucket by symbol
  const bySymbol = new Map<
    string,
    { buys: BatchOrderInput[]; sells: BatchOrderInput[] }
  >();
  for (const order of orders) {
    let bucket = bySymbol.get(order.symbol);
    if (!bucket) {
      bucket = { buys: [], sells: [] };
      bySymbol.set(order.symbol, bucket);
    }
    if (order.side === "buy") bucket.buys.push(order);
    else bucket.sells.push(order);
  }

  // Track residual quantities per order
  const residualBySymbol = new Map<string, Map<string, number>>();
  for (const order of orders) {
    let m = residualBySymbol.get(order.symbol);
    if (!m) {
      m = new Map();
      residualBySymbol.set(order.symbol, m);
    }
    m.set(order.orderId, order.qty);
  }

  const crossings: InternalCrossing[] = [];
  const symbolSummary: InternalBatchResult["symbolSummary"] = [];

  for (const [symbol, { buys, sells }] of bySymbol) {
    const grossBuy = buys.reduce((s, o) => s + o.qty, 0);
    const grossSell = sells.reduce((s, o) => s + o.qty, 0);
    let crossedQty = 0;

    // FIFO match
    const buyQueue = [...buys];
    const sellQueue = [...sells];
    let buyIdx = 0;
    let sellIdx = 0;
    const residuals = residualBySymbol.get(symbol)!;

    while (buyIdx < buyQueue.length && sellIdx < sellQueue.length) {
      const buyOrder = buyQueue[buyIdx]!;
      const sellOrder = sellQueue[sellIdx]!;

      if (requireDiffStrategy && buyOrder.strategyTag === sellOrder.strategyTag) {
        // Skip same-strategy pairs — advance the queue we're not crossing
        // Simplest rule: advance buy side; if buy side exhausted next loop, sell side advances naturally
        buyIdx += 1;
        continue;
      }

      const buyRemaining = residuals.get(buyOrder.orderId) ?? 0;
      const sellRemaining = residuals.get(sellOrder.orderId) ?? 0;
      if (buyRemaining <= 0) {
        buyIdx += 1;
        continue;
      }
      if (sellRemaining <= 0) {
        sellIdx += 1;
        continue;
      }

      const matchQty = Math.min(buyRemaining, sellRemaining);
      if (matchQty < minCross) {
        // Too small to cross — advance both
        buyIdx += 1;
        sellIdx += 1;
        continue;
      }

      const clearingPrice = (buyOrder.referencePrice + sellOrder.referencePrice) / 2;
      crossings.push({
        symbol,
        qty: matchQty,
        clearingPrice,
        buyOrderId: buyOrder.orderId,
        sellOrderId: sellOrder.orderId,
        buyOrderOriginalQty: buyOrder.qty,
        sellOrderOriginalQty: sellOrder.qty,
        buyOrderStrategy: buyOrder.strategyTag,
        sellOrderStrategy: sellOrder.strategyTag,
      });
      crossedQty += matchQty;
      residuals.set(buyOrder.orderId, buyRemaining - matchQty);
      residuals.set(sellOrder.orderId, sellRemaining - matchQty);

      if (residuals.get(buyOrder.orderId)! <= 0) buyIdx += 1;
      if (residuals.get(sellOrder.orderId)! <= 0) sellIdx += 1;
    }

    const netExt = Math.abs(grossBuy - grossSell);
    const netSide: BatchOrderSide | "balanced" =
      grossBuy > grossSell ? "buy" : grossSell > grossBuy ? "sell" : "balanced";

    symbolSummary.push({
      symbol,
      grossBuyQty: grossBuy,
      grossSellQty: grossSell,
      crossedQty,
      netExternalQty: netExt,
      netExternalSide: netSide,
    });
  }

  // Build external order list — residuals
  const externalOrders: BatchOrderResidual[] = [];
  let totalExternalQty = 0;
  for (const order of orders) {
    const residualMap = residualBySymbol.get(order.symbol);
    const residualQty = residualMap?.get(order.orderId) ?? order.qty;
    externalOrders.push({
      orderId: order.orderId,
      symbol: order.symbol,
      side: order.side,
      originalQty: order.qty,
      residualQty,
      referencePrice: order.referencePrice,
      strategyTag: order.strategyTag,
    });
    totalExternalQty += residualQty;
  }

  const totalCrossed = crossings.reduce((s, c) => s + c.qty, 0);
  const summary =
    `${orders.length} orders across ${bySymbol.size} symbols: ` +
    `${crossings.length} internal crossings (${totalCrossed.toFixed(4)} qty), ` +
    `${externalOrders.filter((o) => o.residualQty > 0).length} external residuals (${totalExternalQty.toFixed(4)} qty)`;

  return {
    internalCrossings: crossings,
    externalOrders,
    totalCrossedQty: totalCrossed,
    totalExternalQty,
    symbolSummary,
    summary,
  };
}
