/**
 * Order Book Imbalance (OBI) — microstructure signal computed from
 * limit-order-book snapshots.
 *
 * Math (per Lipton et al. 2013 + Cartea/Jaimungal microstructure
 * references):
 *
 *   Static OBI:
 *     OBI = (Σ Q_bid - Σ Q_ask) / (Σ Q_bid + Σ Q_ask)  ∈ [-1, +1]
 *
 *   Standardized OBI (Z-score over rolling window):
 *     OBI_std = (OBI_t - μ) / σ
 *
 *   Fair-price adjustment (Lipton):
 *     P_fair = P_mid + c × OBI_std
 *
 * Predictive power:
 *   - Strong on liquid + large-tick instruments (queue dynamics
 *     dominate)
 *   - Weaker on thin/wide-tick instruments where queues are sparse
 *   - Signal half-life ~1 hour for daily-resolution use; ~10 min for
 *     high-frequency
 *
 * Honest caveats:
 *   1. Spoofing distorts raw OBI. The persistence helper
 *      (`isOrderBookPersistent`) lets the caller require that the
 *      imbalance survives N snapshots before treating it as real.
 *   2. Per-venue depth varies. Calibrate the scaling coefficient `c`
 *      per asset + venue via backtest — never use a single number.
 *   3. The verdict bands here are conservative defaults
 *      (-2σ / -0.5σ / +0.5σ / +2σ) and should be tuned to the asset.
 */

export interface OrderBookLevel {
  price: number;
  quantity: number;
}

export interface OrderBookSnapshot {
  /** Sorted descending by price. */
  bids: OrderBookLevel[];
  /** Sorted ascending by price. */
  asks: OrderBookLevel[];
  /** Optional timestamp (ms). */
  timestamp?: number;
  /** Optional symbol identifier (cosmetic). */
  symbol?: string;
}

export type ObiVerdict = "strong_bid" | "moderate_bid" | "balanced" | "moderate_ask" | "strong_ask";

export interface ObiResult {
  symbol?: string;
  /** Static OBI ∈ [-1, +1]. Positive = bid-heavy. */
  obi: number;
  /** Top-of-book mid price. */
  midPrice: number;
  /** Total bid quantity used. */
  bidVolume: number;
  /** Total ask quantity used. */
  askVolume: number;
  /** Depth levels aggregated on each side. */
  depthLevels: number;
  timestamp?: number;
}

export interface StandardizedObiResult extends ObiResult {
  /** Z-scored OBI. */
  standardizedObi: number;
  /** Rolling mean of recent OBI values. */
  rollingMean: number;
  /** Rolling std of recent OBI values. */
  rollingStd: number;
  /** Number of observations in the rolling window. */
  windowSize: number;
  /** Operator verdict based on standardized magnitude + sign. */
  verdict: ObiVerdict;
  /** Lipton-style fair-price estimate: midPrice + scalingCoefficient × standardizedObi. */
  fairPrice: number;
  /** Mid → fair price delta in basis points. Useful for size-decision shims. */
  fairPriceDeltaBps: number;
}

export interface ObiOptions {
  /** Depth (levels per side) to aggregate. Default 10. */
  depthLevels?: number;
}

export interface StandardizedObiOptions extends ObiOptions {
  /** Rolling window for standardization. Default 60 (e.g. 60 minutes if snapshots are minute-bar). */
  windowSize?: number;
  /** Scaling coefficient `c` in P_fair = mid + c × OBI_std. Asset-specific; default 50bps × midPrice (caller should tune). */
  scalingCoefficient?: number;
  /** Verdict-band threshold for "moderate". Default 0.5 (std units). */
  moderateThreshold?: number;
  /** Verdict-band threshold for "strong". Default 2.0 (std units). */
  strongThreshold?: number;
}

const DEFAULT_DEPTH = 10;
const DEFAULT_WINDOW = 60;
const DEFAULT_MODERATE_THRESHOLD = 0.5;
const DEFAULT_STRONG_THRESHOLD = 2.0;

/**
 * Compute static OBI from a single order book snapshot.
 *
 * Aggregates the top `depthLevels` on each side. When the book is
 * thinner than `depthLevels`, uses whatever's there (no padding).
 */
