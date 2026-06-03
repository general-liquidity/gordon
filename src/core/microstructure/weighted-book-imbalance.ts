/**
 * Level-weighted order-book imbalance (WDI — weighted depth imbalance).
 *
 * Flat OBI (see `order-book-imbalance.ts`) sums quantities over the top
 * N levels with equal weight, so a wall resting 10 levels deep counts
 * exactly as much as size sitting at the touch. But near-touch liquidity
 * is the liquidity that actually gets executed against and that the
 * matching engine reacts to first — depth far from the touch is cheap to
 * post and cheap to pull (spoofy).
 *
 * WDI weights each level by 1/(level+1) (best = level 0, weight 1; next
 * 1/2; then 1/3 …) so the imbalance is dominated by the touch and decays
 * with depth:
 *
 *   WDI = (Σ wᵢ·Qbidᵢ − Σ wᵢ·Qaskᵢ) / (Σ wᵢ·Qbidᵢ + Σ wᵢ·Qaskᵢ)   ∈ [−1, +1]
 *
 * Comparing WDI against the flat OBI tells you *where* the pressure sits:
 *   - |WDI| > |flat OBI|, same sign → imbalance concentrated near the
 *     touch (more actionable / more likely real).
 *   - |WDI| < |flat OBI|           → imbalance is back in the book (a
 *     deep wall; treat with more suspicion of spoofing).
 *   - opposite signs               → touch and depth disagree (the touch
 *     leans one way while deep size leans the other).
 *
 * Distinct from microprice (touch-only, queue-weighted fair price) and
 * from flat OBI (equal-weight depth). Same anti-spoofing caveat applies:
 * require persistence across snapshots before sizing on it.
 */

import type { OrderBookSnapshot, OrderBookLevel } from "./order-book-imbalance.ts";

export type WeightedImbalanceVerdict =
  | "strong_bid"
  | "moderate_bid"
  | "balanced"
  | "moderate_ask"
  | "strong_ask";

export type ImbalanceConcentration = "at_touch" | "in_depth" | "touch_vs_depth_conflict" | "even";

export interface WeightedBookImbalanceResult {
  symbol?: string;
  /** Level-weighted (1/(level+1)) imbalance ∈ [−1, +1]. Positive = bid-heavy. */
  weightedImbalance: number;
  /** Flat equal-weight imbalance over the same levels, for comparison. */
  flatImbalance: number;
  /** weightedImbalance − flatImbalance. >0 = bid pressure sits nearer the touch than flat implies. */
  concentrationDelta: number;
  /** Where the imbalance lives relative to the touch. */
  concentration: ImbalanceConcentration;
  midPrice: number;
  depthLevels: number;
  verdict: WeightedImbalanceVerdict;
  interpretation: string;
}

export interface WeightedBookImbalanceOptions {
  /** Depth (levels per side) to aggregate. Default 10. */
  depthLevels?: number;
  /** |WDI| ≥ this is "moderate". Default 0.2. */
  moderateThreshold?: number;
  /** |WDI| ≥ this is "strong". Default 0.5. */
  strongThreshold?: number;
}

const DEFAULT_DEPTH = 10;
const DEFAULT_MODERATE = 0.2;
const DEFAULT_STRONG = 0.5;

function round(x: number, n = 6): number {
  return Number(x.toFixed(n));
}

function weightedAndFlatVolume(levels: OrderBookLevel[]): { weighted: number; flat: number } {
  let weighted = 0;
  let flat = 0;
  for (let i = 0; i < levels.length; i++) {
    const q = Math.max(0, levels[i]!.quantity);
    weighted += q / (i + 1);
    flat += q;
  }
  return { weighted, flat };
}

function imbalance(bid: number, ask: number): number {
  const total = bid + ask;
  return total === 0 ? 0 : (bid - ask) / total;
}

export function computeWeightedBookImbalance(
  snapshot: OrderBookSnapshot,
  options: WeightedBookImbalanceOptions = {},
): WeightedBookImbalanceResult {
  const depth = options.depthLevels ?? DEFAULT_DEPTH;
  const moderate = options.moderateThreshold ?? DEFAULT_MODERATE;
  const strong = options.strongThreshold ?? DEFAULT_STRONG;

  const bids = snapshot.bids.slice(0, depth);
  const asks = snapshot.asks.slice(0, depth);

  const bidVol = weightedAndFlatVolume(bids);
  const askVol = weightedAndFlatVolume(asks);

  const weightedImbalance = imbalance(bidVol.weighted, askVol.weighted);
  const flatImbalance = imbalance(bidVol.flat, askVol.flat);
  const concentrationDelta = weightedImbalance - flatImbalance;

  const topBid = bids[0]?.price ?? 0;
  const topAsk = asks[0]?.price ?? 0;
  const midPrice = topBid && topAsk ? (topBid + topAsk) / 2 : topBid || topAsk;

  let verdict: WeightedImbalanceVerdict;
  if (weightedImbalance >= strong) verdict = "strong_bid";
  else if (weightedImbalance >= moderate) verdict = "moderate_bid";
  else if (weightedImbalance <= -strong) verdict = "strong_ask";
  else if (weightedImbalance <= -moderate) verdict = "moderate_ask";
  else verdict = "balanced";

  // Concentration profile. Opposite signs (and both non-trivial) = conflict;
  // else compare magnitudes to locate where the pressure sits.
  let concentration: ImbalanceConcentration;
  const bothNonTrivial = Math.abs(weightedImbalance) > 0.05 && Math.abs(flatImbalance) > 0.05;
  if (bothNonTrivial && Math.sign(weightedImbalance) !== Math.sign(flatImbalance)) {
    concentration = "touch_vs_depth_conflict";
  } else if (Math.abs(concentrationDelta) < 0.05) {
    concentration = "even";
  } else if (Math.abs(weightedImbalance) > Math.abs(flatImbalance)) {
    concentration = "at_touch";
  } else {
    concentration = "in_depth";
  }

  const concentrationNote: Record<ImbalanceConcentration, string> = {
    at_touch: "pressure concentrated near the touch (more actionable)",
    in_depth: "pressure sits deep in the book (treat as possible spoof)",
    touch_vs_depth_conflict: "touch and depth disagree on direction",
    even: "pressure spread evenly through the book",
  };

  const interpretation =
    `Weighted book imbalance ${weightedImbalance >= 0 ? "+" : ""}${round(weightedImbalance, 3)} ` +
    `(flat ${flatImbalance >= 0 ? "+" : ""}${round(flatImbalance, 3)}) → ${verdict}; ` +
    `${concentrationNote[concentration]}.`;

  return {
    symbol: snapshot.symbol,
    weightedImbalance: round(weightedImbalance),
    flatImbalance: round(flatImbalance),
    concentrationDelta: round(concentrationDelta),
    concentration,
    midPrice,
    depthLevels: Math.min(depth, Math.max(bids.length, asks.length)),
    verdict,
    interpretation,
  };
}
