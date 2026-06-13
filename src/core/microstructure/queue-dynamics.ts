/**
 * Queue dynamics — top-of-book queue position + queue-aware spread-crossing.
 *
 * Two execution-timing microstructure signals from the limit-order-book touch.
 * For a longer-horizon book like Gordon's these aren't alpha — they answer the
 * EXECUTION question the HFT literature uses them for: "cross the spread now, or
 * rest a passive order and wait?" (saving the spread/adverse-selection tax).
 *
 *   1. queuePositionSignal — the size resting AT the touch. A new passive order
 *      joins the BACK of its side's queue, so a thinner queue fills sooner and a
 *      thicker one means slower fill + higher adverse-selection risk (the queue
 *      ahead of you gets to cancel on bad news first). queueImbalance =
 *      (askQueue − bidQueue)/(askQueue + bidQueue) ∈ [−1, +1]; positive ⇒ the bid
 *      queue is the thinner one (a resting bid fills faster). With a fill-rate it
 *      also returns a time-to-fill estimate (queueSize / fillRate).
 *
 *   2. spreadCrossingProbability — probability the touch is fully consumed (price
 *      ticks through) within a horizon. Unlike the bare trade-flow proxy (which
 *      is just the aggression ratio, already in aggression-ratio.ts), this is
 *      QUEUE-AWARE: it pits the resting touch size against the aggressive flow
 *      rate as an M/M/1-style clearing time. Clearing rate λ = flowRate /
 *      touchSize, so P(cross within H) = 1 − e^(−λH) = 1 − e^(−H/expectedClearSec).
 *      Big size + thin flow ⇒ the touch holds; thin size + heavy flow ⇒ it breaks.
 *
 * Pure compute. No I/O. Deterministic. Reuses OrderBookSnapshot.
 */

import type { OrderBookSnapshot } from "./order-book-imbalance.ts";

export type QueueVerdict = "bid_fills_faster" | "ask_fills_faster" | "balanced";

export interface QueuePositionInput {
  snapshot: OrderBookSnapshot;
  /** Aggressive fill rate (qty/sec) consuming the bid touch — for time-to-fill. */
  bidFillRate?: number;
  /** Aggressive fill rate (qty/sec) consuming the ask touch — for time-to-fill. */
  askFillRate?: number;
  /** |imbalance| above which a side is called the faster-filling one. Default 0.2. */
  threshold?: number;
}

export interface QueuePositionResult {
  bidQueue: number;
  askQueue: number;
  /** (askQueue − bidQueue)/(askQueue + bidQueue) ∈ [−1, 1]. + ⇒ thinner bid. */
  queueImbalance: number;
  /** Seconds for a new passive bid at the back of the queue to fill, or null. */
  timeToFillBidSec: number | null;
  timeToFillAskSec: number | null;
  verdict: QueueVerdict;
  reasoning: string;
}

export function queuePositionSignal(input: QueuePositionInput): QueuePositionResult {
  const bidQueue = input.snapshot.bids[0]?.quantity ?? 0;
  const askQueue = input.snapshot.asks[0]?.quantity ?? 0;
  const threshold = input.threshold ?? 0.2;

  const denom = bidQueue + askQueue;
  const queueImbalance = denom > 0 ? (askQueue - bidQueue) / denom : 0;

  const timeToFillBidSec =
    input.bidFillRate != null && input.bidFillRate > 0 ? bidQueue / input.bidFillRate : null;
  const timeToFillAskSec =
    input.askFillRate != null && input.askFillRate > 0 ? askQueue / input.askFillRate : null;

  const verdict: QueueVerdict =
    queueImbalance > threshold
      ? "bid_fills_faster"
      : queueImbalance < -threshold
        ? "ask_fills_faster"
        : "balanced";

  const reasoning =
    `bidQueue=${bidQueue}, askQueue=${askQueue}, imbalance=${queueImbalance.toFixed(3)} → ${verdict}` +
    (timeToFillBidSec != null ? `; tFillBid≈${timeToFillBidSec.toFixed(1)}s` : "") +
    (timeToFillAskSec != null ? `; tFillAsk≈${timeToFillAskSec.toFixed(1)}s` : "");

  return { bidQueue, askQueue, queueImbalance, timeToFillBidSec, timeToFillAskSec, verdict, reasoning };
}

export interface SpreadCrossingInput {
  snapshot: OrderBookSnapshot;
  /** Aggressive BUY flow rate (qty/sec) lifting the ask. */
  buyFlowRate: number;
  /** Aggressive SELL flow rate (qty/sec) hitting the bid. */
  sellFlowRate: number;
  /** Horizon (sec) over which to estimate a crossing. Default 1. */
  horizonSec?: number;
}

export interface SpreadCrossingResult {
  /** Expected seconds for buy flow to clear the ask touch (price up), or null. */
  expClearAskSec: number | null;
  /** Expected seconds for sell flow to clear the bid touch (price down), or null. */
  expClearBidSec: number | null;
  /** P(ask touch cleared within horizon) — upward tick. */
  pCrossUp: number;
  /** P(bid touch cleared within horizon) — downward tick. */
  pCrossDown: number;
  /** pCrossUp − pCrossDown ∈ [−1, 1] — net directional crossing pressure. */
  netCrossBias: number;
  reasoning: string;
}

export function spreadCrossingProbability(input: SpreadCrossingInput): SpreadCrossingResult {
  const bidQueue = input.snapshot.bids[0]?.quantity ?? 0;
  const askQueue = input.snapshot.asks[0]?.quantity ?? 0;
  const horizon = input.horizonSec != null && input.horizonSec > 0 ? input.horizonSec : 1;

  // Expected clearing time = restingSize / aggressiveFlow. P(cleared within H) =
  // 1 − e^(−H / expectedClearSec) (M/M/1-style). A zero/empty touch is already
  // crossed; zero flow can never clear it.
  const expClearAskSec = input.buyFlowRate > 0 ? askQueue / input.buyFlowRate : null;
  const expClearBidSec = input.sellFlowRate > 0 ? bidQueue / input.sellFlowRate : null;

  const pCrossUp =
    askQueue <= 0 ? 1 : expClearAskSec == null ? 0 : 1 - Math.exp(-horizon / expClearAskSec);
  const pCrossDown =
    bidQueue <= 0 ? 1 : expClearBidSec == null ? 0 : 1 - Math.exp(-horizon / expClearBidSec);
  const netCrossBias = pCrossUp - pCrossDown;

  const reasoning =
    `over ${horizon}s: P(cross↑)=${pCrossUp.toFixed(3)} (ask ${askQueue} vs buyFlow ${input.buyFlowRate}/s), ` +
    `P(cross↓)=${pCrossDown.toFixed(3)} (bid ${bidQueue} vs sellFlow ${input.sellFlowRate}/s), ` +
    `net=${netCrossBias >= 0 ? "+" : ""}${netCrossBias.toFixed(3)}`;

  return { expClearAskSec, expClearBidSec, pCrossUp, pCrossDown, netCrossBias, reasoning };
}