export function computeOrderBookImbalance(
  snapshot: OrderBookSnapshot,
  options: ObiOptions = {},
): ObiResult {
  const depth = options.depthLevels ?? DEFAULT_DEPTH;
  const bids = snapshot.bids.slice(0, depth);
  const asks = snapshot.asks.slice(0, depth);

  let bidVolume = 0;
  for (const lvl of bids) bidVolume += Math.max(0, lvl.quantity);

  let askVolume = 0;
  for (const lvl of asks) askVolume += Math.max(0, lvl.quantity);

  const total = bidVolume + askVolume;
  const obi = total === 0 ? 0 : (bidVolume - askVolume) / total;

  const topBid = bids[0]?.price ?? 0;
  const topAsk = asks[0]?.price ?? 0;
  const midPrice = topBid && topAsk ? (topBid + topAsk) / 2 : topBid || topAsk;

  return {
    symbol: snapshot.symbol,
    obi: parseFloat(obi.toFixed(6)),
    midPrice,
    bidVolume,
    askVolume,
    depthLevels: Math.min(depth, Math.max(bids.length, asks.length)),
    timestamp: snapshot.timestamp,
  };
}

/**
 * Standardize an OBI value against a rolling-window history of prior
 * OBI values. The caller maintains the history; this helper just
 * computes mean/std + verdict + fair-price delta.
 *
 * For sub-window history (length < 2) returns standardizedObi = 0 and
 * verdict = "balanced".
 */
export function standardizeOrderBookImbalance(
  current: ObiResult,
  history: number[],
  options: StandardizedObiOptions = {},
): StandardizedObiResult {
  const opts = {
    depthLevels: options.depthLevels ?? DEFAULT_DEPTH,
    windowSize: options.windowSize ?? DEFAULT_WINDOW,
    moderateThreshold: options.moderateThreshold ?? DEFAULT_MODERATE_THRESHOLD,
    strongThreshold: options.strongThreshold ?? DEFAULT_STRONG_THRESHOLD,
    scalingCoefficient: options.scalingCoefficient ?? current.midPrice * 0.005, // 50 bps default
  };

  const windowed = history.slice(-opts.windowSize);
  let mean = 0;
  let std = 0;
  let standardized = 0;

  if (windowed.length >= 2) {
    for (const v of windowed) mean += v;
    mean /= windowed.length;
    let sumSq = 0;
    for (const v of windowed) sumSq += (v - mean) * (v - mean);
    std = Math.sqrt(sumSq / (windowed.length - 1));
    if (std > 0) standardized = (current.obi - mean) / std;
  }

  let verdict: ObiVerdict;
  if (standardized >= opts.strongThreshold) verdict = "strong_bid";
  else if (standardized >= opts.moderateThreshold) verdict = "moderate_bid";
  else if (standardized <= -opts.strongThreshold) verdict = "strong_ask";
  else if (standardized <= -opts.moderateThreshold) verdict = "moderate_ask";
  else verdict = "balanced";

  const fairPrice = current.midPrice + opts.scalingCoefficient * standardized;
  const fairPriceDeltaBps =
    current.midPrice > 0 ? ((fairPrice - current.midPrice) / current.midPrice) * 10_000 : 0;

  return {
    ...current,
    standardizedObi: parseFloat(standardized.toFixed(4)),
    rollingMean: parseFloat(mean.toFixed(6)),
    rollingStd: parseFloat(std.toFixed(6)),
    windowSize: windowed.length,
    verdict,
    fairPrice: parseFloat(fairPrice.toFixed(8)),
    fairPriceDeltaBps: parseFloat(fairPriceDeltaBps.toFixed(2)),
  };
}

/**
 * Anti-spoofing helper. Checks whether the order book imbalance has
 * persisted (kept the same sign + magnitude band) across the last
 * `requiredConsecutive` snapshots. Operators applying OBI to size
 * decisions should require persistence before acting.
 *
 * Returns true when:
 *   - The last `requiredConsecutive` OBI values all have the same sign
 *   - All are at least `magnitudeThreshold` in magnitude
 */
export function isOrderBookPersistent(
  recentObiValues: number[],
  requiredConsecutive: number = 3,
  magnitudeThreshold: number = 0.1,
): boolean {
  if (recentObiValues.length < requiredConsecutive) return false;
  const slice = recentObiValues.slice(-requiredConsecutive);
  const firstSign = Math.sign(slice[0]!);
  if (firstSign === 0) return false;
  for (const v of slice) {
    if (Math.sign(v) !== firstSign) return false;
    if (Math.abs(v) < magnitudeThreshold) return false;
  }
  return true;
}
