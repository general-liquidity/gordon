/**
 * Evolving R — dynamic risk-reward for a live trade (Tom Dante's concept).
 *
 * The risk-reward ratio of an open position is NOT static: it must be
 * recomputed as price travels toward target or stop. A 3R-at-entry trade
 * that has run 2.5R toward target now offers a poor *remaining* reward
 * relative to the risk of giving it all back to the original stop.
 *
 * This is a trade-MANAGEMENT gauge (when to trail/trim/hold an existing
 * position), distinct from position sizing and from the pre-trade risk
 * classifier. It does not decide whether to enter — it tells you how the
 * edge of an already-live trade has decayed or improved.
 */

export interface EvolvingRInput {
  entry: number;
  stop: number;
  target: number;
  currentPrice: number;
  side: "long" | "short";
}

export interface EvolvingRResult {
  initialRR: number; // |target-entry| / |entry-stop|
  realizedR: number; // progress in R from entry to currentPrice (signed; + = in profit)
  currentRR: number; // remaining reward / risk-back-to-stop FROM currentPrice
  remainingReward: number; // distance currentPrice -> target (>=0, 0 if reached/passed)
  riskToStop: number; // distance currentPrice -> stop (>=0, 0 if hit/passed)
  verdict: "hold" | "manage" | "target_reached" | "stopped";
  interpretation: string;
}

// Cap used for currentRR when riskToStop == 0 but reward remains (avoids
// emitting literal Infinity so the field stays JSON-clean).
const RR_CAP = 999;

function round2(x: number): number {
  return parseFloat(x.toFixed(2));
}

export function computeEvolvingR(input: EvolvingRInput): EvolvingRResult | null {
  const { entry, stop, target, currentPrice, side } = input;

  if (
    !Number.isFinite(entry) ||
    !Number.isFinite(stop) ||
    !Number.isFinite(target) ||
    !Number.isFinite(currentPrice)
  ) {
    return null;
  }
  if (side !== "long" && side !== "short") {
    return null;
  }

  let risk: number;
  let initialReward: number;
  let realizedR: number;
  let remainingReward: number;
  let riskToStop: number;

  if (side === "long") {
    if (!(stop < entry && entry < target)) return null;
    risk = entry - stop;
    initialReward = target - entry;
    if (risk <= 0 || initialReward <= 0) return null;
    realizedR = (currentPrice - entry) / risk;
    remainingReward = Math.max(0, target - currentPrice);
    riskToStop = Math.max(0, currentPrice - stop);
  } else {
    if (!(target < entry && entry < stop)) return null;
    risk = stop - entry;
    initialReward = entry - target;
    if (risk <= 0 || initialReward <= 0) return null;
    realizedR = (entry - currentPrice) / risk;
    remainingReward = Math.max(0, currentPrice - target);
    riskToStop = Math.max(0, stop - currentPrice);
  }

  const initialRR = initialReward / risk;

  let currentRR: number;
  if (riskToStop > 0) {
    currentRR = remainingReward / riskToStop;
  } else {
    currentRR = remainingReward > 0 ? RR_CAP : 0;
  }
  if (currentRR > RR_CAP) currentRR = RR_CAP;

  const targetReached = side === "long" ? currentPrice >= target : currentPrice <= target;
  const stopped = side === "long" ? currentPrice <= stop : currentPrice >= stop;

  let verdict: EvolvingRResult["verdict"];
  let interpretation: string;

  if (targetReached) {
    verdict = "target_reached";
    interpretation =
      "Price has reached or exceeded the target — the planned reward is fully realized; close or re-baseline the trade.";
  } else if (stopped) {
    verdict = "stopped";
    interpretation =
      "Price has hit or breached the stop — the trade is invalidated; exit per the original risk plan.";
  } else if (realizedR > 0 && currentRR < 0.5) {
    verdict = "manage";
    interpretation =
      "In profit but the remaining reward is poor versus the risk back to stop (currentRR < 0.5) — trail or trim; do not risk a large give-back for a small remaining gain.";
  } else {
    verdict = "hold";
    interpretation = "Risk-reward from here still justifies holding the trade toward target.";
  }

  return {
    initialRR: round2(initialRR),
    realizedR: round2(realizedR),
    currentRR: round2(currentRR),
    remainingReward: round2(remainingReward),
    riskToStop: round2(riskToStop),
    verdict,
    interpretation,
  };
}
