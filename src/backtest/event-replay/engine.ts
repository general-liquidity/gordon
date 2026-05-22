/**
 * Event-replay engine — walks a strategy through a historical event
 * window using operator-supplied OHLC bars and a configurable
 * slippage model.
 *
 * Execution model (bar-level approximation, not tick):
 *
 *   - Market orders fill at the NEXT bar's open with `baseMarketBps`
 *     of slippage (× `spreadWideningMultiplier` when the event flags
 *     spread widening).
 *   - Stop orders trigger when the next bar's range crosses the stop
 *     level. If the next bar's OPEN is already past the stop (gap),
 *     the fill is the open price — modeling "200 pips deeper than
 *     intended". This is the load-bearing behavior the post calls out.
 *   - Limit orders fill at the limit price when the next bar's range
 *     touches it; otherwise they remain open until cancelled.
 *
 * This approximation captures gap-through-stop risk + spread-widening
 * cost, which is the core failure mode the four canonical events
 * surface. Sub-bar path resolution (true tick replay) is deferred to
 * Tier 2 — see the [[project_event_replay_tier_2_3_deferred]] memory
 * entry.
 */

import type {
  AssetPosition,
  HistoricalEvent,
  OHLCBar,
  ReplayMetrics,
  ReplayStrategy,
  ReplayTrade,
  SlippageModel,
  StrategyOrder,
} from "./types.ts";
import { DEFAULT_SLIPPAGE_MODEL } from "./types.ts";

export interface ReplayInputs {
  event: HistoricalEvent;
  /** Per-asset OHLC bars, sorted ascending by time. */
  bars: Record<string, OHLCBar[]>;
  strategy: ReplayStrategy;
  /** Initial cash for P&L tracking. Default 100_000 (units are display-only — ratios survive). */
  initialEquity?: number;
  slippage?: Partial<SlippageModel>;
}

interface InternalState {
  positions: Record<string, AssetPosition>;
  /** Open orders pending fill on the NEXT bar for each asset. */
  pendingOrders: StrategyOrder[];
  equity: number;
  cash: number;
  trades: ReplayTrade[];
  equityCurve: Array<{ time: number; equity: number }>;
  highWaterMark: number;
  maxDD: number;
  firstReductionTime: number | null;
  /** Most recent absolute position magnitude per asset — used to detect "reducing" trades. */
  lastAbsQty: Record<string, number>;
}

/**
 * Run the replay. Returns the four required output metrics + supporting
 * data (full trade log + equity curve).
 */
export function runEventReplay(inputs: ReplayInputs): ReplayMetrics {
  const { event, bars, strategy } = inputs;
  const initialEquity = inputs.initialEquity ?? 100_000;
  const slippage = { ...DEFAULT_SLIPPAGE_MODEL, ...(inputs.slippage ?? {}) };

  const windowStartMs = Date.parse(event.windowStart);
  const windowEndMs = Date.parse(event.windowEnd);
  const volStartMs = Date.parse(event.volExpansionStart);

  const state: InternalState = {
    positions: strategy.init(),
    pendingOrders: [],
    equity: initialEquity,
    cash: initialEquity,
    trades: [],
    equityCurve: [],
    highWaterMark: initialEquity,
    maxDD: 0,
    firstReductionTime: null,
    lastAbsQty: {},
  };

  // Initialize lastAbsQty from strategy's init() positions
  for (const [asset, pos] of Object.entries(state.positions)) {
    state.lastAbsQty[asset] = Math.abs(pos.qty);
  }

  // Build the chronological bar stream — interleave bars across assets by time.
  const stream: Array<{ asset: string; bar: OHLCBar; index: number }> = [];
  for (const [asset, assetBars] of Object.entries(bars)) {
    for (let i = 0; i < assetBars.length; i++) {
      stream.push({ asset, bar: assetBars[i]!, index: i });
    }
  }
  stream.sort((a, b) => a.bar.time - b.bar.time);

  // Filter to event window
  const windowed = stream.filter((s) => s.bar.time >= windowStartMs && s.bar.time <= windowEndMs);

  for (const { asset, bar } of windowed) {
    // 1. Process pending orders against this incoming bar.
    state.pendingOrders = state.pendingOrders.flatMap((order) => {
      if (order.asset !== asset) return [order]; // wait for the right asset's bar
      const fill = resolveFill(order, bar, slippage, event.characteristics.spreadWidening);
      if (fill === null) return [order]; // limit didn't trigger; keep pending
      applyFill(state, order, fill, bar.time);
      return []; // executed → drop from pending
    });

    // 2. Mark-to-market on the bar's close
    state.equity = computeEquity(state, bars, bar.time);
    state.equityCurve.push({ time: bar.time, equity: state.equity });
    if (state.equity > state.highWaterMark) state.highWaterMark = state.equity;
    const dd = (state.highWaterMark - state.equity) / state.highWaterMark;
    if (dd > state.maxDD) state.maxDD = dd;

    // 3. Detect risk-reducing trades for response-time metric
    if (state.firstReductionTime === null && bar.time >= volStartMs) {
      const currentAbs = Math.abs(state.positions[asset]?.qty ?? 0);
      const lastAbs = state.lastAbsQty[asset] ?? 0;
      if (currentAbs < lastAbs) {
        state.firstReductionTime = bar.time;
      }
    }
    state.lastAbsQty[asset] = Math.abs(state.positions[asset]?.qty ?? 0);

    // 4. Ask the strategy what to do given this bar
    const newOrders = strategy.step(state.positions, bar, asset);
    state.pendingOrders.push(...newOrders);
  }

  const riskResponseSeconds =
    state.firstReductionTime === null ? null : (state.firstReductionTime - volStartMs) / 1000;

  const maxSlippage =
    state.trades.length === 0 ? 0 : Math.max(...state.trades.map((t) => t.slippageBps));

  return {
    eventId: event.id,
    windowStart: windowStartMs,
    windowEnd: windowEndMs,
    maxIntradayDrawdown: parseFloat(state.maxDD.toFixed(6)),
    eventWindowPnl: parseFloat((state.equity - initialEquity).toFixed(2)),
    maxSingleTradeSlippage: parseFloat(maxSlippage.toFixed(2)),
    riskResponseTimeSeconds: riskResponseSeconds,
    trades: state.trades,
    equityCurve: state.equityCurve,
  };
}

