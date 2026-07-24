/**
 * Steidlmayer Market Profile / TPO / Value Area (GORDON_MARKET_PROFILE).
 *
 * Time-at-price construction from TSaM Ch 18. Distinct from Gordon's
 * existing volume-profile (`core/indicators/volume-profile.ts`) which
 * measures *volume* at price; Market Profile measures *time* (TPO count)
 * at price. The two surface different value areas:
 *
 *   - Volume Profile says "the most-traded prices accept value here."
 *   - Market Profile says "the most-time-spent prices accept value here."
 *
 * Implementation:
 *   1. Bucket intraday bars into TPO blocks (e.g. 30-minute periods).
 *   2. For each block, mark every price touched by `[low, high]` with
 *      the block's TPO letter.
 *   3. The TPO count at each price level is the histogram height.
 *   4. The point of control (POC) is the price with the highest count.
 *   5. The value area is the smallest contiguous price range around the
 *      POC that contains 70% of total TPOs.
 *   6. Classify the day: normal (bell-shaped), trending (extended), or
 *      non-trending (flat).
 */

export interface ProfileBar {
  high: number;
  low: number;
  timestamp: number;
}

export interface MarketProfileInput {
  bars: ReadonlyArray<ProfileBar>;
  /** Block duration in ms (one TPO letter per block). Default 30 min. */
  tpoBlockMs?: number;
  /** Price tick size used for the histogram bins. Default auto from range. */
  tickSize?: number;
  /** Target fraction of total TPOs for the value area. Default 0.7. */
  valueAreaFraction?: number;
}

export type ProfileDayType = "normal" | "trending" | "non-trending" | "insufficient";

export interface MarketProfileResult {
  /** TPO counts keyed by price (string-encoded to avoid float-key drift). */
  tpoCountsByPrice: Map<number, number>;
  totalTpos: number;
  pointOfControl: number | null;
  valueAreaHigh: number | null;
  valueAreaLow: number | null;
  valueAreaTpoCount: number;
  dayType: ProfileDayType;
  /** Skewness of the TPO distribution; > 0 means POC sits high in the range. */
  pocSkew: number;
  reasoning: string;
}

const DEFAULT_TPO_MS = 30 * 60 * 1000;
const DEFAULT_VA_FRACTION = 0.7;
const TRENDING_SKEW_THRESHOLD = 0.35;
const NON_TRENDING_RANGE_FRACTION = 0.2;

function pickTickSize(bars: ReadonlyArray<ProfileBar>): number {
  if (bars.length === 0) return 0.01;
  let lo = Infinity;
  let hi = -Infinity;
  for (const b of bars) {
    if (b.low < lo) lo = b.low;
    if (b.high > hi) hi = b.high;
  }
  const range = hi - lo;
  if (!Number.isFinite(range) || range <= 0) return 0.01;
  // Aim for ~50 bins by default.
  return range / 50;
}

function bucketPrice(price: number, tick: number, basis: number): number {
  return Math.round((price - basis) / tick) * tick + basis;
}