/**
 * Resolve a fill against a bar. Returns null when a limit didn't
 * trigger; an order otherwise produces an immediate fill.
 *
 * Gap-through behavior: if a long stop's level is ≤ next bar's open,
 * the stop "gapped through" and fills at open (worse than the stop
 * level). Same logic mirrored for short stops.
 */
function resolveFill(
  order: StrategyOrder,
  bar: OHLCBar,
  slippage: Required<SlippageModel>,
  spreadsWidened: boolean,
): { price: number; reference: number; gappedThroughStop?: boolean } | null {
  const mult = spreadsWidened ? slippage.spreadWideningMultiplier : 1;
  const bps = slippage.baseMarketBps * mult;

  if (order.type === "market") {
    const slip = bar.open * (bps / 10_000);
    // Buys pay more, sells receive less
    const price = order.side === "buy" ? bar.open + slip : bar.open - slip;
    return { price, reference: bar.open };
  }

  if (order.type === "stop") {
    if (order.price === undefined) return null;
    const stopPrice = order.price;
    // Sell stop (long-stop): triggers when price falls to or below the stop
    if (order.side === "sell" || order.side === "close") {
      if (bar.low <= stopPrice) {
        // Gap-through: bar open is already below stop → fill at open (worse)
        if (bar.open < stopPrice) {
          return { price: bar.open, reference: stopPrice, gappedThroughStop: true };
        }
        return { price: stopPrice, reference: stopPrice };
      }
      return null;
    }
    // Buy stop: triggers when price rises to or above the stop
    if (bar.high >= stopPrice) {
      if (bar.open > stopPrice) {
        return { price: bar.open, reference: stopPrice, gappedThroughStop: true };
      }
      return { price: stopPrice, reference: stopPrice };
    }
    return null;
  }

  // Limit
  if (order.type === "limit") {
    if (order.price === undefined) return null;
    const limitPrice = order.price;
    if (order.side === "buy") {
      if (bar.low <= limitPrice) return { price: limitPrice, reference: limitPrice };
      return null;
    }
    if (bar.high >= limitPrice) return { price: limitPrice, reference: limitPrice };
    return null;
  }

  return null;
}

function applyFill(
  state: InternalState,
  order: StrategyOrder,
  fill: { price: number; reference: number; gappedThroughStop?: boolean },
  time: number,
): void {
  const intendedPrice = fill.reference;

  const slippageBps =
    intendedPrice === 0 ? 0 : (Math.abs(fill.price - intendedPrice) / intendedPrice) * 10_000;

  const trade: ReplayTrade = {
    time,
    asset: order.asset,
    side: order.side,
    qty: order.qty,
    intendedPrice,
    filledPrice: fill.price,
    slippageBps: parseFloat(slippageBps.toFixed(2)),
    orderType: order.type,
    ...(fill.gappedThroughStop && { gappedThroughStop: true }),
  };
  state.trades.push(trade);

  const pos = state.positions[order.asset] ?? { qty: 0, avgPrice: 0 };

  if (order.side === "close") {
    // Realize P&L on the full position
    const realized = (fill.price - pos.avgPrice) * pos.qty;
    state.cash += pos.qty * fill.price;
    state.cash -= realized; // close: cash flows are already in pos.qty * fill.price
    state.positions[order.asset] = { qty: 0, avgPrice: 0 };
    return;
  }

  const signedQty = order.side === "buy" ? order.qty : -order.qty;
  const newQty = pos.qty + signedQty;
  // Volume-weighted avg price; if reversing, reset basis on the new direction
  let newAvg = pos.avgPrice;
  if (Math.sign(newQty) !== Math.sign(pos.qty) && pos.qty !== 0) {
    newAvg = fill.price; // direction flipped; reset basis
  } else if (pos.qty === 0 || Math.sign(signedQty) === Math.sign(pos.qty)) {
    const totalQty = pos.qty + signedQty;
    if (totalQty === 0) newAvg = 0;
    else newAvg = (pos.avgPrice * pos.qty + fill.price * signedQty) / totalQty;
  }
  state.positions[order.asset] = { ...pos, qty: newQty, avgPrice: newAvg };
  state.cash -= signedQty * fill.price;
}

function computeEquity(
  state: InternalState,
  bars: Record<string, OHLCBar[]>,
  asOf: number,
): number {
  let mtm = state.cash;
  for (const [asset, pos] of Object.entries(state.positions)) {
    if (pos.qty === 0) continue;
    const assetBars = bars[asset] ?? [];
    let lastClose = pos.avgPrice;
    for (let i = assetBars.length - 1; i >= 0; i--) {
      if (assetBars[i]!.time <= asOf) {
        lastClose = assetBars[i]!.close;
        break;
      }
    }
    mtm += pos.qty * lastClose;
  }
  return mtm;
}