export function computeMarketProfile(input: MarketProfileInput): MarketProfileResult {
  const bars = input.bars;
  const fraction = input.valueAreaFraction ?? DEFAULT_VA_FRACTION;
  const tpoBlockMs = input.tpoBlockMs ?? DEFAULT_TPO_MS;
  const counts = new Map<number, number>();

  if (bars.length === 0) {
    return {
      tpoCountsByPrice: counts,
      totalTpos: 0,
      pointOfControl: null,
      valueAreaHigh: null,
      valueAreaLow: null,
      valueAreaTpoCount: 0,
      dayType: "insufficient",
      pocSkew: 0,
      reasoning: "no bars",
    };
  }

  const tick = input.tickSize ?? pickTickSize(bars);
  const basis = bars[0]!.low;

  // Group bars by TPO block.
  const blocks = new Map<number, ProfileBar[]>();
  for (const b of bars) {
    const blockId = Math.floor(b.timestamp / tpoBlockMs);
    const list = blocks.get(blockId) ?? [];
    list.push(b);
    blocks.set(blockId, list);
  }

  // For each block, mark each touched price level once.
  for (const list of blocks.values()) {
    let blockLow = Infinity;
    let blockHigh = -Infinity;
    for (const b of list) {
      if (b.low < blockLow) blockLow = b.low;
      if (b.high > blockHigh) blockHigh = b.high;
    }
    const touched = new Set<number>();
    for (
      let p = bucketPrice(blockLow, tick, basis);
      p <= blockHigh + tick * 1e-9;
      p += tick
    ) {
      const bp = bucketPrice(p, tick, basis);
      touched.add(Math.round(bp / tick));
    }
    for (const key of touched) {
      const priceKey = key * tick;
      counts.set(priceKey, (counts.get(priceKey) ?? 0) + 1);
    }
  }

  let totalTpos = 0;
  for (const c of counts.values()) totalTpos += c;
  if (totalTpos === 0) {
    return {
      tpoCountsByPrice: counts,
      totalTpos: 0,
      pointOfControl: null,
      valueAreaHigh: null,
      valueAreaLow: null,
      valueAreaTpoCount: 0,
      dayType: "insufficient",
      pocSkew: 0,
      reasoning: "no TPO touches recorded",
    };
  }

  // Sort price levels ascending.
  const sortedPrices = Array.from(counts.keys()).sort((a, b) => a - b);
  const countsArr = sortedPrices.map((p) => counts.get(p)!);

  // Point of control: argmax of count; ties resolved toward the centroid
  // of the tied-at-max bins so a contiguous plateau of max-count prices
  // (typical of a monotone trending day where many adjacent levels are
  // touched twice by overlapping blocks) lands inside that plateau.
  let maxCount = 0;
  for (const c of countsArr) if (c > maxCount) maxCount = c;
  let tiedSum = 0;
  let tiedCount = 0;
  for (let i = 0; i < countsArr.length; i++) {
    if (countsArr[i] === maxCount) {
      tiedSum += i;
      tiedCount += 1;
    }
  }
  const tiedCentroidIdx = tiedCount > 0 ? tiedSum / tiedCount : 0;
  let pocIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i < countsArr.length; i++) {
    if (countsArr[i] !== maxCount) continue;
    const dist = Math.abs(i - tiedCentroidIdx);
    if (dist < bestDist) {
      bestDist = dist;
      pocIdx = i;
    }
  }
  const pointOfControl = sortedPrices[pocIdx]!;

  // Value area: expand symmetrically from POC.
  const target = Math.ceil(totalTpos * fraction);
  let vaCount = countsArr[pocIdx]!;
  let lo = pocIdx;
  let hi = pocIdx;
  while (vaCount < target && (lo > 0 || hi < sortedPrices.length - 1)) {
    const above = hi < sortedPrices.length - 1 ? countsArr[hi + 1]! : -1;
    const below = lo > 0 ? countsArr[lo - 1]! : -1;
    if (above < 0 && below < 0) break;
    if (above >= below) {
      hi += 1;
      vaCount += above;
    } else {
      lo -= 1;
      vaCount += below;
    }
  }
  const valueAreaLow = sortedPrices[lo]!;
  const valueAreaHigh = sortedPrices[hi]!;

  // Skew of the POC within the day's price range. POC has already been
  // centroid-resolved to land inside the densest contiguous cluster of
  // max-count bins, so its position is the load-bearing diagnostic for
  // Kaufman's day-type test:
  //
  //   normal       → POC centered
  //   trending     → POC near one end, |skew| large
  //   non-trending → VA spans most of the day's range
  const range = sortedPrices[sortedPrices.length - 1]! - sortedPrices[0]!;
  const rangeCenter = sortedPrices[0]! + range / 2;
  const pocSkew = range > 0 ? (pointOfControl - rangeCenter) / (range / 2) : 0;

  // Day type heuristic.
  const valueAreaRange = valueAreaHigh - valueAreaLow;
  let dayType: ProfileDayType;
  if (Math.abs(pocSkew) >= TRENDING_SKEW_THRESHOLD) dayType = "trending";
  else if (range > 0 && valueAreaRange / range >= 1 - NON_TRENDING_RANGE_FRACTION) {
    dayType = "non-trending";
  } else dayType = "normal";

  const reasoning =
    `POC ${pointOfControl.toFixed(4)} (${dayType}, skew ${pocSkew.toFixed(2)}), ` +
    `VA [${valueAreaLow.toFixed(4)}, ${valueAreaHigh.toFixed(4)}] ` +
    `(${vaCount}/${totalTpos} TPOs, ${((vaCount / totalTpos) * 100).toFixed(0)}%)`;

  return {
    tpoCountsByPrice: counts,
    totalTpos,
    pointOfControl,
    valueAreaHigh,
    valueAreaLow,
    valueAreaTpoCount: vaCount,
    dayType,
    pocSkew,
    reasoning,
  };
}

export function marketProfileToPayload(result: MarketProfileResult): Record<string, unknown> {
  return {
    kind: "market_profile.computed",
    totalTpos: result.totalTpos,
    pointOfControl: result.pointOfControl,
    valueAreaHigh: result.valueAreaHigh,
    valueAreaLow: result.valueAreaLow,
    dayType: result.dayType,
    pocSkew: Number(result.pocSkew.toFixed(3)),
  };
}
